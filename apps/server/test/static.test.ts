/**
 * Production SPA static serving tests.
 *
 * A throwaway `web/dist` is created per test; `buildApp({ webDistPath })` must
 * serve its assets, fall back to `index.html` for SPA routes and keep the JSON
 * `NOT_FOUND` envelope for `/api/*`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { openDb } from "../src/db/index.js";

const INDEX_HTML =
  '<!doctype html><html lang="ko"><head><title>guildloom</title></head>' +
  '<body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';

const APP_JS = 'console.log("guildloom");';

const JSON_NOT_FOUND = {
  error: { code: "NOT_FOUND", message: "Not found" },
};

interface StaticApp {
  app: FastifyInstance;
  close(): Promise<void>;
}

/** Build an app with an in-memory database and the given web dist path. */
async function createStaticApp(webDistPath?: string): Promise<StaticApp> {
  const { db, close: closeDb } = openDb(":memory:");
  const app = await buildApp({ db, webDistPath, realtime: false });

  return {
    app,
    async close() {
      await app.close();
      closeDb();
    },
  };
}

describe("SPA static serving", () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), "guildloom-web-dist-"));
    mkdirSync(join(distDir, "assets"), { recursive: true });
    writeFileSync(join(distDir, "index.html"), INDEX_HTML);
    writeFileSync(join(distDir, "assets", "app.js"), APP_JS);
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("serves built assets and the root index", async () => {
    const { app, close } = await createStaticApp(distDir);
    try {
      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(String(asset.headers["content-type"])).toContain("javascript");
      expect(asset.body).toBe(APP_JS);

      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(String(root.headers["content-type"])).toContain("text/html");
      expect(root.body).toBe(INDEX_HTML);
    } finally {
      await close();
    }
  });

  it("serves index.html for SPA routes", async () => {
    const { app, close } = await createStaticApp(distDir);
    try {
      for (const url of ["/g/42", "/invite/abc", "/quests?stage=board"]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(200);
        expect(String(response.headers["content-type"])).toContain("text/html");
        expect(response.body).toBe(INDEX_HTML);
      }

      const head = await app.inject({ method: "HEAD", url: "/g/42" });
      expect(head.statusCode).toBe(200);
      expect(String(head.headers["content-type"])).toContain("text/html");
      expect(head.body).toBe("");
    } finally {
      await close();
    }
  });

  it("keeps /api/* not-found responses as JSON", async () => {
    const { app, close } = await createStaticApp(distDir);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/missing",
      });
      expect(response.statusCode).toBe(404);
      expect(String(response.headers["content-type"])).toContain(
        "application/json",
      );
      expect(response.json()).toEqual(JSON_NOT_FOUND);

      // `/api` itself and non-GET methods are API 404s too, never HTML.
      for (const request of [
        { method: "GET" as const, url: "/api" },
        { method: "POST" as const, url: "/api/missing" },
      ]) {
        const apiResponse = await app.inject(request);
        expect(apiResponse.statusCode).toBe(404);
        expect(apiResponse.json()).toEqual(JSON_NOT_FOUND);
      }
    } finally {
      await close();
    }
  });

  it("does not crash when an asset is missing", async () => {
    const { app, close } = await createStaticApp(distDir);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/assets/missing.js",
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(INDEX_HTML);
    } finally {
      await close();
    }
  });

  it("returns the JSON 404 when no web dist is configured", async () => {
    const { app, close } = await createStaticApp();
    try {
      const response = await app.inject({ method: "GET", url: "/g/42" });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(JSON_NOT_FOUND);
    } finally {
      await close();
    }
  });

  it("ignores a dist directory without index.html", async () => {
    const emptyDir = join(distDir, "empty");
    mkdirSync(emptyDir, { recursive: true });

    const { app, close } = await createStaticApp(emptyDir);
    try {
      const response = await app.inject({ method: "GET", url: "/g/42" });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(JSON_NOT_FOUND);
    } finally {
      await close();
    }
  });
});

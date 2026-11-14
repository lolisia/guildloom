/**
 * Environment configuration tests.
 *
 * Pin the documented `GUILDLOOM_*` defaults, override handling and the strict
 * validation that makes a misconfigured deployment fail at startup.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATA_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  loadConfig,
} from "../src/config.js";

describe("loadConfig", () => {
  it("applies the documented defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      dataDir: DEFAULT_DATA_DIR,
      trustProxy: false,
    });

    expect(loadConfig()).toMatchObject({
      port: 8080,
      host: "0.0.0.0",
      dataDir: "./data",
      trustProxy: false,
    });
  });

  it("reads overrides from the environment", () => {
    expect(
      loadConfig({
        GUILDLOOM_PORT: "3000",
        GUILDLOOM_HOST: "127.0.0.1",
        GUILDLOOM_DATA_DIR: "/var/lib/guildloom",
        GUILDLOOM_TRUST_PROXY: "true",
      }),
    ).toEqual({
      port: 3000,
      host: "127.0.0.1",
      dataDir: "/var/lib/guildloom",
      trustProxy: true,
    });
  });

  it("accepts the documented port boundaries", () => {
    expect(loadConfig({ GUILDLOOM_PORT: "1" }).port).toBe(1);
    expect(loadConfig({ GUILDLOOM_PORT: "65535" }).port).toBe(65535);
  });

  it.each(["0", "65536", "-1", "80.5", "8o80", "abc", "", " "])(
    "rejects invalid port %j",
    (value) => {
      expect(() => loadConfig({ GUILDLOOM_PORT: value })).toThrow(
        /GUILDLOOM_PORT/,
      );
      expect(() => loadConfig({ GUILDLOOM_PORT: value })).toThrow(
        /1 and 65535/,
      );
    },
  );

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ] as const)("parses GUILDLOOM_TRUST_PROXY=%j as %j", (value, expected) => {
    expect(loadConfig({ GUILDLOOM_TRUST_PROXY: value }).trustProxy).toBe(
      expected,
    );
  });

  it.each(["yes", "no", "TRUE", "2", "", "on"])(
    "rejects invalid trust proxy value %j",
    (value) => {
      expect(() => loadConfig({ GUILDLOOM_TRUST_PROXY: value })).toThrow(
        /GUILDLOOM_TRUST_PROXY/,
      );
    },
  );

  it("rejects an empty host", () => {
    expect(() => loadConfig({ GUILDLOOM_HOST: "  " })).toThrow(
      /GUILDLOOM_HOST/,
    );
  });

  it("rejects an empty data directory", () => {
    expect(() => loadConfig({ GUILDLOOM_DATA_DIR: "" })).toThrow(
      /GUILDLOOM_DATA_DIR/,
    );
  });
});

// @vitest-environment node
/**
 * The icon module is a static transcription of the read-only icon pack
 * manifest. This test is the guard rail: it reads the real manifest from disk
 * and fails the moment `src/lib/icons.ts` drifts from it (a missing id, a
 * renamed mapping or a stale alias), without ever fetching the manifest at
 * runtime.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ICON_ALIASES,
  ICON_NAMES,
  PARTY_STATUS_ICON,
  RANK_ICON,
  RANK_ICON_FALLBACK,
  resolveIcon,
  STAGE_ICON,
  type IconName,
} from "../src/lib/icons";

interface IconPackManifest {
  icons: Record<string, { label: string; category: string }>;
  mappings: {
    stages: Record<string, string>;
    ranks: Record<string, string>;
    rankFallback: string;
    partyStatus: Record<string, string>;
  };
  aliases: Record<string, string>;
}

const manifestPath = new URL(
  "../public/assets/icons/jrpg-v1/manifest.json",
  import.meta.url,
);
const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
) as IconPackManifest;

describe("jrpg-v1 icon manifest", () => {
  it("transcribes every icon id, in manifest order", () => {
    expect(ICON_NAMES).toEqual(Object.keys(manifest.icons));
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("maps every quest stage to the manifest icon", () => {
    expect(STAGE_ICON).toEqual(manifest.mappings.stages);
  });

  it("maps every rank and the fallback to the manifest icons", () => {
    expect(RANK_ICON).toEqual(manifest.mappings.ranks);
    expect(RANK_ICON_FALLBACK).toBe(manifest.mappings.rankFallback);
  });

  it("maps every party status to the manifest icon", () => {
    expect(PARTY_STATUS_ICON).toEqual(manifest.mappings.partyStatus);
  });

  it("transcribes every alias", () => {
    expect(ICON_ALIASES).toEqual(manifest.aliases);
  });

  it("resolves aliases to their target and passes ids through", () => {
    for (const [alias, target] of Object.entries(manifest.aliases)) {
      expect(resolveIcon(alias)).toBe(target);
    }

    for (const id of ICON_NAMES) {
      expect(resolveIcon(id)).toBe(id as IconName);
    }
  });
});

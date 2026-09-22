// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCubeQuestions, CATEGORIES } from "@cube/core";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "cube-web-bundle-"));

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function readTree(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(js|css|html|map)$/.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

let shipped = "";

beforeAll(async () => {
  await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  shipped = readTree(outDir);
}, 60_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe("production bundle", () => {
  it("never talks to TypeSafe directly", () => {
    expect(shipped).not.toContain("api.typesafe.ai");
    expect(shipped).not.toContain("TypeSafeClient");
  });

  it("ships none of the question text", () => {
    const canon = new Set(Object.values(CATEGORIES).flatMap((c) => c.examples));
    const leaked = strings(buildCubeQuestions())
      .filter((text) => text.length >= 24 && !canon.has(text))
      .filter((text) => shipped.includes(text));
    expect(leaked).toEqual([]);
  });

  it("ships no source maps", () => {
    expect(shipped).not.toContain("sourceMappingURL");
  });
});

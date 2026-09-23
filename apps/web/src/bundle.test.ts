// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildCubeQuestions, CATEGORIES } from "@cube/core";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "cube-web-bundle-"));

// docs/ux-spec.md section 15, in the kB (1000 bytes) Vite reports, at zlib's default level.
const INITIAL_JS_GZIP_BUDGET = 90_000;

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

/** The entry script and the chunks it preloads. */
function initialScripts(html: string): string[] {
  const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
  return tags.flatMap((tag) => {
    const src = /\bsrc="\/([^"]+\.js)"/.exec(tag)?.[1];
    if (tag.startsWith("<script") && src) return [src];
    const href = /\bhref="\/([^"]+\.js)"/.exec(tag)?.[1];
    return /\brel="modulepreload"/.test(tag) && href ? [href] : [];
  });
}

let shipped = "";

beforeAll(async () => {
  // Vite keeps an existing NODE_ENV, and Vitest's "test" would bundle React's development build.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
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

  it("keeps the initial JS inside the gzip budget", () => {
    const scripts = initialScripts(readFileSync(join(outDir, "index.html"), "utf8"));
    expect(scripts).not.toEqual([]);
    const bytes = scripts.reduce(
      (sum, path) => sum + gzipSync(readFileSync(join(outDir, path))).length,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(INITIAL_JS_GZIP_BUDGET);
  });

  it("leaves the below-the-fold sections out of the initial JS", () => {
    const initial = initialScripts(readFileSync(join(outDir, "index.html"), "utf8"))
      .map((path) => readFileSync(join(outDir, path), "utf8"))
      .join("\n");
    for (const text of ["What gets sent where", "One order,", "The docket"]) {
      expect(shipped).toContain(text);
      expect(initial).not.toContain(text);
    }
  });
});

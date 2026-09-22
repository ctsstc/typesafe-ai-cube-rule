// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url).href), "utf8");
const headers = read("../public/_headers");
const indexHtml = read("../index.html");
const routes = JSON.parse(read("../public/_routes.json")) as {
  include: string[];
  exclude: string[];
};

function csp(): Map<string, string[]> {
  const line = headers.split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
  if (!line) throw new Error("no Content-Security-Policy in _headers");
  const value = line.slice(line.indexOf(":") + 1);
  return new Map(
    value
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name = "", ...sources]) => [name, sources]),
  );
}

describe("public/_headers", () => {
  it("keeps the CSP free of unsafe sources", () => {
    const policy = csp();
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    for (const [directive, sources] of policy) {
      expect(sources, directive).not.toContain("'unsafe-inline'");
      expect(sources, directive).not.toContain("'unsafe-eval'");
      expect(
        sources.filter((s) => /^https?:/.test(s)),
        directive,
      ).toEqual([]);
    }
  });

  it("allows every inline script in index.html by hash", () => {
    const inline = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    const allowed = csp().get("script-src") ?? [];
    for (const [, body = ""] of inline) {
      const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
      expect(allowed, `update the script-src hash for: ${body.slice(0, 60)}`).toContain(hash);
    }
  });

  it("caches fingerprinted assets forever and revalidates the HTML shell", () => {
    expect(headers).toMatch(
      /^\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m,
    );
    expect(headers).toMatch(/^\/index\.html\n\s+Cache-Control: no-cache$/m);
  });
});

describe("public/_routes.json", () => {
  it("invokes Functions only for /api/*", () => {
    expect(routes).toEqual({ version: 1, include: ["/api/*"], exclude: [] });
  });
});

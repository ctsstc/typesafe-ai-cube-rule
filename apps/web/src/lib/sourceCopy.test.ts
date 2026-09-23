// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PEOPLE_WROTE_IT } from "../test/claims";

const web = fileURLToPath(new URL("../..", import.meta.url));

function shippedSources(): { path: string; text: string }[] {
  const src = readdirSync(join(web, "src"), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(tsx?|css)$/.test(entry.name))
    .filter((entry) => !/\.test\.tsx?$/.test(entry.name) && !entry.parentPath.endsWith("test"))
    .map((entry) => join(entry.parentPath, entry.name));
  return [...src, join(web, "index.html")].map((path) => ({
    path,
    text: readFileSync(path, "utf8").replace(/\s+/g, " "),
  }));
}

describe("shipped source copy", () => {
  it("never claims people wrote every word, even in states the tests don't render", () => {
    const offenders = shippedSources().filter(({ text }) => PEOPLE_WROTE_IT.test(text));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it("uses no em or en dashes", () => {
    const offenders = shippedSources().filter(({ text }) => /[–—]/.test(text));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });
});

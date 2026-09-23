// @vitest-environment node
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isFileLoadingAllowed, type ResolvedConfig, resolveConfig } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
let config: ResolvedConfig;

beforeAll(async () => {
  config = await resolveConfig(
    { root, configFile: join(root, "vite.config.ts"), logLevel: "silent" },
    "serve",
  );
});

describe("vite dev server", () => {
  it.each([
    ".dev.vars",
    ".dev.vars.production",
    "../../.env",
    ".env.local",
    ".npmrc",
    "server.key",
    "../../.git/config",
  ])("refuses to serve %s", (path) => {
    expect(isFileLoadingAllowed(config, join(root, path))).toBe(false);
  });

  it("still serves the app source", () => {
    expect(isFileLoadingAllowed(config, join(root, "src/main.tsx"))).toBe(true);
  });
});

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
// Releases bump the root package.json only (see CLAUDE.md).
import pkg from "../../package.json" with { type: "json" };
import { fontPreload } from "./plugins/fontPreload.ts";
import { mockApi } from "./plugins/mockApi.ts";
import { siteMeta } from "./plugins/siteMeta.ts";

const FUNCTIONS_DEV = "http://localhost:8788";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const mock = env.CUBE_MOCK_API === "1";
  const proxy = mock ? undefined : { "/api": FUNCTIONS_DEV };
  return {
    plugins: [
      react(),
      fontPreload(),
      siteMeta(env.SITE_URL || "https://cube-rule-oracle.pages.dev"),
      mock && mockApi(),
    ],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, proxy },
    // Source maps would ship the full source of @cube/core, question text included.
    build: { target: "es2022", sourcemap: false },
  };
});

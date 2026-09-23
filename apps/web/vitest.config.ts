import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";
import { evalStats } from "./plugins/evalStats.ts";

export default defineProject({
  plugins: [react(), evalStats()],
  define: { __APP_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});

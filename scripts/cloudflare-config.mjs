#!/usr/bin/env node
// Writes apps/web/wrangler.production.jsonc (gitignored): the committed wrangler.jsonc with the real
// KV namespace and D1 database ids from the root .env, so the ids never enter the repo.
// Usage: node scripts/cloudflare-config.mjs   (prints the written path)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KV_PLACEHOLDER = "00000000000000000000000000000000";
export const D1_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
export const PRODUCTION_CONFIG = "wrangler.production.jsonc";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = `${root}apps/web`;

const SETTINGS = {
  CLOUDFLARE_ACCOUNT_ID: /^[0-9a-f]{32}$/,
  CLOUDFLARE_KV_CLASSIFICATIONS_ID: /^[0-9a-f]{32}$/,
  CLOUDFLARE_D1_DATABASE_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

export function readSettings(env, dotenv) {
  const settings = {};
  const missing = [];
  for (const [name, pattern] of Object.entries(SETTINGS)) {
    const fromFile = dotenv.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
    const value = env[name] || fromFile || "";
    if (pattern.test(value) && !/^[0-]+$/.test(value)) settings[name] = value;
    else missing.push(name);
  }
  return { settings, missing };
}

export function productionConfig(template, settings) {
  for (const placeholder of [KV_PLACEHOLDER, D1_PLACEHOLDER]) {
    if (template.split(placeholder).length !== 2) {
      throw new Error(`apps/web/wrangler.jsonc must contain ${placeholder} exactly once`);
    }
  }
  return template
    .replace(KV_PLACEHOLDER, settings.CLOUDFLARE_KV_CLASSIFICATIONS_ID)
    .replace(D1_PLACEHOLDER, settings.CLOUDFLARE_D1_DATABASE_ID);
}

export function loadSettings() {
  const dotenvPath = `${root}.env`;
  const dotenv = existsSync(dotenvPath) ? readFileSync(dotenvPath, "utf8") : "";
  return readSettings(process.env, dotenv);
}

export function writeProductionConfig() {
  const { settings, missing } = loadSettings();
  if (missing.length > 0) {
    throw new Error(
      `set ${missing.join(", ")} in the root .env (see .env.example and docs/deploy.md).`,
    );
  }
  const template = readFileSync(`${web}/wrangler.jsonc`, "utf8");
  writeFileSync(`${web}/${PRODUCTION_CONFIG}`, productionConfig(template, settings));
  return { path: `${web}/${PRODUCTION_CONFIG}`, accountId: settings.CLOUDFLARE_ACCOUNT_ID };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(writeProductionConfig().path);
  } catch (error) {
    console.error(`cloudflare-config: ${error.message}`);
    process.exit(1);
  }
}

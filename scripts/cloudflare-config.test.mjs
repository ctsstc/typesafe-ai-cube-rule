import { describe, expect, it } from "vitest";
import {
  D1_PLACEHOLDER,
  KV_PLACEHOLDER,
  productionConfig,
  readSettings,
} from "./cloudflare-config.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const KV = "fedcba9876543210fedcba9876543210";
const D1 = "12345678-9abc-def0-1234-56789abcdef0";
const DOTENV = `TYPESAFE_API_KEY=x\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\nCLOUDFLARE_KV_CLASSIFICATIONS_ID=${KV}\nCLOUDFLARE_D1_DATABASE_ID=${D1}\n`;

describe("readSettings", () => {
  it("reads the ids from the root .env, with the environment taking precedence", () => {
    expect(readSettings({}, DOTENV)).toEqual({
      settings: {
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_KV_CLASSIFICATIONS_ID: KV,
        CLOUDFLARE_D1_DATABASE_ID: D1,
      },
      missing: [],
    });
    const other = "abcdefabcdefabcdefabcdefabcdefab";
    expect(
      readSettings({ CLOUDFLARE_ACCOUNT_ID: other }, DOTENV).settings.CLOUDFLARE_ACCOUNT_ID,
    ).toBe(other);
  });

  it("refuses missing, malformed and placeholder ids", () => {
    const dotenv = `CLOUDFLARE_ACCOUNT_ID=nope\nCLOUDFLARE_KV_CLASSIFICATIONS_ID=${KV_PLACEHOLDER}\nCLOUDFLARE_D1_DATABASE_ID=${D1_PLACEHOLDER}\n`;
    expect(readSettings({}, dotenv).missing).toEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_KV_CLASSIFICATIONS_ID",
      "CLOUDFLARE_D1_DATABASE_ID",
    ]);
  });
});

describe("productionConfig", () => {
  const template = `{ "kv_namespaces": [{ "id": "${KV_PLACEHOLDER}" }], "d1_databases": [{ "database_id": "${D1_PLACEHOLDER}" }] }`;
  const settings = { CLOUDFLARE_KV_CLASSIFICATIONS_ID: KV, CLOUDFLARE_D1_DATABASE_ID: D1 };

  it("swaps each placeholder for the real id", () => {
    const config = productionConfig(template, settings);
    expect(config).toContain(KV);
    expect(config).toContain(D1);
    expect(config).not.toContain(KV_PLACEHOLDER);
    expect(config).not.toContain(D1_PLACEHOLDER);
  });

  it("refuses a template without exactly one of each placeholder", () => {
    expect(() => productionConfig("{}", settings)).toThrow(/exactly once/);
  });
});

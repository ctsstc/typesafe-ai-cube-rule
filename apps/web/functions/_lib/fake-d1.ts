// Test-only D1 stand-in on node:sqlite, loaded with the real migrations. No route imports it.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url).href);

export interface FakeD1 {
  readonly binding: D1Database;
  readonly sqlite: DatabaseSync;
  readonly calls: string[];
}

export function fakeD1(): FakeD1 {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS}${file}`, "utf8"));
  }
  const calls: string[] = [];
  const statement = (sql: string, params: SQLInputValue[]) => ({
    bind: (...values: SQLInputValue[]) => statement(sql, values),
    first: async () => {
      calls.push(sql);
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    run: async () => {
      calls.push(sql);
      const { changes } = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(changes) } };
    },
    all: async () => {
      calls.push(sql);
      return { success: true, results: sqlite.prepare(sql).all(...params), meta: {} };
    },
  });
  const binding = { prepare: (sql: string) => statement(sql, []) } as unknown as D1Database;
  return { binding, sqlite, calls };
}

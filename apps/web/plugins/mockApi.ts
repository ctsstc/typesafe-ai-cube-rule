import type { CategoryId, ClassifyErrorCode, ClassifyResponse, CubeResponse } from "@cube/core";
import type { Plugin } from "vite";

type Core = typeof import("@cube/core");

type Odds = Partial<Record<CategoryId, number>>;

function categoryAnswer(
  ids: readonly CategoryId[],
  choice: CategoryId,
  odds: Odds,
  confidence: number,
) {
  const named = Object.values(odds).reduce((sum, p) => sum + (p ?? 0), 0);
  const rest = (1 - named) / ids.filter((id) => !(id in odds)).length;
  const probabilities = Object.fromEntries(ids.map((id) => [id, odds[id] ?? rest]));
  return {
    type: "choice",
    choice,
    confidence,
    probabilities,
  } as CubeResponse["answers"]["category"];
}

const SCENARIOS: Record<string, [CategoryId, Odds, number]> = {
  "mock sure": ["taco", { taco: 0.97, sandwich: 0.02 }, 0.96],
  "mock leans": ["sandwich", { sandwich: 0.62, cake: 0.24 }, 0.55],
  "mock torn": ["taco", { taco: 0.41, sandwich: 0.36 }, 0.33],
  "mock family": ["taco", { taco: 0.38, sushi: 0.3, calzone: 0.12 }, 0.3],
  "mock baffled": ["quiche", { quiche: 0.2 }, 0.1],
};

const ERRORS: Record<string, ClassifyErrorCode> = {
  "mock challenge": "challenge_required",
  "mock daily": "daily_limit",
  "mock client": "client_limit",
  "mock stale": "stale_client",
  "mock 429": "rate_limited",
  "mock 502": "upstream_error",
  "mock 503": "upstream_busy",
  "mock 504": "timeout",
  "mock 500": "internal",
};

const RETRY_AFTER: Partial<Record<ClassifyErrorCode, string>> = {
  rate_limited: "7",
  daily_limit: "10800",
  client_limit: "10800",
};

const DELAYS: Record<string, number> = { "mock slow": 5000, "mock timeout": 12000 };

// What Pages sends for /api/* once the Functions quota runs out and it fails open.
const SWAMPED = "mock swamped";

export function mockApi(): Plugin {
  return {
    name: "cube:mock-api",
    apply: "serve",
    configureServer(server) {
      // Loaded through Vite so the workspace package's extensionless TS imports resolve.
      const core = server.ssrLoadModule("@cube/core") as Promise<Core>;
      // Accepts any token, so a real test sitekey shows the check card against the mock.
      server.middlewares.use("/api/session", (req, res) => {
        res.writeHead(req.method === "POST" ? 204 : 405, { "cache-control": "no-store" });
        res.end();
      });
      server.middlewares.use("/api/classify", async (req, res) => {
        const {
          CATEGORY_IDS,
          CLASSIFY_ERROR_CODES,
          isStaleClassifyQuery,
          mockCubeResponse,
          parseClassifyQuery,
        } = await core;
        const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...headers,
          });
          res.end(JSON.stringify(body));
        };
        const search = (req.url ?? "").split("?")[1] ?? "";
        const item = parseClassifyQuery(search);
        if (item === null) {
          const code = isStaleClassifyQuery(search) ? "stale_client" : "bad_request";
          send(CLASSIFY_ERROR_CODES[code], { error: { code, message: "Not a canonical query." } });
          return;
        }
        if (item === SWAMPED) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<!doctype html><html><body>Cube Rule Oracle</body></html>");
          return;
        }
        const errorCode = ERRORS[item];
        if (errorCode) {
          const retryAfter = RETRY_AFTER[errorCode];
          const headers: Record<string, string> = retryAfter ? { "retry-after": retryAfter } : {};
          send(
            CLASSIFY_ERROR_CODES[errorCode],
            { error: { code: errorCode, message: `Simulated ${errorCode}.` } },
            headers,
          );
          return;
        }
        const base = mockCubeResponse(item);
        const scenario = SCENARIOS[item];
        const body: ClassifyResponse = {
          ...base,
          answers: scenario
            ? { ...base.answers, category: categoryAnswer(CATEGORY_IDS, ...scenario) }
            : base.answers,
          mock: true,
        };
        setTimeout(() => send(200, body), DELAYS[item] ?? 120 + (item.length % 5) * 60);
      });
    },
  };
}

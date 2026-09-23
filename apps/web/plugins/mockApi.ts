import type {
  CategoryId,
  ClassifyErrorCode,
  ClassifyResponse,
  CubeResponse,
  ListEntry,
  ListsResponse,
} from "@cube/core";
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

const food = (
  item: string,
  category: CategoryId,
  confidence: number,
  more: Partial<ListEntry> = {},
): ListEntry => ({
  item,
  kind: "food",
  category,
  wet: false,
  confidence,
  runnerUp: null,
  official: null,
  debateLevel: 1,
  ...more,
});

const honorary = (item: string, category: CategoryId, confidence: number, runnerUp: CategoryId) =>
  food(item, category, confidence, { kind: "honorary", runnerUp, debateLevel: 0 });

// Newest first. Canon entries match OFFICIAL_RULINGS.
const DOCKET: readonly ListEntry[] = [
  food("gyro", "taco", 0.28, { runnerUp: "sushi", debateLevel: 2 }),
  honorary("canoe", "taco", 0.41, "sushi"),
  food("big mac", "sandwich", 0.71, { runnerUp: "cake", official: "cake", debateLevel: 3 }),
  food("ramen", "nachos", 0.66, {
    wet: true,
    runnerUp: "salad",
    official: "nachos",
    debateLevel: 2,
  }),
  honorary("santa claus", "calzone", 0.47, "sushi"),
  food("hot dog", "taco", 0.93, { official: "taco", debateLevel: 3 }),
  food("cheesecake", "cake", 0.52, { runnerUp: "quiche", official: "quiche", debateLevel: 2 }),
  food("quesadilla", "sandwich", 0.36, { runnerUp: "taco", debateLevel: 3 }),
  food("pop tart", "calzone", 0.88, { official: "calzone" }),
  food("enchilada", "taco", 0.45, { runnerUp: "sushi", official: "sushi" }),
  food("burrito", "calzone", 0.9, { official: "calzone" }),
  food("poutine", "nachos", 0.84, { official: "nachos" }),
];

function docketLists(pool: readonly ListEntry[]): ListsResponse["lists"] {
  return {
    latest: pool.slice(0, 8),
    mostDebated: [...pool].sort((a, b) => a.confidence - b.confidence).slice(0, 5),
    jevDissents: pool.filter((e) => e.official !== null && e.official !== e.category).slice(0, 5),
    friendshipEnding: [...pool].sort((a, b) => b.debateLevel - a.debateLevel).slice(0, 5),
  };
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

const listsError = (core: Core, code: ClassifyErrorCode): Reply => ({
  status: core.CLASSIFY_ERROR_CODES[code],
  body: { error: { code, message: `Simulated ${code}.` } },
});

export const MOCK_LISTS_MODES = ["full", "partial", "empty", "disabled", "error"] as const;

/** What /api/lists answers. `CUBE_MOCK_LISTS` picks the mode, and anything else means full. */
export function listsReply(
  core: Core,
  method: string | undefined,
  search: string,
  mode = process.env.CUBE_MOCK_LISTS,
): Reply {
  if (method !== "GET") return listsError(core, "method_not_allowed");
  if (!core.isListsQuery(search)) {
    return listsError(core, new URLSearchParams(search).has("v") ? "stale_client" : "bad_request");
  }
  const base = { enabled: true, questionSetVersion: core.QUESTION_SET_VERSION };
  switch (mode) {
    case "partial":
      return {
        status: 200,
        body: { ...base, activity: null, lists: docketLists(DOCKET.slice(0, 3)) },
      };
    case "empty":
      return { status: 200, body: { ...base, activity: null, lists: docketLists([]) } };
    case "disabled":
      return { status: 200, body: core.disabledListsResponse() };
    case "error":
      return listsError(core, "internal");
    default:
      return {
        status: 200,
        body: { ...base, activity: { newFoodsLastHour: 14 }, lists: docketLists(DOCKET) },
      };
  }
}

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
      server.middlewares.use("/api/lists", async (req, res) => {
        const search = (req.url ?? "").split("?")[1] ?? "";
        const { status, body } = listsReply(await core, req.method, search);
        setTimeout(() => {
          res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(body));
        }, 250);
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

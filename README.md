# Cube Rule Oracle

Name any food and get a ruling. The Oracle asks TypeSafe's Jev model where the structural starch sits, then files the food under one of the nine cubes of the [Cube Rule](https://cuberule.com/): toast, sandwich, taco, sushi, quiche, calzone, salad, cake or nachos. Is a hot dog a sandwich? The cube says taco.

> [!NOTE]
> This is an unofficial fan app, not affiliated with cuberule.com, its creators or TypeSafe. The Cube Rule was created by [@Phosphatide](https://twitter.com/Phosphatide), and [cuberule.com](https://cuberule.com/) is made by [@indirect](https://twitter.com/indirect). Go read the original. The cube drawings here are our own CSS; no images from cuberule.com are used.

## How it works

1. The browser normalizes what you typed and requests `GET /api/classify?food=<item>&v=<question set>`.
2. A Cloudflare Pages Function answers a food someone already asked about from its cache: the edge cache, then KV. The browser keeps its own copy too. Repeat foods never reach Jev, and a new question set starts a fresh cache.
3. A new food needs a `cube_session` cookie. Without one the Function answers `401`, and the browser runs a Cloudflare Turnstile check (usually invisible), trades the token at `POST /api/session` for a signed cookie that lasts an hour, and asks again.
4. Before calling Jev the Function counts the call in D1 against the session (60), the client IP address for the UTC day (150, stored only as a keyed hash) and the whole day (`DAILY_CALL_LIMIT`, 1000 by default).
5. The Function holds the TypeSafe key and sends one request to Jev, a System One model. Jev does not write text. It answers 16 typed questions (Choice, Score and Noul) with probabilities: is this food, which cube, what starch, is it wet, which faces are starch, and so on.
6. The Function returns Jev's raw answers, and the browser turns them into a ruling card with `toCubeResult` from `@cube/core`, so copy and threshold changes never need new inference.

Foods that cuberule.com has already ruled on show a canon badge, and Jev's opinion appears as a dissent if it disagrees. Things that are not food get an honorary ruling ("If it were food, it would definitely be a quiche"). Gibberish is uncubeable, and abusive text is declined without being echoed back.

> [!IMPORTANT]
> The API key lives only in the root `.env` locally and in a Pages secret in production. It must never reach the browser bundle, a commit or a log line. `apps/web/src/bundle.test.ts` fails `pnpm check` if the bundle contains the TypeSafe API host, the SDK or any question text.

## Quick start

Needs Node 22 or newer (developed on 24) and pnpm 10. `corepack enable` picks up the pinned pnpm version.

```sh
pnpm i
cp .env.example .env    # add TYPESAFE_API_KEY from https://console.typesafe.ai/keys, or leave it empty
pnpm dev
```

Open http://localhost:5173. `pnpm dev` runs Vite on 5173 and the Pages Function under `wrangler pages dev` on 8788; Vite proxies `/api` to the Function. The first run symlinks `apps/web/.dev.vars` to the root `.env` so wrangler sees the key without a second copy.

### Mock mode

With `TYPESAFE_API_KEY` empty or missing, the Function answers with simulated rulings instead of calling Jev. They are deterministic for each food and shaped exactly like live answers, but they are not real rulings. The app shows a demo banner and stamps every card "Simulated". Any food containing the word `slur` shows the declined card.

For UI work without wrangler, `pnpm --filter @cube/web dev:mock` serves the same mock straight from Vite, plus trigger foods for every state: `mock sure`, `mock torn`, `mock baffled`, `mock 429`, `mock 503`, `mock slow`, `mock timeout` and more (see [docs/ux-spec.md](docs/ux-spec.md#14-mock-mode)).

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Vite on 5173 and the Function on 8788 |
| `pnpm dev:functions` | Only the Function on 8788 |
| `pnpm dev:challenge [pass\|fail\|interactive\|spent] [--preview]` | Like `pnpm dev`, with the Turnstile check on using Cloudflare's test keys (see [docs/deploy.md](docs/deploy.md#trying-the-human-check-locally)) |
| `pnpm preview:pages` | Builds the SPA, then serves `dist` and the Function together on 8788 with the production headers. The closest thing to production |
| `pnpm build` | Builds `apps/web/dist` |
| `pnpm check` | Typecheck, Biome lint and every Vitest project. Run it before committing |
| `pnpm format` | Biome format and safe fixes |
| `pnpm eval` | Runs the labelled food set against Jev (see below) |
| `pnpm deploy:pages` | Guarded production deploy (see [docs/deploy.md](docs/deploy.md)) |

## Evaluation

`eval/` holds 204 labelled items (45 canon rulings from cuberule.com, 82 consensus foods and 77 probes, including 21 abusive probes stored base64-encoded) and a harness that asks Jev every question for each one and scores Jev's own ruling. Answers are cached per question set, so rerunning is free.

```sh
pnpm eval                                  # live calls for anything not cached (about $0.083 per full pass)
pnpm eval --split=tune --max-usd=0.05      # fetch one split, refuse to start above a budget
pnpm eval --offline                        # rescore the cache only, no key needed
```

Question set 6, the current one, scores 95/97 on the tune split, 60/62 on the holdout split and 45/45 on canon, and the abuse guard declines 21/21 abusive probes with no false declines. Reports live in `eval/results/v<version>/report.md`, and [docs/eval.md](docs/eval.md) explains the splits and records every tuning round. [docs/question-design.md](docs/question-design.md) explains the questions themselves.

## Deploying

The app is one Cloudflare Pages project: the static SPA plus a Pages Function for `/api`. The share URL is a subdomain CNAME'd to `<project>.pages.dev`. One-time setup, the deploy script's safety checks, the custom domain, rollback, caching and spend limits are in [docs/deploy.md](docs/deploy.md).

## Project layout

```text
apps/web/                 Vite + React SPA and the Pages project
  src/                    App shell, ruling card, CSS 3D cube, gallery, about
  functions/api/          Pages Functions: classify.ts, session.ts and a JSON 404 for other /api paths
  functions/_lib/         Handlers, session cookie, D1 spend caps, HTTP helpers, rate limiter, tests
  migrations/             D1 schema for the spend caps
  public/                 _headers (CSP), _routes.json, icons, og.png
  og/                     SVG sources for the link preview card and icons
  plugins/                Vite plugins: font preload, site URL, keyless mock API
  wrangler.jsonc          Pages config
packages/core/            @cube/core: categories, Jev questions and thresholds, input
                          normalization, official rulings, result logic, mock, wire types
eval/                     Labelled dataset, eval harness and results per question set
docs/                     Question design, eval, UX spec, canon audit and deploy runbook
scripts/                  pages-dev.sh (local wrangler), dev-challenge.sh and deploy.sh
```

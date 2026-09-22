# Cube Rule Oracle

Name any food and get a ruling. The Oracle asks TypeSafe's Jev model where the structural starch sits, then files the food under one of the nine cubes of the [Cube Rule](https://cuberule.com/): toast, sandwich, taco, sushi, quiche, calzone, salad, cake or nachos. Is a hot dog a sandwich? The cube says taco.

> [!NOTE]
> This is an unofficial fan app, not affiliated with cuberule.com, its creators or TypeSafe. The Cube Rule was created by [@Phosphatide](https://twitter.com/Phosphatide), and [cuberule.com](https://cuberule.com/) is made by [@indirect](https://twitter.com/indirect). Go read the original. The cube drawings here are our own CSS; no images from cuberule.com are used.

## How it works

1. The browser normalizes what you typed and requests `GET /api/classify?food=<item>&v=<question set>`.
2. A Cloudflare Pages Function holds the TypeSafe key and sends one request to Jev, a System One model. Jev does not write text. It answers 16 typed questions (Choice, Score and Noul) with probabilities: is this food, which cube, what starch, is it wet, which faces are starch, and so on.
3. The Function returns Jev's raw answers. The browser turns them into a ruling card with `toCubeResult` from `@cube/core`, so copy and threshold changes never need new inference.
4. Rulings are cached by food name and question set version: in the Cloudflare edge cache, optionally in KV, and in the browser. Repeat foods rarely reach Jev, and a new question set starts a fresh cache.

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
| `pnpm preview:pages` | Builds the SPA, then serves `dist` and the Function together on 8788 with the production headers. The closest thing to production |
| `pnpm build` | Builds `apps/web/dist` |
| `pnpm check` | Typecheck, Biome lint and every Vitest project. Run it before committing |
| `pnpm format` | Biome format and safe fixes |
| `pnpm eval` | Runs the labelled food set against Jev (see below) |
| `pnpm deploy:pages` | Guarded production deploy (see [docs/deploy.md](docs/deploy.md)) |

## Evaluation

`eval/` holds 156 labelled items (45 canon rulings from cuberule.com, 82 consensus foods and 29 probes) and a harness that asks Jev every question for each one and scores Jev's own ruling. Answers are cached per question set, so rerunning is free.

```sh
pnpm eval             # live calls for anything not cached (about $0.06 per full pass)
pnpm eval --offline   # rescore the cache only, no key needed
```

Question set 5, the current one, scores 66/67 on the tune split, 42/44 on the holdout split and 45/45 on canon. Reports live in `eval/results/v<version>/report.md`, and [docs/eval.md](docs/eval.md) explains the splits and records every tuning round. [docs/question-design.md](docs/question-design.md) explains the questions themselves.

## Deploying

The app is one Cloudflare Pages project: the static SPA plus a Pages Function for `/api`. The share URL is a subdomain CNAME'd to `<project>.pages.dev`. One-time setup, the deploy script's safety checks, the custom domain, rollback, caching and spend limits are in [docs/deploy.md](docs/deploy.md).

## Project layout

```text
apps/web/                 Vite + React SPA and the Pages project
  src/                    App shell, ruling card, CSS 3D cube, gallery, about
  functions/api/          Pages Function: classify.ts and a JSON 404 for other /api paths
  functions/_lib/         Handler, HTTP helpers, rate limiter and their tests
  public/                 _headers (CSP), _routes.json, icons, og.png
  og/                     SVG sources for the link preview card and icons
  plugins/                Vite plugins: font preload, site URL, keyless mock API
  wrangler.jsonc          Pages config
packages/core/            @cube/core: categories, Jev questions and thresholds, input
                          normalization, official rulings, result logic, mock, wire types
eval/                     Labelled dataset, eval harness and results per question set
docs/                     Question design, eval, UX spec and deploy runbook
scripts/                  pages-dev.sh (local wrangler) and deploy.sh
```

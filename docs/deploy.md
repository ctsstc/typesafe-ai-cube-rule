# Deploying Cube Rule Oracle

The app is one Cloudflare Pages project, `cube-rule-oracle`, built from `apps/web`, shared at https://cube-rule-oracle.pages.dev (also reachable at https://typesafe-ai-cube-rule.codyswartz.us):

- `apps/web/dist`: the Vite SPA, served as free static assets.
- `apps/web/functions/api/classify.ts`: a Pages Function for `GET /api/classify`. It holds the TypeSafe key and calls Jev.
- `apps/web/functions/api/session.ts`: `POST /api/session`, which trades a Turnstile token for a signed session cookie.
- `apps/web/functions/api/lists.ts`: `GET /api/lists`, the [public lists](#public-lists).
- `apps/web/migrations/`: the D1 schema for the spend caps and the public lists (binding `DB`).
- `apps/web/public/_routes.json` limits Function invocations to `/api/*`, so page loads never count against the Functions quota.
- `apps/web/public/_headers` sets the CSP and other security headers on static assets. Pages never applies `_headers` to Function responses, so the Function sets its own.

All wrangler commands below run from `apps/web`, where `wrangler.jsonc`, `functions/` and `migrations/` live. `pnpm --filter @cube/web exec wrangler ...` works from the repo root too.

## How the paid path is protected

Every uncached ruling calls Jev, about $0.0004 each. Cached rulings stay free and never see a challenge.

1. `GET /api/classify` checks the edge cache, then KV. A hit is served straight away, with no cookie needed.
2. On a miss it needs a valid `cube_session` cookie. Without one it answers `401 challenge_required`, unless today's budget or this client's is already spent. Then it answers `503 daily_limit` or `429 client_limit` straight away, after one statement that reads today's `usage` row and the client's row by primary key, so nobody solves a check that can only end in a refusal. That read is only a shortcut: a failed read falls through to the challenge, and the atomic charge in step 6 stays the real guard.
3. The SPA then loads Turnstile from `challenges.cloudflare.com` (only now, which is during page load when a shared link names a food nobody has asked about), runs an interaction-only widget with the action `session`, and posts the token to `POST /api/session`.
4. `/api/session` calls siteverify with the secret, an idempotency key and the visitor's IP, and checks `success`, that `hostname` equals the request host and that `action` is `session`. It then sets `cube_session`: `{sid, iat, exp}` signed with HMAC-SHA256 under `SESSION_SECRET`, valid for one hour, `HttpOnly; Secure; SameSite=Strict; Path=/api` (no `Secure` on localhost).
5. The SPA retries the ruling once. A second `challenge_required` is shown as an error, never looped.
6. Before calling Jev the Function charges D1, narrowest first:
   - the session: 60 Jev calls per `sid`. A spent session gets `401 challenge_required`, so the SPA runs a fresh check and gets a new session. When the day or the client is spent too, it gets that refusal instead, through the same read as step 2. Charging the session first means a spent session can never use up the shared daily budget.
   - the client: 150 Jev calls per IP address per UTC day, so one scripted client cannot spend the whole day's budget however many checks it passes. The row is keyed by `HMAC-SHA256(SESSION_SECRET, "client:" + day + ":" + ip)`, so D1 never holds an IP and a day's keys cannot be linked to the next. Past it the Function answers `429 client_limit` with `Retry-After` until midnight UTC. Skipped when challenges are off.
   - the UTC day: `DAILY_CALL_LIMIT` calls (default 1000, about $0.40 a day). Past it the Function answers `503 daily_limit` with `Retry-After` until midnight UTC, and the SPA says when new foods open again. Cached foods keep working.

Each charge is one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE calls < limit RETURNING calls`. No row back means refused, and a refusal gives back the charges already made, since Jev was never asked. A Jev call that fails after the charge stays counted, because it may still be billed.

After each Jev call that reports usage, including a malformed 200 it may still bill, the Function adds the `usage.input_tokens` Jev reports to today's `usage.input_tokens` column (migration 0004) and counts the call in `usage.token_calls` (migration 0005), in the background. That write never delays or fails the ruling; a failure is logged as `classify: token count failed`. `pnpm spend` reads both (see [Watching spend](#watching-spend)).

The per-session count lives in D1, not in the cookie. A stateless cookie cannot count: a client could replay its first cookie forever. With the count in D1, every Turnstile solve buys at most 60 Jev calls.

> [!IMPORTANT]
> The Function fails closed. If `TURNSTILE_SECRET_KEY` is set but `SESSION_SECRET` is missing or shorter than 32 characters, or the D1 charge throws (for example because the tables were never migrated), new rulings are refused with a 500 and Jev is never called. Cached rulings still work.

Configuration:

| Name | Where | What |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Pages secret | The Jev key. Without it the Function serves mock rulings. |
| `TURNSTILE_SECRET_KEY` | Pages secret | The widget secret. Unset turns the challenge off (local dev and mock mode). |
| `SESSION_SECRET` | Pages secret | At least 32 characters. Signs the session cookie. |
| `DAILY_CALL_LIMIT` | `vars` in `wrangler.jsonc` | Jev calls per UTC day. `"0"` stops every new ruling. |
| `PUBLIC_LISTS` | `vars` in `wrangler.jsonc` | `"on"` (default) serves the [public lists](#public-lists). Any other value empties them. `pnpm recent --lists off` does the same without a deploy. |
| `ACTIVITY_THRESHOLD` | `vars` in `wrangler.jsonc` | Listable rulings first seen in the last hour before the lists carry an activity count. Default 5, at most 50: the count stops at 50, so a higher value is read as 50. |
| `DB` | `d1_databases` in `wrangler.jsonc` | The spend caps, the recorded rulings, the blocklist and the lists switch. Unbound, the caps are skipped with one warning per isolate, nothing is recorded and the lists stay empty. |
| `VITE_TURNSTILE_SITE_KEY` | Build time | The public sitekey baked into the SPA. `scripts/deploy.sh` reads it from the environment or the root `.env` and refuses to deploy without it. |

## Local development

| Command | What it runs |
| --- | --- |
| `pnpm dev` | The Function on http://localhost:8788 and Vite on http://localhost:5173. Vite proxies `/api` to 8788. |
| `pnpm dev:functions` | Only the Function (plus `apps/web/public`) on 8788. |
| `pnpm preview:pages` | Builds the SPA, then serves `dist` and the Function together on 8788, with `_headers` and `_routes.json` applied. The closest thing to production. |
| `pnpm dev:challenge [mode] [--preview]` | Like `pnpm dev`, with the human check on (see below). |

`scripts/pages-dev.sh` symlinks `apps/web/.dev.vars` to the root `.env` the first time it runs. Wrangler reads local secrets from `.dev.vars`, so the key stays in one gitignored file and Vite never reads it. With no key (or an empty one) the Function serves mock rulings marked `"mock": true` and `Cache-Control: no-store`.

Local runs also bind a local KV namespace (`--kv CLASSIFICATIONS`), a local Cache API and the local D1 database from `wrangler.jsonc`, all stored under `apps/web/.wrangler/state` (gitignored). `pages-dev.sh` applies the D1 migrations to the local database before it starts.

Plain `pnpm dev` leaves `TURNSTILE_SECRET_KEY` unset, so there is no challenge. The daily cap still applies to live calls.

### Trying the human check locally

`pnpm dev:challenge` (`scripts/dev-challenge.sh`) starts the same stack with Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), a random `SESSION_SECRET`, and `VITE_TURNSTILE_SITE_KEY` set for Vite:

| Mode | Sitekey | Secret | What happens |
| --- | --- | --- | --- |
| `pass` (default) | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` | Passes without a click. |
| `interactive` | `3x00000000000000000000FF` | `1x0000000000000000000000000000000AA` | Shows the "One quick check" card with a checkbox. |
| `fail` | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` | The widget fails and the SPA shows "Couldn't confirm you're human." |
| `spent` | `1x00000000000000000000AA` | `3x0000000000000000000000000000000AA` | The widget passes, siteverify answers `timeout-or-duplicate`. |

`--preview` builds `dist` and serves it with `_headers`, so the production CSP is in force. `DAILY_CALL_LIMIT=1 pnpm dev:challenge` makes the daily cap easy to hit. Mock rulings are challenged too, so everything works without a TypeSafe key.

Test secrets answer siteverify with `hostname: "example.com"` and no `action`, so the Function skips those two checks for the three documented test secrets only. A real secret never returns a test result.

By hand, with curl against a running `pages dev`. `v` must be the current `QUESTION_SET_VERSION`, so the first line reads it from the source:

```sh
V=$(sed -n 's/^export const QUESTION_SET_VERSION = "\(.*\)";/\1/p' packages/core/src/questions.ts)
curl -si "http://localhost:8788/api/classify?food=kimchi+quesadilla&v=$V"            # 401 challenge_required
curl -si -c jar -H 'content-type: application/json' \
  --data '{"token":"XXXX.DUMMY.TOKEN.XXXX"}' http://localhost:8788/api/session       # 204, Set-Cookie
curl -si -b jar "http://localhost:8788/api/classify?food=kimchi+quesadilla&v=$V"     # 200, X-Cube-Cache: MISS
curl -si "http://localhost:8788/api/classify?food=kimchi+quesadilla&v=$V"            # 200, X-Cube-Cache: HIT, no cookie
curl -si "http://localhost:8788/api/lists?v=$V"                                      # 200, the public lists
```

Read the local counters with `pnpm exec wrangler d1 execute cube-rule-oracle --local --command "SELECT * FROM usage"`, and the local rulings with `pnpm recent --local --flagged`.

## One-time setup

1. Log in to the personal Cloudflare account and put its account id in the root `.env` as `CLOUDFLARE_ACCOUNT_ID`. `scripts/deploy.sh` and `scripts/spend.mjs` read it from there (it is kept out of the repo) and refuse to touch any other account:

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

2. Create the Pages project. Note the `*.pages.dev` hostname it prints. The rest of this page assumes `cube-rule-oracle.pages.dev`; use the printed one if it differs.

   ```sh
   pnpm exec wrangler pages project create cube-rule-oracle --production-branch main
   ```

3. Create the KV namespace that keeps rulings across data centers, then put its id in the root `.env` as `CLOUDFLARE_KV_CLASSIFICATIONS_ID`:

   ```sh
   pnpm exec wrangler kv namespace create CLASSIFICATIONS
   ```

   Production needs it, and `scripts/deploy.sh` refuses to run without the binding. Without KV a ruling lives only in the edge cache of the data center that asked, so a visitor elsewhere gets the human check and a second billed Jev call for the same food. Local dev binds a local namespace either way.

4. Create the D1 database, put its id in the root `.env` as `CLOUDFLARE_D1_DATABASE_ID`, and apply the migrations from the repo root:

   ```sh
   pnpm exec wrangler d1 create cube-rule-oracle
   pnpm migrate:remote
   ```

   The committed `apps/web/wrangler.jsonc` keeps placeholder KV and D1 ids, so the real ones never enter the repo. `scripts/cloudflare-config.mjs` copies it to the gitignored `apps/web/wrangler.production.jsonc` with the ids from `.env`, and `pnpm migrate:remote`, `pnpm spend` and the deploy's D1 check pass that file to wrangler with `-c`. Pages refuses a custom config path for uploads, so `scripts/deploy.sh` copies it over `wrangler.jsonc` just for the upload and restores the committed file on exit. A test fails if real ids are ever committed there. Run any other remote wrangler command the same way (`node scripts/cloudflare-config.mjs`, then `-c wrangler.production.jsonc`). The config file is the source of truth for Pages bindings, so do not add the bindings in the dashboard.

   `scripts/deploy.sh` refuses to run while a migration is unapplied.

5. Store the TypeSafe key as a production secret. Wrangler prompts for the value, so it never lands in shell history:

   ```sh
   pnpm exec wrangler pages secret put TYPESAFE_API_KEY --project-name cube-rule-oracle
   ```

   Preview deployments get no secrets, so they serve mock rulings without a challenge. That is deliberate.

6. Create the Turnstile widget in managed mode for both hostnames (each hostname also covers its subdomains, so preview URLs work too). This pipes the secret straight into the Pages secret and prints only the public sitekey:

   ```sh
   pnpm exec wrangler turnstile widget create cube-rule-oracle --mode managed \
     --domain cube-rule-oracle.pages.dev --domain typesafe-ai-cube-rule.codyswartz.us --json |
     node -e '
       const widget = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
       console.error(`sitekey: ${widget.sitekey}`);
       process.stdout.write(widget.secret);
     ' |
     pnpm exec wrangler pages secret put TURNSTILE_SECRET_KEY --project-name cube-rule-oracle
   ```

   Add the printed sitekey to the root `.env` as `VITE_TURNSTILE_SITE_KEY=<sitekey>` (it is public, but `.env` keeps it out of shell history and next to the other settings). If the secret step fails, fetch the secret again the same way with `pnpm exec wrangler turnstile widget get <sitekey> --json` in place of the create command.

7. Generate the session signing secret and store it without printing it:

   ```sh
   openssl rand -base64 48 | pnpm exec wrangler pages secret put SESSION_SECRET --project-name cube-rule-oracle
   ```

   Rotating it (run the same command again) signs everyone out of their session. They pass a fresh check on their next new food.

8. In the dashboard, under **Workers & Pages > cube-rule-oracle > Settings > Runtime > Fail open / closed**, choose **Fail open**. If the Free plan's daily Functions allowance runs out, the site keeps loading. The API breaks until midnight UTC instead of the whole site: Pages then answers `/api/*` with the SPA's `index.html` and a 200, which the SPA recognizes and shows as "The oracle is swamped." Foods already in the visitor's browser cache keep working.

## Deploying

```sh
pnpm deploy:pages
```

`scripts/deploy.sh` refuses to run unless all of these hold:

- `VITE_TURNSTILE_SITE_KEY` is set (in the environment or the root `.env`) and is not one of Cloudflare's test sitekeys
- `CLOUDFLARE_KV_CLASSIFICATIONS_ID` and `CLOUDFLARE_D1_DATABASE_ID` are set in the root `.env`, so `scripts/cloudflare-config.mjs` can write `apps/web/wrangler.production.jsonc`
- the working tree is clean and on `main`
- the source repo the site links to (`SOURCE_URL` in `apps/web/src/lib/links.ts`) answers 200, which GitHub only does once the repo is public
- `CLOUDFLARE_ACCOUNT_ID` is set in the root `.env` and `wrangler whoami` lists that account (it is exported, so the deploy cannot land anywhere else)
- the project has the `TYPESAFE_API_KEY`, `TURNSTILE_SECRET_KEY` and `SESSION_SECRET` secrets
- the remote D1 database has no unapplied migrations
- `pnpm check` passes

It then builds the SPA with the sitekey, swaps the real ids into `wrangler.jsonc`, runs `wrangler pages deploy dist --project-name cube-rule-oracle --branch main` from `apps/web`, and restores the committed `wrangler.jsonc`.

> [!IMPORTANT]
> Run `pnpm migrate:remote` before `pnpm deploy:pages` whenever `apps/web/migrations/` has a new file, such as 0006 and 0007, which add the `rulings`, `blocklist` and `switches` tables for the public lists. The deploy refuses to run until they are applied. Migrations 0001 to 0007 are additive, so the deployment still live keeps working against the new schema.

> [!WARNING]
> Migration 0008 is not additive. It drops and recreates the list indexes, which a v1.2 Function reads by name, so from `pnpm migrate:remote` until the deploy finishes `/api/lists` answers `enabled: false` and the docket is hidden. Rulings are still served and recorded. Run `pnpm deploy:pages` straight after the migration.

> [!IMPORTANT]
> Deploy from `apps/web`, never with `wrangler pages deploy apps/web/dist` from the repo root. Wrangler looks for `functions/` in its working directory. From the root it would upload the SPA without the API.

The build bakes absolute `og:url` and `og:image` URLs into `index.html` from `SITE_URL`, which defaults to `https://cube-rule-oracle.pages.dev`, the official URL. To make the custom domain official instead, change the default in `scripts/deploy.sh`, or override it for one deploy with `SITE_URL=https://typesafe-ai-cube-rule.codyswartz.us pnpm deploy:pages`.

Tail production logs with `pnpm exec wrangler pages deployment tail --project-name cube-rule-oracle`. Refused spend checks log `classify: daily Jev call limit reached` and `classify: spend check failed`. A wrong or rotated `TURNSTILE_SECRET_KEY` logs `session: siteverify refused TURNSTILE_SECRET_KEY` at error level, and visitors see "Something broke on our side" instead of a failed human check.

## Custom domain (DNS at DigitalOcean)

The custom domain, `typesafe-ai-cube-rule.codyswartz.us`, is a subdomain of a zone whose DNS stays at DigitalOcean. Pages accepts an external CNAME for a subdomain, so the zone does not need to move to Cloudflare.

1. **Cloudflare first.** Attach the hostname to the Pages project. Wrangler's own login token carries the Pages scope, and this keeps it out of the terminal:

   ```sh
   pnpm exec wrangler auth token --json |
     node -e 'process.stdout.write(`Authorization: Bearer ${JSON.parse(require("node:fs").readFileSync(0, "utf8")).token}`)' |
     curl --fail-with-body --header @- \
       "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/cube-rule-oracle/domains" \
       --json '{"name": "typesafe-ai-cube-rule.codyswartz.us"}'
   ```

   The dashboard route is **Workers & Pages > cube-rule-oracle > Custom domains > Set up a domain**.

   > [!WARNING]
   > Adding the CNAME at DigitalOcean before this step makes the hostname answer with Cloudflare error 522.

2. **Then DigitalOcean.** Point the subdomain at the Pages hostname. The API and `doctl` need the trailing dot on the target:

   ```sh
   doctl compute domain records create codyswartz.us \
     --record-type CNAME --record-name typesafe-ai-cube-rule \
     --record-data cube-rule-oracle.pages.dev. --record-ttl 600
   ```

   In the control panel it is **Networking > Domains > codyswartz.us**, a CNAME with hostname `typesafe-ai-cube-rule` that is an alias of `cube-rule-oracle.pages.dev`.

3. Wait for the domain to show **Active** (in the dashboard, or `GET` the same `/domains` URL). Cloudflare validates the CNAME and issues the certificate itself.

4. **CAA.** If `codyswartz.us` has CAA records, certificate issuance fails until they allow Cloudflare's CAs. Add `0 issue` records for `letsencrypt.org`, `pki.goog; cansignhttpexchanges=yes` and `ssl.com`. With no CAA records at all, nothing needs to change.

5. The official URL is still `cube-rule-oracle.pages.dev`. Every page carries a canonical link to it, so search engines treat the custom domain as a duplicate. Switch `SITE_URL` (see Deploying) to promote the custom domain.

`_headers` sends `X-Robots-Tag: noindex` only on per-deploy preview hosts (`<hash>.cube-rule-oracle.pages.dev`), so search engines index the production site but not previews.

## Rollback

Every production deployment is a rollback target. In **Workers & Pages > cube-rule-oracle > Deployments**, open the menu on an earlier deployment and choose **Rollback to this deployment**. The switch is instant and needs no build.

To roll forward again, deploy a fixed commit with `pnpm deploy:pages`, or roll back to the newer deployment in the same list.

D1 migrations do not roll back with a deployment. Keep them additive so an older deployment still runs against the newer schema. A deployment from before the public lists answers `/api/lists` with a JSON 404 and stops recording rulings. The rows already recorded stay put.

## Caching

A ruling is a pure function of the canonical URL `/api/classify?food=<item>&v=<QUESTION_SET_VERSION>`, and the Function returns 400 for any other spelling. So each billed Jev call maps to exactly one cache key:

1. **Browser**: `Cache-Control: public, max-age=31536000, immutable` on live rulings.
2. **Cache API** (`caches.default`): per data center. It works on both `*.pages.dev` and custom domains.
3. **KV** (`CLASSIFICATIONS`): global and durable, so a new data center fills from KV instead of calling Jev. The response header `X-Cube-Cache` reads `HIT`, `KV` or `MISS`.

Bumping `QUESTION_SET_VERSION` in `packages/core/src/questions.ts` changes every URL and KV key, which retires all cached rulings at once. A tab still open on the old version sends the old `v`, and the Function answers `409 stale_client` instead of `400`, so the SPA offers a reload rather than blaming the food. A rollback across question sets does the same to tabs loaded on the newer version.

KV on the Free plan allows 1,000 writes and 100,000 reads a day, shared by the whole account. Writes happen only on a Jev call, so the write limit caps new rulings stored per day, not rulings served. A failed write is logged and the ruling is still returned, but it then lives only in one data center's cache. That is why `DAILY_CALL_LIMIT` defaults to 1000 and should stay at or under the KV write quota; `functions/_lib/usage.test.ts` pins the default.

## Rate limiting and spend

Every Jev call costs money, so the Function only calls Jev on a full cache miss, from a verified session, within both D1 caps. The layers, cheapest first:

| Layer | Limit | Answer when hit |
| --- | --- | --- |
| Turnstile session | One check per hour, and again after 60 new foods | `401 challenge_required` |
| In-code limiter | 20 Jev calls per minute per IP, per isolate. 10 session attempts per minute per IP. | `429 rate_limited` with `Retry-After` |
| Per-session cap (D1) | 60 Jev calls per session | `401 challenge_required` |
| Per-client cap (D1) | 150 Jev calls per IP address per UTC day | `429 client_limit` with `Retry-After` until midnight UTC |
| Daily cap (D1) | `DAILY_CALL_LIMIT`, default 1000 per UTC day | `503 daily_limit` with `Retry-After` until midnight UTC |
| Free plan request cap | 100,000 Functions requests a day, shared with Workers. Every `/api` request counts, cached rulings and [public lists](#functions-requests) included | With Fail open, `index.html` with a 200 until midnight UTC, shown as "The oracle is swamped." |

The in-code limiter is a speed bump, not a quota: each location runs many isolates and they restart often. The D1 caps are the real limits, because D1 is one database with serialized writes.

D1 on the Free plan allows 100,000 rows written and 5 million rows read a day, with limits resetting at 00:00 UTC. A Jev call writes up to 16 rows, counting index rows (see [D1 budget](#d1-budget)), so 1,000 calls stay under about 16,000 writes. Starting a session also deletes expired session rows and past days' client rows. Migration 0003 indexes `sessions.exp` and `clients.day`, so that cleanup reads only the rows it deletes instead of scanning both tables on every human check; `functions/_lib/usage.test.ts` fails if any spend-cap statement goes back to a table scan. Each index costs one extra row write when a session or client row is created. If D1 itself hits its daily limit, the spend check fails and new rulings are refused until midnight UTC, which is the safe direction.

Other levers:

1. **Kill switch.** Set `DAILY_CALL_LIMIT` to `"0"` in `wrangler.jsonc` and deploy. Every cached ruling keeps working. The deploy runs `pnpm check`, and the test that reads the shipped limit accepts `"0"`, so the check never blocks this.
2. **Provider budget.** Use any spend cap or alert the TypeSafe console offers for the key. Revoking the key there is the fastest stop that needs no deploy: the Function then returns `502 upstream_error` for new items while cached rulings keep working.
3. **Not available on this setup.** The Workers Rate Limiting binding (`ratelimits`) is rejected in a Pages config, and WAF rate limiting rules need the zone on Cloudflare.

## Watching spend

`pnpm spend` prints the Jev spend from the production D1 counters. It only runs `SELECT`s, through `wrangler d1 execute cube-rule-oracle --remote` from `apps/web`, with `CLOUDFLARE_ACCOUNT_ID` from the root `.env`, the same account `scripts/deploy.sh` uses. The daily query reads at most 31 rows; `--detail` also reads today's client rows and the live session rows, through the migration 0003 indexes.

```sh
pnpm spend            # per UTC day for the last 30 days, then totals and the ceiling
pnpm spend --detail   # adds today's distinct clients and the live sessions
```

For each day it shows the Jev calls, the share of `DAILY_CALL_LIMIT` (read from `apps/web/wrangler.jsonc`), the input tokens and the dollars at $0.042 per million input tokens ([TypeSafe's list price](https://docs.typesafe.ai/models.md); output tokens are free). Totals cover today, the last 7 days, the last 30 days and the month to date. The ceiling is the most a day can cost at the current limit.

- A day is priced exactly only when every call recorded its tokens, that is when `usage.token_calls` equals `usage.calls`.
- Every other call is estimated at the average input tokens in `eval/results/v<QUESTION_SET_VERSION>/raw.jsonl` (9,642 for question set 6, and the fallback when that file is missing), added to the recorded tokens, and the day is marked `~`. That covers calls charged before migrations 0004 and 0005 and the code that fills them (so the day they land, and any day after a rollback to an older deployment), a Jev call that failed or timed out after the charge, and a token write that failed.
- Before migration 0005 there is no `token_calls`, so every call is estimated.
- `usage.calls` counts reserved calls. A call that failed after the charge stays counted, so estimates run slightly high. The SDK also retries once on a 5xx, so if TypeSafe bills failed attempts, one counted call can cost up to two.

> [!IMPORTANT]
> These are the app's own counters. The [TypeSafe console](https://console.typesafe.ai) is the source of truth for what the key is billed. Revoking the key there at `/keys` is the fastest stop and needs no deploy.

On the Cloudflare side, the free quotas show up in the dashboard: **Workers & Pages > cube-rule-oracle > Functions Metrics** for requests (100,000 a day), **D1 > cube-rule-oracle > Metrics** for rows read and written, and **Workers KV > CLASSIFICATIONS > Metrics** for the 1,000 writes a day. Refusals such as `401`, `429` and `503` count as successful invocations there, so tail the logs or run `pnpm spend` to see the caps at work.

## Public lists

The SPA shows four short lists and an activity line from `GET /api/lists?v=<QUESTION_SET_VERSION>`, so the site feels alive without exposing anyone:

| List | What it holds, 8 at most |
| --- | --- |
| `latest` | The newest rulings. The response carries no timestamps. |
| `mostDebated` | Lowest Jev confidence first, leaving out unanimous verdicts (confidence at or above `THRESHOLDS.unanimous`). |
| `honoraryCourt` | "Honorary court": honorary rulings on things that are not food, Jev's most confident first. |
| `friendshipEnding` | Highest debate level first, newest first within a level, leaving out Settled. |

`activity` is `{ "newFoodsLastHour": n }` only when at least `ACTIVITY_THRESHOLD` (default 5, at most 50) listable rulings were first seen in the last hour, and `null` otherwise, so a quiet hour shows nothing rather than a small number. It counts only rulings that passed the listing gates when they were recorded, never declined, nonsense or hidden ones, through the `rulings_activity` index. It stops counting at 50 (`LISTS_ACTIVITY_CAP` in `@cube/core`), and the SPA shows 50 as "50+". Honorary (not food) rulings also appear in the other lists like foods. The SPA shows every list that has at least one entry, and hides the section only when all four are empty.

Up to v1.2 the third list was `jevDissents`, "Jev vs the canon". It never had an entry, because Jev agrees with all 45 canon rulings in the question set 7 eval: most canon names are worked examples in its questions. A tab still running a v1.2 SPA rejects the renamed response and hides the docket until it reloads.

### What gets recorded and what gets listed

After each successful Jev call the Function records the ruling in the `rulings` table (migrations 0006 to 0008) in the background, so the write never delays or fails the ruling. A failure is logged as `classify: ruling record failed`, and the next edge cache or KV hit for that item records it from the stored ruling, so the item is not lost to the lists. A row holds the item, Jev's pick, the official ruling, confidence, runner-up, wetness, debate level, the four scores behind the person and abuse bars (`listingScores`), whether it passed the listing gates and why not, a capped ask count and the time it was first seen. It holds no IP, session or client key.

`publicListing` in `packages/core/src/public.ts` decides whether a ruling may be listed when it is recorded. It is never listed when:

- Jev declined it as abusive, or found it nonsense
- it contains personal info: a phone number (7 or more digits, counting digit words said in a row), an email address, a handle, a URL or a domain, including spelled-out forms such as `jsmith [at] acme [dot] org` or `acme . com` (`hasPersonalInfo` in `packages/core/src/public.ts`)
- Jev gives at least a 0.05 chance that it names a private person (`THRESHOLDS.publicPrivatePerson`), or is under 0.9 sure that it names nobody or a public figure (`THRESHOLDS.publicPersonSure`)
- Jev scores it abusive at 0.05 or more (`THRESHOLDS.publicAbusive`), unless cuberule.com has ruled on it

A listed ruling is public from its first ask: `MIN_ASKS` is 1, so the Jev call that first rules on an item is enough. In v1.2 it was 2, so a second browser had to ask for the same food, and at the site's traffic almost nothing ever showed. The person, abuse and personal info gates, the blocklist and the kill switch remain the safeguards.

The row keeps an ask count that stops at `MIN_ASKS`. The Jev call is the first ask. Each edge cache or KV hit adds one, a hover prefetch hit included, while a prefetch miss never counts and mock rulings are never recorded. Each ask is one upsert that stops at `MIN_ASKS`, so at 1 every hit on a recorded item writes nothing. Raising `MIN_ASKS` again needs a migration that recreates the list indexes with the new literal, as 0008 did.

`/api/lists` then reads only rows that are listed, not on the blocklist and from the current question set. It checks every row again against today's personal info rules and the current person and abuse bars, and drops any that fail. Tightening a bar in `THRESHOLDS` therefore hides stored rulings on the next refresh. Loosening one affects only rulings recorded afterwards, because a row hidden when it was recorded is never read. It needs no session or human check.

### Caching and the kill switch

`/api/lists` is cached in `caches.default` for 120 seconds per data center and sent with `Cache-Control: public, max-age=120`, so a change reaches visitors within about 4 minutes. A stale `v` gets `409 stale_client`, any other spelling `400`, and methods other than `GET` get `405`.

- **Kill switch without a deploy.** `pnpm recent --lists off` writes one row to the `switches` table (migration 0007). `/api/lists` reads it in the same batch as the lists and answers `{ "enabled": false }` with four empty lists and no activity once its edge and browser copies expire, within about 4 minutes. `pnpm recent --lists on` brings the lists back.
- **Kill switch by deploy.** Set `PUBLIC_LISTS` to `"off"` in `wrangler.jsonc` and deploy. It skips the edge copy, so only browser copies (2 minutes at most) outlast the deploy. The deploy's `pnpm check` accepts `"on"` or `"off"`, so the check never blocks it.
- Either way rulings are still recorded, so the lists come back full when they are turned on again, and `/api/lists` still runs the Function, so neither saves [Functions requests](#functions-requests).
- **Failures.** A missing `DB` binding or any D1 error, such as a table missing before `pnpm migrate:remote`, answers the same `enabled: false` body with `no-store`, never a 500. Read failures log `lists: read failed`.

### The blocklist and pnpm recent

`pnpm recent` shows the recorded rulings from the production D1. Like `pnpm spend`, it runs wrangler with `-c wrangler.production.jsonc` and the account from the root `.env`. It needs no TypeSafe key.

```sh
pnpm recent                        # newest 30 listed rulings, with their status
pnpm recent --flagged              # adds declined and hidden rulings, the reason and the scores
pnpm recent --limit 100            # up to 500
pnpm recent --block "my boss"      # hide an item from the lists
pnpm recent --unblock "my boss"    # show it again
pnpm recent --blocklist            # every blocked item
pnpm recent --lists off            # hide every list, no deploy; --lists on shows them again
pnpm recent --prune                # count rulings from other question sets
pnpm recent --prune --yes          # delete up to 2,000 of them
pnpm recent --local ...            # the same against the pnpm dev database
```

Status reads `public`, `blocked`, `hidden:` with the reason `publicListing` gave when the ruling was recorded, or `hidden now:` when the row fails today's personal info rules or bars, which `/api/lists` checks on every read. `--flagged` adds the `Private`, `Sure` (the higher of the none and public readings) and `Abusive` scores, so you can see which rows a new bar would hide. It prints declined text as typed, so keep that output to your own terminal. It is the only place anyone sees declined rulings.

`--block`, `--unblock`, `--lists` and `--prune --yes` are the only writes. The item goes through the app's `normalizeItem` first, so `pnpm recent --block "My Boss!"` blocks `my boss`, the same string the lists hold. The lists check the blocklist every time they are read, so blocking hides the item from every list within about 4 minutes, needs no deploy, and unblocking always brings it back.

`--prune` counts the rulings from question sets other than the current one, which the lists never read. With `--yes` it deletes up to 2,000 of them per run. Deleting a public row writes up to 7 rows, counting index rows, so one run stays under about 14,000 of the 100,000 writes a day. Run it again, on another day if the count is large, until it reports nothing left.

### Seeding and backfill

`pnpm seed:docket` fills the lists from rulings that already exist, so the docket is not empty on a quiet day. It is a dry run by default: it lists the KV keys (one list operation per 1,000 keys), looks up the candidate items and today's `usage` row in D1, prints the plan and writes nothing. Run it after `pnpm migrate:remote` and `pnpm deploy:pages`, so the live Function lists a ruling from its first ask.

```sh
pnpm seed:docket                        # plan the seed
pnpm seed:docket --apply                # write it
pnpm seed:docket --backfill             # also plan re-asking older foods, with the Jev calls and dollars
pnpm seed:docket --backfill --apply     # ask Jev, then write both
pnpm seed:docket --local ...            # the same against the pnpm dev D1 and KV (--persist-to <dir> too)
```

- **Seed.** The eval rulings in `eval/results/v<QUESTION_SET_VERSION>/raw.jsonl` from `CUBE_MODEL` and the current questions that `publicListing` lists: 188 of 251 for question set 7. Encoded abusive probes are never written, and nothing the gates hide is written anywhere. Each is recorded by the Function's own `recordRuling` with `first_seen` at its eval fetch time, and stored in KV as `v<QUESTION_SET_VERSION>:<item>`, so clicking one is a KV hit with no human check or Jev call.
- **Backfill.** `--backfill` takes the foods under earlier question sets in KV (`v6:<item>` and older), leaves out those already recorded for the current set or covered by the seed, and asks Jev about each with the current questions, about $0.0004 a call. It stops before its estimate passes `--max-usd` (default 0.05). Each answer is recorded as the Function records a Jev call, listed or not, so `pnpm recent --flagged` shows the hidden ones, stored in KV, and added with its input tokens to today's `usage` row for `pnpm spend`. KV keeps no creation date, so `first_seen` is 00:00 UTC of the day it runs.

It refuses to write when the KV writes would pass 900 minus today's `usage.calls` (see [D1 budget](#d1-budget)), when an eval ruling was fetched less than an hour ago or a backfill runs before 01:00 UTC (either would count as new foods in the last hour), or when the backfill's estimate passes `--max-usd`.

Running it again is safe: items already in D1 are skipped, and KV values are written only where missing. D1 goes first, in one `wrangler d1 execute --file` that D1 applies whole or not at all, then one `wrangler kv bulk put`. If KV fails, a rerun stores the missing eval rulings; a backfilled food keeps its row and gets a KV value when someone next asks for it. The generated files live in a temporary directory that is deleted afterwards. Remote commands take the account and ids from the root `.env` like `pnpm spend`, and print wrangler errors with the ids redacted.

### D1 budget

Measured against wrangler's local D1, which counts rows the way D1 bills them. Index rows count as writes. Reads are upper bounds: a primary key lookup that finds nothing reads 0 rows.

| Request | Rows read | Rows written | How often |
| --- | --- | --- | --- |
| Jev call, first one of a new session and client | up to 5 | 15, or 16 for an honorary ruling | At most `DAILY_CALL_LIMIT` Jev calls a day |
| Jev call, later in the same session | up to 7 | 12, or 13 for an honorary ruling | |
| Jev call with the human check off | up to 4 | 8, or 9 for an honorary ruling | |
| (of those, recording a new ruling) | 0 | 6: the row, `rulings_first_seen`, `rulings_activity` and the three list indexes. 7 for an honorary ruling, which `rulings_honorary` also holds. 2 for a hidden one | |
| (a Jev call that records an item again, when two data centers race or KV writes ran out) | 0 | 0 | |
| Hit for an item whose record failed | up to 1 | 6, 7 for an honorary ruling, or 2 for a hidden one | Once per item |
| Any other hit, prefetch hits included | up to 1 | 0 | At most 100,000 Functions requests a day |
| Prefetch miss | 0 | 0 | |
| Lists refresh, empty table | up to 4 | 0 | Once per data center per 120 seconds |
| Lists refresh, 1,000 rulings on file | about 83 (32 for the four lists, 50 for the activity count, 1 for the switch) | 0 | |
| `pnpm recent`, 30 rows | about 36 to 41 | 0 | By hand |
| `pnpm recent --block`, `--unblock` or `--lists` | up to 3 | 1 | By hand |
| `pnpm recent --prune --yes` | the rows it counts, then the rows it deletes | up to 14,000 per run | By hand |
| Migration 0008 | about 7 per ruling on file | 3 per listed ruling, 4 per listed honorary one | Once |
| Seeding the 188 listed question set 7 eval rulings | 0 | about 1,160: 6 per ruling, 7 for each of the 29 honorary ones | Once |
| Backfilling foods from earlier question sets | 0 | 6 per food, 7 for an honorary one, 2 for a hidden one | Once |

At the default limit of 1,000 Jev calls a day, writes top out around 16,000 of the 100,000 a day, plus the session cleanup described in [Rate limiting and spend](#rate-limiting-and-spend). One ask lists a ruling, so hits and repeat Jev calls for a recorded item write nothing. Hits read 1 row each, so the Functions request cap bounds them at 100,000 reads. A lists refresh reads at most about 83 rows, so reads stay under 5 million until about 60,000 refreshes a day. That would take about 85 data centers, each serving the lists to someone every 2 minutes, all day. `functions/_lib/rulings.test.ts`, `functions/_lib/lists.test.ts` and `scripts/recent.test.mjs` fail if a recording, list, `pnpm recent` listing or prune statement falls back to a table scan. Only `--blocklist` reads its whole (small) table.

KV on the Free plan allows 1,000 writes and 1,000 list operations a day, and every Jev call writes one entry. A one-off KV write such as the seed must fit beside the day's Jev calls: keep today's `usage.calls` plus the one-off writes under 900.

Storage per 1,000 rulings, indexes included, measured in SQLite with random names:

| Item length | None public | Half public | All public |
| --- | --- | --- | --- |
| 12 characters | 160 KB | 206 KB | 249 KB |
| 16 characters | 176 KB | 226 KB | 278 KB |
| 30 characters | 224 KB | 300 KB | 375 KB |
| 60 characters (the maximum) | 333 KB | 459 KB | 590 KB |

The table is `WITHOUT ROWID`, so every index repeats the item, and a public row sits in six places, seven for an honorary ruling. At 1,000 new rulings every day, typical food names grow the database by about 60 to 100 MB a year, and 60 character names that all go public by about 215 MB a year, against 500 MB per database. Rows from other question sets are never read by the lists, and `pnpm recent --prune` deletes them.

> [!WARNING]
> Once the database reaches 500 MB, every write fails. The spend check then throws, so every new ruling is refused with a 500 until rows are deleted. Cached rulings keep working. Watch **D1 > cube-rule-oracle > Metrics** for the database size, and prune old question sets well before it gets close.

### Functions requests

The Cache API saves D1 reads, not Function invocations. Pages never serves a Function response from its CDN, so every `/api/lists` request runs the Function, edge copy or not, and so does every `/api/classify` request, cached ruling or not. Only the browser's own copy saves a request.

- A page view that scrolls to the docket costs about one Function request for `/api/lists`. The browser reuses its copy for 2 minutes.
- Each docket link a visitor hovers or focuses for the first time costs one `/api/classify` prefetch, and so does each gallery or hero link. A click on a food the browser already holds costs nothing.
- Neither kill switch saves requests: `/api/lists` still answers, only with empty lists.

So on a busy day the 100,000 Functions requests a day run out long before any D1 limit. At that point Pages fails open and the SPA shows "The oracle is swamped." until midnight UTC (see [Rate limiting and spend](#rate-limiting-and-spend)).

## Web Analytics

Cloudflare Web Analytics counts page views, visits, referrers, countries and Core Web Vitals without cookies or local storage. It is free and uses no Functions quota, because the beacon never touches `/api`.

To turn it on:

1. In the dashboard, open **Workers & Pages > cube-rule-oracle > Metrics > Web Analytics** and choose **Enable**.
2. Redeploy with `pnpm deploy:pages`. Pages injects the beacon into `index.html` only on the next deployment.
3. Check it in a real browser: DevTools should show `beacon.min.js` loading from `static.cloudflareinsights.com` and a request to `cloudflareinsights.com/cdn-cgi/rum`. `curl` and `wrangler pages dev` never see the injected tag.

The CSP in `public/_headers` already allows exactly those two hosts: `https://static.cloudflareinsights.com` in `script-src` and `https://cloudflareinsights.com` in `connect-src`. It names the host rather than the script's URL because the injected path is versioned (`/beacon.min.js/v...`), and `functions/static-headers.test.ts` pins both.

> [!NOTE]
> Pages injects the beacon on every host it serves, so previews (`<hash>.cube-rule-oracle.pages.dev`) are counted too. Filter by **Host** in the dashboard to see production only.

Web Analytics never logs query strings, so the foods people look up (`/?food=...`) never reach it, and every lookup counts under the path `/`. Ad blockers block the beacon, so it undercounts.

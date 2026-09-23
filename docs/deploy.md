# Deploying Cube Rule Oracle

The app is one Cloudflare Pages project, `cube-rule-oracle`, built from `apps/web`, shared at https://cube-rule-oracle.pages.dev (also reachable at https://typesafe-ai-cube-rule.codyswartz.us):

- `apps/web/dist`: the Vite SPA, served as free static assets.
- `apps/web/functions/api/classify.ts`: a Pages Function for `GET /api/classify`. It holds the TypeSafe key and calls Jev.
- `apps/web/functions/api/session.ts`: `POST /api/session`, which trades a Turnstile token for a signed session cookie.
- `apps/web/migrations/`: the D1 schema for the spend caps (binding `DB`).
- `apps/web/public/_routes.json` limits Function invocations to `/api/*`, so page loads never count against the Functions quota.
- `apps/web/public/_headers` sets the CSP and other security headers on static assets. Pages never applies `_headers` to Function responses, so the Function sets its own.

All wrangler commands below run from `apps/web`, where `wrangler.jsonc`, `functions/` and `migrations/` live. `pnpm --filter @cube/web exec wrangler ...` works from the repo root too.

## How the paid path is protected

Every uncached ruling calls Jev, about $0.0004 each. Cached rulings stay free and never see a challenge.

1. `GET /api/classify` checks the edge cache, then KV. A hit is served straight away, with no cookie needed.
2. On a miss it needs a valid `cube_session` cookie. Without one it answers `401 challenge_required`, unless today's budget or this client's is already spent. Then it answers `503 daily_limit` or `429 client_limit` straight away, after one statement that reads today's `usage` row and the client's row by primary key, so nobody solves a check that can only end in a refusal. That read is only a shortcut: a failed read falls through to the challenge, and the atomic charge in step 6 stays the real guard.
3. The SPA then loads Turnstile from `challenges.cloudflare.com` (only now, never on page load), runs an interaction-only widget with the action `session`, and posts the token to `POST /api/session`.
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
| `DB` | `d1_databases` in `wrangler.jsonc` | The spend-cap database. Unbound, the caps are skipped with one warning per isolate. |
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

By hand, with curl against a running `pages dev` (`v` must be the current `QUESTION_SET_VERSION`):

```sh
curl -si "http://localhost:8788/api/classify?food=kimchi+quesadilla&v=6"            # 401 challenge_required
curl -si -c jar -H 'content-type: application/json' \
  --data '{"token":"XXXX.DUMMY.TOKEN.XXXX"}' http://localhost:8788/api/session      # 204, Set-Cookie
curl -si -b jar "http://localhost:8788/api/classify?food=kimchi+quesadilla&v=6"     # 200, X-Cube-Cache: MISS
curl -si "http://localhost:8788/api/classify?food=kimchi+quesadilla&v=6"            # 200, X-Cube-Cache: HIT, no cookie
```

Read the local counters with `pnpm exec wrangler d1 execute cube-rule-oracle --local --command "SELECT * FROM usage"`.

## One-time setup

1. Log in to the personal Cloudflare account and confirm the account id matches the one pinned in `scripts/deploy.sh`:

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

2. Create the Pages project. Note the `*.pages.dev` hostname it prints. The rest of this page assumes `cube-rule-oracle.pages.dev`; use the printed one if it differs.

   ```sh
   pnpm exec wrangler pages project create cube-rule-oracle --production-branch main
   ```

3. Create the KV namespace that keeps rulings across data centers, then paste its id into `apps/web/wrangler.jsonc` and uncomment the `kv_namespaces` line:

   ```sh
   pnpm exec wrangler kv namespace create CLASSIFICATIONS
   ```

   Production needs it, and `scripts/deploy.sh` refuses to run without the binding. Without KV a ruling lives only in the edge cache of the data center that asked, so a visitor elsewhere gets the human check and a second billed Jev call for the same food. Local dev binds a local namespace either way.

4. Create the D1 database, put its id in place of the zero placeholder `database_id` in `apps/web/wrangler.jsonc`, and apply the migrations:

   ```sh
   pnpm exec wrangler d1 create cube-rule-oracle
   pnpm exec wrangler d1 migrations apply cube-rule-oracle --remote
   ```

   `scripts/deploy.sh` refuses to run while the placeholder is there or while a migration is unapplied. `wrangler.jsonc` is the source of truth for Pages bindings, so do not add the binding in the dashboard.

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
- `apps/web/wrangler.jsonc` has a real D1 `database_id` and an uncommented `CLASSIFICATIONS` KV binding
- the working tree is clean and on `main`
- `wrangler whoami` lists the pinned account (`CLOUDFLARE_ACCOUNT_ID` is exported, so the deploy cannot land anywhere else)
- the project has the `TYPESAFE_API_KEY`, `TURNSTILE_SECRET_KEY` and `SESSION_SECRET` secrets
- the remote D1 database has no unapplied migrations
- `pnpm check` passes

It then builds the SPA with the sitekey and runs `wrangler pages deploy dist --project-name cube-rule-oracle --branch main` from `apps/web`.

> [!IMPORTANT]
> Apply new migrations to the remote database before the next deploy. Since v1.0.0 that is `0003_cleanup_indexes.sql`, `0004_usage_input_tokens.sql` and `0005_usage_token_calls.sql`:
>
> ```sh
> pnpm exec wrangler d1 migrations apply cube-rule-oracle --remote
> ```
>
> `scripts/deploy.sh` refuses to deploy while any migration is unapplied. Migrations are additive, so the running deployment keeps working after they land.

> [!IMPORTANT]
> Deploy from `apps/web`, never with `wrangler pages deploy apps/web/dist` from the repo root. Wrangler looks for `functions/` and `wrangler.jsonc` in its working directory. From the root it would upload the SPA without the API.

The build bakes absolute `og:url` and `og:image` URLs into `index.html` from `SITE_URL`, which defaults to `https://cube-rule-oracle.pages.dev`, the official URL. To make the custom domain official instead, change the default in `scripts/deploy.sh`, or override it for one deploy with `SITE_URL=https://typesafe-ai-cube-rule.codyswartz.us pnpm deploy:pages`.

Tail production logs with `pnpm exec wrangler pages deployment tail --project-name cube-rule-oracle`. Refused spend checks log `classify: daily Jev call limit reached` and `classify: spend check failed`. A wrong or rotated `TURNSTILE_SECRET_KEY` logs `session: siteverify refused TURNSTILE_SECRET_KEY` at error level, and visitors see "Something broke on our side" instead of a failed human check.

## Custom domain (DNS at DigitalOcean)

The custom domain, `typesafe-ai-cube-rule.codyswartz.us`, is a subdomain of a zone whose DNS stays at DigitalOcean. Pages accepts an external CNAME for a subdomain, so the zone does not need to move to Cloudflare.

1. **Cloudflare first.** Attach the hostname to the Pages project. Wrangler's own login token carries the Pages scope, and this keeps it out of the terminal:

   ```sh
   pnpm exec wrangler auth token --json |
     node -e 'process.stdout.write(`Authorization: Bearer ${JSON.parse(require("node:fs").readFileSync(0, "utf8")).token}`)' |
     curl --fail-with-body --header @- \
       "https://api.cloudflare.com/client/v4/accounts/00000000000000000000000000000000/pages/projects/cube-rule-oracle/domains" \
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

D1 migrations do not roll back with a deployment. Keep them additive so an older deployment still runs against the newer schema.

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
| Free plan request cap | 100,000 Functions requests a day, shared with Workers | With Fail open, `index.html` with a 200 until midnight UTC, shown as "The oracle is swamped." |

The in-code limiter is a speed bump, not a quota: each location runs many isolates and they restart often. The D1 caps are the real limits, because D1 is one database with serialized writes.

D1 on the Free plan allows 100,000 rows written and 5 million rows read a day, with limits resetting at 00:00 UTC. A Jev call writes four rows (the session, the client, the day and the day's token count), so 1,000 calls use 4,000 writes. Starting a session also deletes expired session rows and past days' client rows. Migration 0003 indexes `sessions.exp` and `clients.day`, so that cleanup reads only the rows it deletes instead of scanning both tables on every human check; `functions/_lib/usage.test.ts` fails if any spend-cap statement goes back to a table scan. Each index costs one extra row write when a session or client row is created. If D1 itself hits its daily limit, the spend check fails and new rulings are refused until midnight UTC, which is the safe direction.

Other levers:

1. **Kill switch.** Set `DAILY_CALL_LIMIT` to `"0"` in `wrangler.jsonc` and deploy. Every cached ruling keeps working.
2. **Provider budget.** Use any spend cap or alert the TypeSafe console offers for the key. Revoking the key there is the fastest stop that needs no deploy: the Function then returns `502 upstream_error` for new items while cached rulings keep working.
3. **Not available on this setup.** The Workers Rate Limiting binding (`ratelimits`) is rejected in a Pages config, and WAF rate limiting rules need the zone on Cloudflare.

## Watching spend

`pnpm spend` prints the Jev spend from the production D1 counters. It only runs `SELECT`s, through `wrangler d1 execute cube-rule-oracle --remote` from `apps/web`, with `CLOUDFLARE_ACCOUNT_ID` pinned to the same account as `scripts/deploy.sh`. The daily query reads at most 31 rows; `--detail` also reads today's client rows and the live session rows, through the migration 0003 indexes.

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

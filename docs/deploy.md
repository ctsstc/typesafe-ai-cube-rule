# Deploying Cube Rule Oracle

The app is one Cloudflare Pages project, `cube-rule-oracle`, built from `apps/web`:

- `apps/web/dist`: the Vite SPA, served as free static assets.
- `apps/web/functions/api/classify.ts`: a Pages Function for `GET /api/classify`. It holds the TypeSafe key and calls Jev.
- `apps/web/public/_routes.json` limits Function invocations to `/api/*`, so page loads never count against the Functions quota.
- `apps/web/public/_headers` sets the CSP and other security headers on static assets. Pages never applies `_headers` to Function responses, so the Function sets its own.

All wrangler commands below run from `apps/web`, where `wrangler.jsonc` and `functions/` live. `pnpm --filter @cube/web exec wrangler ...` works from the repo root too.

## Local development

| Command | What it runs |
| --- | --- |
| `pnpm dev` | The Function on http://localhost:8788 and Vite on http://localhost:5173. Vite proxies `/api` to 8788. |
| `pnpm dev:functions` | Only the Function (plus `apps/web/public`) on 8788. |
| `pnpm preview:pages` | Builds the SPA, then serves `dist` and the Function together on 8788, with `_headers` and `_routes.json` applied. The closest thing to production. |

`scripts/pages-dev.sh` symlinks `apps/web/.dev.vars` to the root `.env` the first time it runs. Wrangler reads local secrets from `.dev.vars`, so the key stays in one gitignored file and Vite never reads it. With no key (or an empty one) the Function serves mock rulings marked `"mock": true` and `Cache-Control: no-store`.

Local runs also bind a local KV namespace (`--kv CLASSIFICATIONS`) and a local Cache API, both stored under `apps/web/.wrangler/state` (gitignored).

## One-time setup

1. Log in to the personal Cloudflare account and confirm the account id matches the one pinned in `scripts/deploy.sh`:

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

2. Create the Pages project:

   ```sh
   pnpm exec wrangler pages project create cube-rule-oracle --production-branch main
   ```

3. Create the KV namespace that keeps rulings across data centers, then paste its id into `apps/web/wrangler.jsonc` and uncomment the `kv_namespaces` line:

   ```sh
   pnpm exec wrangler kv namespace create CLASSIFICATIONS
   ```

   KV is optional. Without it the Function still works, backed by the per data center Cache API only.

4. Store the TypeSafe key as a production secret. Wrangler prompts for the value, so it never lands in shell history:

   ```sh
   pnpm exec wrangler pages secret put TYPESAFE_API_KEY --project-name cube-rule-oracle
   ```

   Preview deployments get no key, so they serve mock rulings. That is deliberate.

5. In the dashboard, under **Workers & Pages > cube-rule-oracle > Settings > Runtime > Fail open / closed**, choose **Fail open**. If the Free plan's daily Functions allowance runs out, the site keeps loading. The API breaks until midnight UTC instead of the whole site.

## Deploying

```sh
pnpm deploy:pages
```

`scripts/deploy.sh` refuses to run unless all of these hold:

- the working tree is clean and on `main`
- `wrangler whoami` lists the pinned account (`CLOUDFLARE_ACCOUNT_ID` is exported, so the deploy cannot land anywhere else)
- the project has a `TYPESAFE_API_KEY` secret, because without it production would serve mock rulings
- `pnpm check` passes

It then builds the SPA and runs `wrangler pages deploy dist --project-name cube-rule-oracle --branch main` from `apps/web`.

> [!IMPORTANT]
> Deploy from `apps/web`, never with `wrangler pages deploy apps/web/dist` from the repo root. Wrangler looks for `functions/` and `wrangler.jsonc` in its working directory. From the root it would upload the SPA without the API.

The build bakes absolute `og:url` and `og:image` URLs into `index.html` from `SITE_URL`. It defaults to `https://cube-rule-oracle.pages.dev`. Once the custom domain is live, change the default in `scripts/deploy.sh`, or run `SITE_URL=https://oracle.example.com pnpm deploy:pages`.

Tail production logs with `pnpm exec wrangler pages deployment tail --project-name cube-rule-oracle`.

## Custom domain (DNS at Porkbun)

The share URL is a subdomain of a domain whose DNS stays at Porkbun. Pages accepts an external CNAME for a subdomain, so the zone does not need to move to Cloudflare.

1. **Cloudflare first.** In **Workers & Pages > cube-rule-oracle > Custom domains**, select **Set up a domain** and enter the full hostname, for example `oracle.example.com`.

   > [!WARNING]
   > Adding the CNAME at Porkbun before this step makes the hostname answer with Cloudflare error 522.

2. **Then Porkbun.** Under **Domain Management > DNS**, add a record:

   | Type | Host | Answer | TTL |
   | --- | --- | --- | --- |
   | `CNAME` | `oracle` | `cube-rule-oracle.pages.dev` | `600` |

   The host field takes only the subdomain label. Porkbun appends the domain.

3. Wait for the domain to show **Active** in the Pages dashboard. Cloudflare validates the CNAME and issues the certificate itself.

4. **CAA.** If the apex domain has CAA records at Porkbun, certificate issuance fails until they allow Cloudflare's CAs. Add `0 issue` records for `letsencrypt.org`, `pki.goog; cansignhttpexchanges=yes` and `ssl.com`. With no CAA records at all, nothing needs to change.

5. Point `SITE_URL` at the new hostname (see [Deploying](#deploying)) and redeploy so link previews use it.

`_headers` sends `X-Robots-Tag: noindex` on `*.pages.dev` hosts, so search engines index only the custom domain.

## Rollback

Every production deployment is a rollback target. In **Workers & Pages > cube-rule-oracle > Deployments**, open the menu on an earlier deployment and choose **Rollback to this deployment**. The switch is instant and needs no build.

To roll forward again, deploy a fixed commit with `pnpm deploy:pages`, or roll back to the newer deployment in the same list.

## Caching

A ruling is a pure function of the canonical URL `/api/classify?food=<item>&v=<QUESTION_SET_VERSION>`, and the Function returns 400 for any other spelling. So each billed Jev call maps to exactly one cache key:

1. **Browser**: `Cache-Control: public, max-age=31536000, immutable` on live rulings.
2. **Cache API** (`caches.default`): per data center. It works on both `*.pages.dev` and custom domains.
3. **KV** (`CLASSIFICATIONS`): global and durable, so a new data center fills from KV instead of calling Jev. The response header `X-Cube-Cache` reads `HIT`, `KV` or `MISS`.

Bumping `QUESTION_SET_VERSION` in `packages/core/src/questions.ts` changes every URL and KV key, which retires all cached rulings at once.

KV on the Free plan allows 1,000 writes and 100,000 reads a day. Writes happen only on a Jev call, so the write limit caps new rulings stored per day, not rulings served. A failed write is logged and the ruling is still returned.

## Rate limiting and spend

Every Jev call costs money, so the Function only calls Jev on a full cache miss. What else is available on Pages:

| Option | Status |
| --- | --- |
| Workers Rate Limiting binding (`ratelimits`) | Not available. Wrangler rejects `ratelimits` in a Pages config. It would need a separate Worker reached through a service binding. |
| WAF rate limiting rules | Not available. They need the zone on Cloudflare. Our DNS is at Porkbun, and `pages.dev` is Cloudflare's zone. |
| In-code limiter (shipped) | 20 Jev calls per minute per IP, counted in memory per isolate. Cache and KV hits and mock rulings are never limited. Over the limit the API answers `429 rate_limited` with `Retry-After`. |
| Free plan request cap | Functions share the Workers Free allowance of 100,000 requests a day. That also caps Jev calls at 100,000 a day. |

The in-code limiter is a speed bump, not a quota. Each Cloudflare location runs many isolates, and isolates restart often, so a determined client spread across locations gets more. It does stop one browser or script from looping new items through one location.

Spend guard ideas, cheapest first:

1. **Provider budget.** Use any spend cap or alert the TypeSafe console offers for the key. Revoking the key there is also the fastest kill switch. The Function then returns `502 upstream_error` for new items while every cached ruling keeps working.
2. **Daily counter in KV.** Count Jev calls under a key like `spend:2026-09-22` and refuse live calls past a limit. KV is eventually consistent and allows one write per key per second, so the count is approximate, and every call spends one of the 1,000 free daily writes.
3. **Durable Object counter.** A small Worker that owns a SQLite-backed Durable Object gives an exact global daily count. Pages binds to it with `durable_objects` and `script_name`. This is the right tool if the app goes viral, at the cost of a second deployable.

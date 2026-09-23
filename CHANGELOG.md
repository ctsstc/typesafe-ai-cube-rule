# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-23

### Added

- **How Jev rules.** A new section between the gallery and About, linked from the header and footer. It opens by saying the app is unofficial, then covers what a System One model is, the 16 typed questions in one request, confidence against probability, a cost and speed receipt, how the tune, holdout and canon piles are graded (with every leak into the questions disclosed), and honest limits. It loads as its own chunk and takes every number from `eval/results/v<QUESTION_SET_VERSION>/summary.json` at build time, so the build fails if the current question set's summary is missing, incomplete or scored on another model.
- **Credits.** The footer and About credit Cody Swartz (GitHub, LinkedIn), say the site was built with Claude Code, and link the source on GitHub.
- **"The oracle is swamped."** When the Free plan's Functions quota runs out and Pages fails open, answering `/api/*` with the SPA's HTML, the SPA says so instead of showing a broken ruling. `dev:mock` gains `mock swamped` to show it.
- **Spend report.** Each Jev call that reports usage adds its input tokens to the day's row and counts itself as recorded (migrations `0004_usage_input_tokens.sql` and `0005_usage_token_calls.sql`). `pnpm spend [--detail]` prints a read-only report from the production D1 counters: calls, share of the daily limit, input tokens and dollars per UTC day, then totals and the daily ceiling. Calls that recorded no tokens are estimated from the eval's average, and their day is marked `~`.
- **Web Analytics.** The deploy runbook covers turning on Cloudflare Web Analytics, which counts page views without cookies.
- **Open source.** An MIT license, a README for people who find the repo, and a CI workflow that runs `pnpm check` on pushes to main and on pull requests, with no secrets.

### Changed

- **Refusals before the human check.** A new food with no session gets `503 daily_limit` or `429 client_limit` straight away when the day or this network has already used its calls, and a spent session gets that refusal instead of a fresh check, so nobody solves a check that can only be refused. One statement reads both counters by primary key.
- **D1 indexes.** Migration `0003_cleanup_indexes.sql` indexes `sessions.exp` and `clients.day`, so the cleanup that runs with each new session reads only the rows it deletes. A test fails if any spend-cap statement goes back to a table scan.
- **Deploy.** `scripts/deploy.sh` also refuses to run until the GitHub repo the site links to is public. Migrations 0003 to 0005 must be applied to the remote database first.
- **Node.** `engines` and the README ask for an even-numbered Node release from 22.13 on (`^22.13.0 || ^24.0.0 || >=26.0.0`), since the tests use `node:sqlite` and Vitest does not support 23 or 25.
- About's privacy list says Cloudflare Web Analytics counts page views without cookies or personal data, in place of "no analytics scripts".
- CLAUDE.md drops machine details, and `.gitignore` covers Claude Code worktrees and local settings.

### Fixed

- The home page no longer scrolls sideways on 320px phones. A long word in the daily question pushed the title column past the screen edge; the title now hyphenates and the column can shrink.
- About no longer says people wrote every word on the page. The words are templates in our code, filled in from Jev's numbers.
- Opening `/#about` or `/#how-jev-rules` directly scrolls to that section. The scroll waits for How Jev rules to render, so About lands in view on Safari before 27, which has no scroll anchoring.
- A response whose body drops mid-download shows the network or offline panel instead of "Something broke on our side", and a body that stalls ends at the 10 second timeout instead of hanging.
- The deploy runbook no longer tells a fork to uncomment a KV line or replace a zero placeholder, and the README names every file that pins the owner's Cloudflare account.

### Security

- The CSP adds only the two hosts Web Analytics needs, `https://static.cloudflareinsights.com` in `script-src` and `https://cloudflareinsights.com` in `connect-src`, and `static-headers.test.ts` now pins the remote sources each directive allows.

## [1.0.0] - 2026-09-22

First production release, live at https://cube-rule-oracle.pages.dev.

### Added

- Production Cloudflare Pages deployment with the Turnstile widget, the D1 spend-cap database, the KV ruling store and the TypeSafe, Turnstile and session secrets.
- The custom domain `typesafe-ai-cube-rule.codyswartz.us`, a CNAME at DigitalOcean, serves the same site.

### Changed

- `cube-rule-oracle.pages.dev` is the official URL: builds bake it into the canonical and Open Graph tags, and only per-deploy preview hosts send `noindex`.

## [0.2.0] - 2026-09-22

### Added

- **Human check for new foods.** A food nobody has asked about needs a `cube_session` cookie. Only then does the SPA load Cloudflare Turnstile (never on page load), run an interaction-only check, and trade the token at the new `POST /api/session` for a signed, HttpOnly cookie that lasts an hour. Foods already ruled are served with no check.
- **Spend caps in D1.** Every Jev call is counted against the session (60), the client IP address for the UTC day (150, keyed by an HMAC of the IP and the date, so no IP is stored) and the whole day (`DAILY_CALL_LIMIT`, default 1000). A refusal gives back what it already charged. Migrations `0001_spend_caps.sql` and `0002_client_caps.sql`.
- **New error codes and states.** `challenge_required` (401), `not_found` (404), `method_not_allowed` (405), `stale_client` (409), `client_limit` (429) and `daily_limit` (503), plus the client-only `challenge_skipped`. The SPA gives the reset time in local time, offers a reload to a tab from an older deploy, and says "Skipped the quick check." after Not now.
- **Cache-only prefetch.** Hovering or focusing a food link sends `X-Cube-Prefetch: 1`. The Function serves stored rulings and answers a miss with 204, so a hover never starts the check or spends a Jev call.
- **Local tooling.** `pnpm dev:challenge [pass|fail|interactive|spent] [--preview]` runs the stack with Cloudflare's Turnstile test keys. `dev:mock` gains `mock challenge`, `mock daily`, `mock client` and `mock stale`, and accepts any token on `/api/session`.
- **Eval.** The set grows to 204 items with 21 abusive probes stored base64-encoded, rude-sounding real dishes and abstract phrases. The report gains an abuse guard section, and the runner gains `--split` and `--max-usd`.
- **Docs.** A canon audit (`docs/canon-audit.md`), and a deploy runbook for Turnstile, the session secret, D1, KV and the custom domain at DigitalOcean.

### Changed

- **Question set 6.** `is_abusive` no longer lets a food word excuse abusive words unless the whole phrase is a real dish, abstract phrases count as not food and get honorary rulings, and the lobster roll gloss no longer says bun. Tune 95/97, holdout 60/62, canon 45/45. The version bump retires every cached ruling on deploy.
- **Thresholds.** The abuse guard declines at 0.5 instead of 0.85 (21/21 abusive probes caught, 0/183 false declines). `majority` is 0.5, `rice` 0.4 and `dependsOnServing` 0.5, and new interior bars of 0.6 and 0.4 read the block, middle layer and loose pieces Nouls.
- **Deep links lead with the ruling.** Once a ruling shows, its heading is the page h1 and the hero compacts to the form. The daily question appears only when the ruling is about its food.
- **Canon.** Audited against cuberule.com: the bare "sub sandwich" alias is gone, and the vanilla soy latte, muffin and humans notes use the site's wording.
- **Gallery.** Nachos is drawn as a smaller starch cube inside, and the sushi and nachos summaries match the drawings.
- **CSP.** `https://challenges.cloudflare.com` is allowed in `script-src` and `frame-src` only.
- **Deploy.** `scripts/deploy.sh` defaults `SITE_URL` to the share URL and refuses to run without a production Turnstile sitekey, the three secrets, a real D1 id with every migration applied, and a KV binding.
- **Copy.** The check card, About and the daily limit panel say foods someone already asked about *usually* skip the check, since KV's daily write quota and per data center caches cannot promise always.

### Fixed

- Deep-link text is never shown before Jev clears it: not after Back to an entry whose ruling failed, not when an in-page anchor fires `popstate`, and not for a link with no letters, which now reads "That link has no food in it."
- In-page anchors no longer wipe the input, replay a finished reveal or retry a 429 panel on their own.
- The check card goes away when the ruling it was for does, gives focus back when it closes, and no longer sits under "Jev is usually faster than this".
- The check card scrolls inside short viewports instead of losing its title above the screen.
- The error title is an h2 under the h1 ruling heading.
- The daily limit title names the local reset time when it falls later the same day, instead of always saying tomorrow.
- A tab left open across a deploy gets a reload prompt instead of "That doesn't look like a food name."
- A refused call no longer uses up the session, which used to send visitors through another check only to be told the oracle was resting.
- Siteverify answers within an 8 second deadline, so its error reaches the SPA before the browser's 10 second timeout. It retries `internal-error`, and a refused secret shows as our fault instead of a failed check.
- A 200 missing any answer is never cached, and the card shows an error instead of loading forever.
- The muffin clause chip needs the 0.7 face bar again, so flat fried dough no longer reads as "raw and unsliced".
- The 429 body no longer contradicts its countdown, the gallery no longer jumps as it renders, and the no-JavaScript fallback credits the Cube Rule.
- The in-memory rate limiter forgets an IP once its window ends, as About says.

### Security

- The Vite dev server no longer serves `apps/web/.dev.vars`, a symlink to the root `.env` holding the TypeSafe key, to other pages on localhost.
- New rulings are gated behind Turnstile and the D1 caps, so a script cannot run up the Jev bill, and one client cannot spend the whole day's budget. The Function fails closed when the session secret is missing or the spend check fails.
- The session cookie is signed with HMAC-SHA256, HttpOnly, `SameSite=Strict` and scoped to `/api`, and the per-client count stores only a keyed, daily-rotating hash of the IP.

## [0.1.0] - 2026-09-22

### Added

- **Rulings.** Type any food and TypeSafe's Jev model (`jev-1.13.0`) rules which of the nine Cube Rule categories it belongs to, from where its structural starch sits. One request asks 16 typed questions and returns probabilities, which the browser turns into a ruling.
- **Ruling card.** A verdict stamp, all nine probabilities, confidence copy from unanimous to baffled, and chips for starch, wet foods, "depends how it's served", the rice clause, the muffin clause and debate heat.
- **Canon.** Foods that cuberule.com has already ruled on show a canon badge, and Jev's disagreement appears as a dissent.
- **Other result kinds.** Honorary rulings for things that are not food, an "uncubeable" card for gibberish and instructions, and a declined card for abusive text that keeps the text out of the card, the page title and the URL.
- **CSS 3D cube.** Starch faces and open faces for every category, with a bake-in and stamp animation that reduced motion swaps for a short fade.
- **Home page.** A daily hero question, example foods, Surprise me, and shareable `?food=` links with Web Share and copy link.
- **Gallery and about.** The nine cubes with canon examples; an about section with credits to the Cube Rule's creator and cuberule.com, how Jev decides, and exactly what is sent and stored where.
- **Theming and accessibility.** Light, dark and system themes applied before first paint, WCAG AA contrast checked in tests, axe checks on every card state, keyboard focus management and a live region for results.
- **Link previews.** A static Open Graph card, favicon and touch icon.
- **Pages Function.** `GET /api/classify` validates the canonical query, calls Jev with a 9 second budget and one retry, and maps failures to typed errors (400, 429, 502, 503, 504, 500). Live rulings are cached immutably in the edge cache and optional KV, and a per isolate rate limiter slows looping clients.
- **Mock mode.** Without a key the Function serves deterministic simulated rulings, and the app shows a demo banner and a Simulated stamp. `pnpm --filter @cube/web dev:mock` adds trigger foods for every UI state without wrangler.
- **Security headers.** A self-only Content Security Policy, HSTS, frame and referrer policies on static assets, and `noindex` on `*.pages.dev`.
- **Evaluation.** A 156-item labelled dataset with tune, holdout and canon splits, a cached and reproducible `pnpm eval` harness, and reports for question sets 2 to 5. Question set 5 scores 66/67 on tune, 42/44 on holdout and 45/45 on canon.
- **Tooling.** `pnpm dev` runs Vite and `wrangler pages dev` together, `pnpm preview:pages` serves the production build with its Function and headers, and `pnpm deploy:pages` runs a guarded production deploy.
- **Docs.** README, question design, eval, UX spec and a Cloudflare Pages deploy runbook.

### Security

- The TypeSafe key stays server side. A test fails if the production bundle contains the TypeSafe API host, the SDK, question text or source maps, and the Function never logs the key, upstream messages or the food name.

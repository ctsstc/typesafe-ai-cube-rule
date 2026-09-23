# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-09-23

v1.3: "Honorary court". One ask is enough to list a food, so the docket fills up at the site's real traffic.

> [!IMPORTANT]
> Run `pnpm migrate:remote`, then `pnpm deploy:pages`, then `pnpm seed:docket` (a dry run) and `pnpm seed:docket --apply`. Migration `0008_one_ask_honorary_court.sql` adds the one-ask list indexes beside v1.2's, so the deployment live now keeps reading its lists until the deploy, and a rollback to v1.2 still works. Rows v1.2 recorded after a single ask go public with this deploy, so read `pnpm recent` first and block anything that should stay private.

### Added

- **Honorary court.** A docket card for honorary rulings on things that are not food, Jev's most confident first, one ruling per cube so abstract phrases ruled salad cannot fill it. Each line reads as the verdict's adverb and the honorary cube ("definitely honorary salad", or "officially honorary calzone" for a canon ruling), without the Honorary marker the other lists show. `/api/lists` sends it as `honoraryCourt`, read through the new `rulings_honorary` index.
- **`pnpm seed:docket`.** Owner-only, and a dry run until `--apply`. It records the 174 question set 7 eval rulings that pass `publicListing` (of 251, 29 of them honorary) through the Function's own `recordRuling`, first seen at their eval fetch time, and stores each in KV, so clicking one needs no human check or Jev call. Encoded abusive probes and anything the gates hide are never written. `--backfill` re-asks Jev with the current questions about foods stored under earlier question sets in KV, about $0.0004 each and capped by `--max-usd` (default $0.05). Each answer is recorded the way the Function records a Jev call, listed or not, first seen at 00:00 UTC that day, and added to the day's `usage` row. It refuses when its KV writes would pass 900 minus today's Jev calls, when a ruling would count as new in the last hour, or over `--max-usd`, and warns when a full day of Jev calls at `DAILY_CALL_LIMIT` could still take KV past its 1,000 writes. `--local` and `--persist-to` run it against a local D1 and KV.
- **Migration 0008** adds `rulings_latest1`, `rulings_debated1` and `rulings_heat1` (listed, one ask or more) and `rulings_honorary`. It keeps v1.2's four list indexes, which rows with one ask never enter, so it costs no extra writes. Drop them in a later migration only once v1.2 is no longer a rollback target.

### Changed

- **One ask lists a ruling.** `MIN_ASKS` drops from 2 to 1, so the Jev call that first rules on a food lists it if it passes the screens. Hits on a recorded food now write nothing.
- **Every list shows from one entry,** and the docket hides only when every list is empty, off or failing.
- **Jev vs the canon is gone.** Honorary court takes its place.
- **About** says a food can show up the first time anyone asks about it if it passes the checks, and that the lists started with foods from our own testing and foods people had already asked about, some from before the lists existed. The lists still never show who asked or when.
- **`pnpm recent`** drops the Asks column, which only ever read 1, and its footer says a public ruling was asked at least once. A prune batch is budgeted at up to 11 row writes a deleted row, about 22,000 a run, because a v1.2 row with two asks also sits in v1.2's indexes.
- `dev:mock` gains honorary entries, and `CUBE_MOCK_LISTS` takes `full|busy|one|empty|disabled|error`: `busy` shows the capped activity line and `one` a single ruling, in place of `dissent` and `partial`.
- The eval report counts what each list could hold from one ask, Honorary court included, and the question set 7 report and summary are rescored from the cache with no new inference.
- The README, design doc, eval notes, UX spec and deploy runbook describe one ask and Honorary court. The runbook adds seeding and backfill, a D1 budget remeasured for one ask, the KV headroom on seed day, and what a tab still running v1.2 does with the renamed lists.

### Fixed

- The seed skips the eval's person probes that are not foods (my family, taylor swift), so Latest never opens with test inputs. Foods named after people still seed.
- **The docket shows at the site's real traffic.** v1.2 listed a food only after two browsers asked for it and showed a list only from three entries, so with a few visitors nothing ever appeared. Jev vs the canon could never fill at all, because Jev agrees with all 45 canon rulings in the question set 7 eval: most canon names are worked examples in its questions.

### Security

- **No second ask stands behind the screens.** The person, abuse and personal info gates decide what is listed and are rechecked on every read. The blocklist and the kill switch (`pnpm recent --block` and `pnpm recent --lists off`) are the backstops, and the README and design doc now say so instead of promising two asks.
- The seed writes only rulings the gates list, to D1 and KV alike, and never an encoded abusive probe. Backfilled foods pass through the same gates as a live ruling, so the hidden ones show only in `pnpm recent --flagged`, in the owner's terminal.

## [1.2.0] - 2026-09-23

v1.2: "The docket", public lists that make the site feel lived in without showing who asked.

> [!IMPORTANT]
> Run `pnpm migrate:remote` before `pnpm deploy:pages`. Migrations `0006_rulings.sql` and `0007_listing_checks.sql` add the `rulings`, `blocklist` and `switches` tables. Both are additive, so the deployment live now keeps working against the new schema. Question set 7 retires every cached ruling, so each food costs one Jev call again the first time it is asked.

### Added

- **The docket.** A section between the gallery and How Jev rules with a strip of Latest rulings and cards for Most debated, Jev vs the canon and Friendship-ending. Entries are food links that rule through the normal flow, honorary rulings carry an "Honorary" marker, and no entry shows a time. "N new foods ruled in the last hour." appears only when enough listable foods arrived, and reads "50+" at the cap, so a quiet hour shows nothing. A list shorter than three entries is hidden, except Jev vs the canon, which shows from one because Jev agrees with every canon ruling in the eval. The section loads as its own chunk once the reader nears it, and only renders while it lands below what the reader is looking at, so a hash link or a fast scroll never pushes a section out of view.
- **`GET /api/lists?v=<QUESTION_SET_VERSION>`.** Serves the four lists (8 entries each at most) and the activity count from D1, cached for 120 seconds at the edge and in the browser. It needs no session, answers `409 stale_client` for another question set, and answers `{ "enabled": false }` for the kill switch, a missing database or any D1 error, never a 500.
- **Recording.** Every Jev ruling is recorded in the `rulings` table with Jev's pick, the official ruling, confidence, runner-up, debate level, the scores behind the listing bars, a capped ask count and when it was first seen. No IP, session or client key is stored. An item is listed only after 2 separate asks: the Jev call, then any edge cache or KV hit, hover prefetch hits included. A cache or KV hit also records a ruling whose record failed. Once an item has 2 asks its hits write nothing.
- **`person_kind`, question set 7.** A new Choice asks whether an item names nobody, a public figure or a private person. It only feeds the public lists. The eval grows to 251 items with 51 person probes, 16 of them invented full names inside food phrases (16 live calls, $0.0068). Tune is 123/125, holdout 79/81, canon 45/45, and no private person or abusive probe would be listed.
- **Listing gates** in `@cube/core` (`publicListing`, `listingScores`, `listingBar`, `hasPersonalInfo`, `toListEntry`) and the lists wire contract (`ListsResponse`, `ListEntry`, `listsUrl`, `LISTS_ACTIVITY_CAP`).
- **`pnpm recent`.** An owner-only view of recorded rulings with their status and, with `--flagged`, declined and hidden ones and their scores. `--block` and `--unblock` edit the blocklist, `--lists off|on` hides every list without a deploy, and `--prune [--yes]` counts, then deletes in batches of 2,000, rulings from other question sets.
- **Kill switches.** `PUBLIC_LISTS` in `wrangler.jsonc` and a D1 switch that `pnpm recent --lists off` flips. `ACTIVITY_THRESHOLD` (default 5, at most 50) sets when the activity line appears.
- `dev:mock` serves `/api/lists`, and `CUBE_MOCK_LISTS=dissent|partial|empty|disabled|error` shows the other states. The default mock uses Jev's real picks for canon items, so Jev vs the canon is hidden there as it usually will be in production.
- The eval report sweeps each person bar on its own and counts how many listed items each public list could hold.

### Changed

- **About** says what the public lists show, that a food needs two asks, that the lists never show who asked or a time, and that pattern rules and Jev's reading screen out private people, contact details and abusive text without catching everything. About now loads in its own chunk with How Jev rules, and `bundle.test.ts` fails the build if the initial JS passes 90,000 bytes gzipped.
- **The blocklist** is checked every time the lists are read, so blocking and unblocking take effect within about 4 minutes and need no deploy.
- **The deploy runbook** covers the public lists, the kill switches, `pnpm recent`, the measured D1 writes and storage per ruling, what happens when the database fills up, and the Functions requests the lists cost. Its curl walkthrough reads the current question set instead of hard-coding one.
- The README describes the 17 questions, the docket and the question set 7 eval.

### Fixed

- Setting `DAILY_CALL_LIMIT` to `"0"`, the documented kill switch, no longer turns `pnpm check` red and stops the deploy. The same holds for `PUBLIC_LISTS` set to `"off"`.

### Security

- **Nothing abusive or private is listed.** Declined and nonsense rulings are never listed. An item is hidden when it contains a phone number, email address, handle, URL or domain, spelled-out forms included ("jsmith [at] acme [dot] org", "eight six seven five three oh nine", "acme . com"). It is also hidden when Jev gives it a 0.05 chance or more of naming a private person, or is under 0.9 sure it names nobody or a public figure, which catches invented full names next to a dish. Any item Jev scores 0.05 or more on `is_abusive` is hidden unless cuberule.com has ruled on it.
- **Rechecked on every read.** `/api/lists` applies today's personal info rules and the current bars to every stored row, so tightening a threshold also hides rulings recorded before it. The browser drops malformed, declined or personal entries again before rendering.
- Declined text appears only in `pnpm recent --flagged`, in the owner's terminal.

## [1.1.2] - 2026-09-23

### Fixed

- `pnpm deploy:pages` works again. Pages rejects a custom Wrangler config path, so the deploy now copies the generated `wrangler.production.jsonc` over `wrangler.jsonc` for the upload only and restores the committed file on exit. v1.1.1 was tagged but never deployed because of this. A test fails if real KV or D1 ids are ever committed to `wrangler.jsonc`.

## [1.1.1] - 2026-09-23

### Changed

- **Privacy notes.** About's "What gets sent where" now matches what is collected. It says foods go in the page address, so they land in browser history and shared links. Stored rulings have no expiry date. Turnstile can load as soon as a shared link to a new food opens, and it sees the IP, browser and page address, food included. Old spend counters are deleted only when someone next passes the check, and a database restore can bring them back for up to 30 days. The rate limiter holds an IP only after a new food or a check. `cube_session` is the only cookie this site sets, and Turnstile's frame may keep its own. Web Analytics strips `?food=`. The list links the Cloudflare, Turnstile and TypeSafe privacy policies. The deploy runbook and UX spec match it, and a new About test pins the key facts.
- **Cloudflare ids stay out of the repo.** `scripts/deploy.sh` and `pnpm spend` read `CLOUDFLARE_ACCOUNT_ID` from the gitignored root `.env`. The committed `apps/web/wrangler.jsonc` keeps placeholder KV and D1 ids; `scripts/cloudflare-config.mjs` writes the real ones from `.env` into a gitignored `wrangler.production.jsonc`, which the deploy, `pnpm spend` and the new `pnpm migrate:remote` pass to wrangler. Git history was rewritten so earlier commits carry the placeholders too.

### Fixed

- The hash scroll test no longer fails at random when the whole suite runs at once.

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

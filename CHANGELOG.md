# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

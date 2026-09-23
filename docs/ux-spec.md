# Cube Rule Oracle: product experience spec

> Name a food. Find the starch. Accept the cube.

This spec covers what people see and do: screens, components, copy, visual system, motion, accessibility, sharing, and release phasing. The questions Jev answers and the thresholds that read them live in [question-design.md](question-design.md). Hosting lives in [deploy.md](deploy.md). This document says which answers the UI reads and how.

> [!IMPORTANT]
> Jev is a System One model. It returns numbers, never sentences. Every word the app shows is a template in our code, filled in from Jev's typed answers. No copy may be framed as something Jev "said" in its own words.

## 1. Product principles

1. **The cube is the hero.** A ruling is a picture before it is a number. People should want to screenshot it.
2. **Jev supplies numbers; we write every word.** Copy is chosen by code from `choice`, `probabilities`, `confidence`, `noul`, and `score`.
3. **Honest uncertainty is the joke.** "Jev is torn between taco and sandwich" is a feature, not an error state.
4. **Fast and free to repeat.** A static page plus one cached GET per food. The second person to ask about hot dogs costs nothing.
5. **Credit the source loudly.** This is an unofficial fan app. The Cube Rule is by @Phosphatide and cuberule.com is by @indirect. Both are credited in the footer of every view and in the about section.
6. **Accessible by default, motion as garnish.** Everything works by keyboard, screen reader, and with motion off.

## 2. Name, voice, tone

- **App name:** Cube Rule Oracle. In running copy, "the Oracle" is the app and **Jev** is the one who rules ("Jev is sure").
- **Voice:** a deadpan food court. Short declarative sentences, mock judicial vocabulary (ruling, dissent, canon, "the cube has spoken"), total confidence about absurd things. Never mean to the user.
- **Words we use:** ruling, starch, structural, open face, sealed, canon, dissent, torn, baffled.
- **Words we avoid:** "AI thinks", "generated", "hallucinate", anything that implies we are cuberule.com.
- **No emoji in UI copy.** The cube carries the personality, and screen readers read emoji names aloud.
- **Food names** display the normalized item in sentence case ("Hot dog", "Pop-tart"). Brand capitalization is not recoverable from a normalized query and we do not try.
- **No dashes as punctuation** anywhere in UI copy or docs. Split the sentence or use a colon.

### Verdict grammar

`toCubeResult` in `@cube/core` builds the headline from `VERDICT_ADVERBS` and `describeCategory`, so the grammar is always right:

| Result | Heading second line | Stamp |
|---|---|---|
| food, unanimous | "Definitely a taco." | TACO |
| food, majority | "Probably wet nachos." | WET NACHOS |
| food, split | "Arguably toast." | TOAST? (torn stamps add a ghost of the runner-up) |
| food, canon | "Officially a quiche." | QUICHE |
| honorary (not food) | "Not food. Probably." then "If it were food, it would probably be a calzone." | HONORARY CALZONE |
| nonsense | "Uncubeable." | UNCUBEABLE (dashed, muted) |
| declined | "Jev declines to cube that." (the food is never shown) | none |

The heading reads as one sentence to a screen reader: "Hot dog: Definitely a taco."

## 3. The nine cubes

`CATEGORIES` in `packages/core/src/categories.ts` is the single source. Cube Rule "sides" are the cube's left and right faces and "ends" are front and back, which makes a taco a U when you look into its open end.

| # | id | Starch faces | Interior | Family |
|---|---|---|---|---|
| 0 | salad | none | none | loose |
| 1 | toast | bottom | none | layered |
| 2 | sandwich | top, bottom | none | layered |
| 3 | taco | bottom, left, right | none | shell |
| 4 | sushi | top, bottom, left, right | none | shell |
| 5 | quiche | bottom, left, right, front, back | none | shell |
| 6 | calzone | all six | none | shell |
| 7 | cake | top, bottom | a middle layer | layered |
| 8 | nachos | none | a smaller starch cube | loose |

`examples` holds only rulings published on cuberule.com. The gallery shows the first three per category, and `exampleQuery()` turns qualifiers such as "sub sandwich (uncut)" into the name the canon lookup knows ("uncut sub sandwich"). A test checks that every example opens its own canon ruling.

**Hero angles** (`apps/web/src/lib/cube.ts`, tuned by eye):

| Category | rotateX | rotateY | Why |
|---|---|---|---|
| salad, calzone, nachos | -22deg | -38deg | classic three-quarter view |
| toast | -32deg | -30deg | look down at the base |
| sandwich, cake | -14deg | -35deg | side-on, so the slabs read |
| taco | -24deg | -14deg | look into the open end, so the U reads |
| sushi | -12deg | -22deg | look down the tube |
| quiche | -40deg | -30deg | look into the open box |

## 4. URLs and views

Single page. State lives in the query string. No router library.

| URL | View | Release |
|---|---|---|
| `/` | Home: hero, gallery, about | v0.1 |
| `/?food=hot+dog` | Home with the ruling for hot dog | v0.1 |
| `/?food=hot+dog&vs=sub+sandwich` | Settle the debate | v0.2 |
| `/is/taco/?food=hot+dog` | Same as `?food=`, served from a per-category HTML file with category OG tags | v0.2 |
| `/?play=daily`, `/?play=endless` | Guess the cube | v0.3 |
| `#gallery`, `#about`, `#about-mock` | In-page anchors | v0.1 |

- Submitting pushes a history entry. Back and forward restore earlier rulings from the in-memory cache without refetching.
- The `food` param goes through `normalizeItem()`. An empty result is ignored.
- `document.title` follows the view: `Hot dog: definitely a taco | Cube Rule Oracle`. While loading a typed food: `Hot dog | Cube Rule Oracle`. While loading a deep link: `Ruling | Cube Rule Oracle`. Declined: `Declined | Cube Rule Oracle`.
- A declined ruling replaces the URL with `/` so the text never sits in the address bar or a copied link.

## 5. Data the UI consumes

### Wire contract

The browser calls exactly one endpoint, built by `classifyUrl(item)` from `@cube/core`:

```
GET /api/classify?food=<normalizeItem(x)>&v=<QUESTION_SET_VERSION>
```

The Pages Function (`apps/web/functions/api/classify.ts`) accepts only that exact canonical query and answers:

| Status | Body | Cache-Control |
|---|---|---|
| 200 live | `{ model, answers }`, Jev's raw answers | `public, max-age=31536000, immutable` |
| 200 mock (no key) | `{ model: "mock", answers, mock: true }` | `no-store` |
| 400 / 429 / 502 / 503 / 504 / 500 | `{ error: { code, message } }` with code `bad_request`, `rate_limited` (plus `Retry-After`), `upstream_error`, `upstream_busy`, `timeout`, `internal` | `no-store` |

`X-Cube-Cache` reports `MISS` (asked Jev), `HIT` (edge cache), or `KV` (stored ruling). Nerd stats shows it.

The SPA runs `toCubeResult(item, body)` itself, so a copy or threshold change is a static redeploy with no new inference. `ClassifyResponse`, `ClassifyErrorBody`, and `CubeResult` are exported by `@cube/core`.

> [!CAUTION]
> The browser never imports `TypeSafeClient` or the question builders. `apps/web/src/bundle.test.ts` builds the SPA and fails if the output contains `api.typesafe.ai`, the SDK client, any question text, or a source map.

### Result variants

| `kind` | When | Fields the UI reads |
|---|---|---|
| `food` | `input_kind` is food, or the item has a canon ruling | `category`, `title`, `headline`, `ruling` (verdict, odds, dissent, family), `official`, `wet`, `starch`, `riceClause`, `muffinClause`, `dependsOnServing`, `debate`, `nameTraps` |
| `honorary` | `input_kind` is not_food, or "humans" | `category`, `title`, `headline`, `ruling` (from `honorary_category`), `official` |
| `nonsense` | `input_kind` is nonsense, or `precheckItem()` found no letters (no request is made) | `item` |
| `declined` | `is_abusive` at or above the threshold | nothing; `item` must never be rendered |

`eyes` (Jev's face by face read) is computed today but has no UI until the v0.3 Starch X-ray.

### Client behavior (`apps/web/src/lib/api.ts`)

- One request per food per session: a promise cache for in-flight requests and a settled cache that lets back and forward render synchronously.
- A 10 second client timeout maps to `timeout`. A rejected fetch maps to `offline` when `navigator.onLine` is false, otherwise `network`. An error body that is not ours falls back to the HTTP status.
- `Retry-After` accepts seconds or an HTTP date.

## 6. Interpretation rules

Thresholds live in `THRESHOLDS` in `packages/core/src/questions.ts`. The UI never inlines one.

### Bands

The card maps core's verdict onto four bands (`bandOf` in `apps/web/src/lib/copy.ts`):

| Band | Rule | UI |
|---|---|---|
| sure | verdict `unanimous` | "Jev is sure." |
| leans | verdict `majority` | "Jev leans taco." plus the dissent when there is one |
| torn | verdict `split` with a dissent | "Jev is torn between taco and sandwich." Torn stamp with a ghost of the runner-up |
| baffled | verdict `split`, no dissent | "Jev is baffled." Dashed stamp, cube faces at 60% opacity |

**Family fallback:** on a split verdict core reports the chosen category's family when its summed probability clears `THRESHOLDS.family`. The copy then leads with the family ("Definitely a shell. Jev is torn between taco and sushi."). When the dissent sits in another family, the copy says the court is split on which kind instead of naming it.

### Canon

`findOfficialRuling()` matches cuberule.com's published rulings. On a match the headline says "Officially", the stamp shows the canon category, and a badge says either "Canon agrees" or "Jev dissents. cuberule.com rules it a quiche, but Jev on its own says cake (62%)." The canon row in the probability list gets a "canon" tag when Jev disagrees. Easter egg from the site: humans are ravioli, so "humans" rules as an honorary calzone.

### Extras on food rulings

Shown as small chips under the confidence line, with a note when a chip needs explaining:

| Field | Chip | Note |
|---|---|---|
| `starch` | "Starch: bread" with a swatch in the starch color (the cube faces are tinted too) | none |
| `wet` | "Served wet" (the title already says "Wet Nachos") | none |
| `dependsOnServing` | "Depends how it's served" | "The starch moves depending on how it's served. This ruling is for the usual form." |
| `riceClause` | "Rice clause" | quotes cuberule.com's rice clause |
| `muffinClause` | "Muffin clause" | "A solid block of starch, raw and unsliced, counts as toast." (cuberule.com: "in raw, unsliced form") |
| `nameTraps` | "Name trap: cake" | "The name says cake. The starch says quiche." |
| `debate` | "Debate: Spicy" | none |

### Copy variants

Where copy has variants, `pickVariant(item, slot, variants)` picks with FNV-1a, so the same food always reads the same and a shared link matches the sender's screenshot.

## 7. Screens

Mobile first. The content column is `min(100% - 32px, 640px)`. The gallery and, from 900px, the ruling card widen to 960px. Nothing scrolls sideways at 320px.

### 7.1 App shell

- **Mock banner** (only after a response with `mock: true`): "Demo mode: no TypeSafe key is set, so these rulings are simulated. Consistent, not correct. What's this?" linking to `#about-mock`. Dismissable for the session.
- **Header:** logo cube and wordmark, nav links (Rule, Cubes, About) from 520px, and the theme toggle.
- **Skip link:** "Skip to the oracle", first in tab order, targets the food input.
- **Footer:** "Unofficial fan app. The Cube Rule is by @Phosphatide. cuberule.com is by @indirect. Rulings by Jev from TypeSafe." Then the app version, question set, and the model from the last response.

### 7.2 Home and hero

- **Daily question** (`HERO_QUESTIONS`, rotating by day of year) covers all nine categories: "Is a hot dog a sandwich?", "Is a Pop-Tart a calzone?", "Is lasagna cake?", "Is pizza toast?", "Is a burrito sushi?", "Is cheesecake a quiche?", "Is ramen nachos?", "Is a lobster roll a taco?", "Is steak a salad?".
- **Hero cube** beside the question shows the category being asked about, stamped with a dashed "SANDWICH?". It bakes in once on load and then stays still, and it is a link that rules on the food in the question.
- **Input:** visible label "Name a food", 56px tall, 18px text, `enterkeyhint="go"`, autocomplete, autocorrect, and autocapitalize off, `maxlength="80"`. Hint: "Singular works best. Jev only sees the name." Below 400px the button drops under the input.
- **Examples:** hot dog, cereal, pop-tart, lasagna, pizza, and Surprise me (from `SURPRISE_FOODS`). Examples are real `?food=` links, a plain click is handled in the app, and hovering or focusing one for 150ms prefetches its ruling if one is already stored. A prefetch sends `X-Cube-Prefetch: 1`, so the Function answers a miss with 204 instead of calling Jev, and it never starts the human check.
- **Validation** runs on submit only: "Type a food first." or "That needs at least one letter." The input gets `aria-invalid` and the error joins its description.
- With a ruling showing, the hero compacts to the form: no subhead, no examples, no hero cube, and the section is labelled by the input's label. The daily question stays, small and not a heading, only when the ruling is about its food. A shared link for hot dog never opens under "Is a burrito sushi?".

### 7.3 Ruling card

Directly under the input. Loading reserves the card's height with skeleton rows so nothing jumps. From 900px the card splits into two columns: the heading, cube, and stamp stay pinned on the left while the details scroll on the right.

| State | Heading | Cube | Stamp | Extra |
|---|---|---|---|---|
| loading (typed) | "Hot dog" | spinning dashed wireframe | none | cycling status line, "Still thinking" at 4s, skeleton odds |
| loading (deep link) | "Consulting the cube" | same | none | the food is not shown until Jev clears it |
| sure / leans | "Hot dog: Definitely a taco." | category layout | TACO | confidence line, canon badge, chips |
| torn | "Arguably a taco." | category layout | TACO? with a SANDWICH? ghost | torn copy names both |
| baffled | "Arguably a quiche." | faces at 60% | QUICHE?, dashed and muted | bars still shown |
| honorary | "Canoe: Not food. Probably." | honorary category layout | HONORARY TACO | "If it were food, it would probably be a taco." |
| nonsense | "Qwrtzp: Uncubeable." | empty wireframe | UNCUBEABLE | "Jev can't find a food, or anything else, in that." |
| declined | "Jev declines to cube that." | closed box icon | none | "Try a food. Any food." No share, no echo |
| error | the food, or "Consulting the cube" for a deep link | none | none | error panel |

Every simulated ruling shows a "Simulated" pill beside the eyebrow and a "SIMULATED" caption under the stamp.

**Probability list:** an `<ol>` labelled "Jev's probabilities, highest first", all nine rows. Each row has the category number, the name, a tabular percentage ("<1%" below 0.5%), and a bar (at least 2px when non-zero). The winner has an accent badge, bold text, and an accent bar, so rank and weight carry it as well as color.

**Error panel** (replaces the details, keeps the heading; its title goes to the live region):

| Code | Title | Body | Action |
|---|---|---|---|
| `rate_limited` | Too many cubes in the oven. | Jev is fielding a lot of rulings. The button below counts down to your next try. (No number in the body, so it never disagrees with the live countdown.) | disabled "Try again in {n}s" countdown, then "Try again". Never retries on its own |
| `upstream_busy` | The oracle is overheated. | Give it a moment and try again. | Try again |
| `upstream_error`, `internal` | Something broke on our side. | It's not you, and it's not the food. | Try again |
| `timeout` | Jev is thinking unusually hard. | That took too long. Want to try again? | Try again |
| `offline` | You're offline. | The cube needs the internet to rule. | disabled until the `online` event |
| `network` | Couldn't reach the oracle. | Check your connection and try again. | Try again |
| `bad_request` | That doesn't look like a food name. | Letters, numbers, spaces, and apostrophes work best. | Edit the food (focuses the input) |

**Share bar:** "Share ruling" uses `navigator.share({ title, text, url })` and falls back to copying; a cancelled share is silent. "Copy link" shows the toast "Link copied." or, if the clipboard refuses, a read-only field with the URL selected. "Cube another" clears and focuses the input.

**Nerd stats:** a `<details>` with model, question set, mode (live, mock, or precheck), round trip in ms, cache status, `is_abusive`, `input_kind`, `category` confidence and all nine probabilities to three decimals, `honorary_category` when relevant, `starch`, `is_wet`, `varies_by_serving`, and `debate_heat`.

### 7.4 Gallery: "The nine cubes"

A face legend, then one card per category: a static cube at its hero angle, the number badge and name, core's summary, the family, and three canon example links. Rows on mobile, two columns from 640px, three from 900px. Cubes turn 20 degrees on hover or focus within the card. The section uses `content-visibility: auto` with a placeholder height per breakpoint close to the real one, so the page does not jump when the gallery renders.

### 7.5 About (`#about`)

Six short blocks in our own words: what the Cube Rule is (credit and link to cuberule.com, "Go read the original"), who decides (Jev returns probabilities, people wrote every word), why Jev might be wrong (names only, forms vary, canon wins, the rice clause), what gets sent where, demo mode (`#about-mock`), and credits.

**What gets sent where** must match the Function:

- The food name goes to our Pages Function and, only when no stored ruling exists, to TypeSafe's API.
- Rulings are stored by food name in Cloudflare's cache and KV. Who asked is not stored.
- The client IP is held in memory for about a minute for rate limiting. Our code logs neither it nor the food.
- No accounts, cookies, or analytics. The theme choice stays in local storage.

If the Function's storage or logging changes, this copy changes with it.

### 7.6 Settle the debate (v0.2)

Two inputs with a VS badge and a swap button, two mini ruling cards side by side from 640px, and a banner: "SAME CUBE. Hot dog and sub sandwich are both tacos. Hug it out.", "DIFFERENT CUBES. ...", or "OPEN CASE." when either side is torn. A starch diff is computed from the canonical layouts. Two cached GETs, no new endpoint.

The main input also learns an "Is X a Y?" parser: "is a hot dog a sandwich?" answers "No. Hot dog is a taco, not a sandwich." or "Kind of." when Y is the runner-up; "X vs Y" and "X or Y" open Debate. Pure code with a table-driven test.

### 7.7 Guess the cube (v0.3)

A date-seeded Cube of the Day and an Endless mode over a curated list. Nine radio tiles (digits 0 to 8 work only inside the form), points are `round(100 * probability of the guess)`, streaks live in local storage, and the share text never names the food or the category.

### 7.8 Starch X-ray and debate heat (v0.3)

- **X-ray toggle** (`aria-pressed`) tints each face by `eyes.faces` and lists the read in text. When `eyes.agrees` is false: "Face by face, Jev reads this as a sandwich. Even the oracle argues with itself." The jaggedness docs say this happens, so we make it a joke rather than hide it.
- **Debate heat meter:** four segments from `debate_heat`, combined with the band ("Humans have argued about this for years. Jev settled it in milliseconds.").
- **It depends:** when `dependsOnServing` is true and the food is in a curated variants table, chips rule each variant.

### 7.9 Hall of Controversy (v0.3)

A lazy section that rules 16 famous-argument foods through the cached endpoint, at most 4 in flight, and lists them lowest confidence first.

## 8. Code map

Pure logic in `apps/web/src/lib/`, unit tested without React:

| Module | Responsibility |
|---|---|
| `api.ts` | Fetch, timeout, error mapping, caches, cache header, browser cache detection |
| `copy.ts` | Bands, confidence and canon copy, stamps, chips and notes, share text, titles, hero questions, loading lines, error copy |
| `cube.ts` | Hero angles, bake order, the cube's accessible description |
| `examples.ts` | Gallery example to canon query |
| `foods.ts` | Hero examples and the Surprise me list |
| `format.ts`, `hash.ts` | Percent formatting, sentence case, FNV-1a variant picker |
| `theme.ts`, `storage.ts` | Theme preference with guarded local storage |
| `contrast.ts` | WCAG luminance and ratio, used by the token test |
| `url.ts` | `?food=` parsing and share URLs |

Hooks: `useOracle` (the ruling state machine and request ids), `useReducedMotion`, `useOnline`.

Components: `App`, `Header`, `ThemeToggle`, `MockBanner`, `Footer`, `HeroArt`, `FoodForm` (with `FoodLink`), `RulingCard`, `Cube3D`, `Stamp`, `ProbabilityList`, `ErrorPanel`, `ShareBar`, `NerdStats`, `Gallery`, `About`, `Announcer` (live region and toast), `ErrorBoundary` ("The cube collapsed.").

## 9. Copy deck

- **Subhead:** "Name any food. Jev finds the structural starch, and the cube rules."
- **Loading lines** (every 1.1s, `aria-hidden`; the live region gets "Ruling on hot dog."): Locating structural starch. / Checking both ends. / Measuring crust coverage. / Consulting the cube.
- **Still thinking** (at 4s): "Still thinking. Jev is usually faster than this."
- **Confidence lines:**

| Band | Variants |
|---|---|
| sure | "Jev is sure." / "No notes. Case closed." / "Jev didn't even blink." |
| leans | "Jev leans {A}." / "Probably {A}. Jev wouldn't bet the bakery on it." / with a dissent: "Jev leans {A}, with a dissent for {B} ({pB})." |
| torn, same family | "Definitely {fam}. Jev is torn between {A} and {B}." / "{Fam}, for sure. The argument is {A} versus {B}." |
| torn, family sure but dissent elsewhere | "Definitely {fam}. The court is split on which kind." |
| torn | "Jev is torn between {A} and {B}." / "Split decision: {A} or {B}. Depends how you hold it." |
| baffled | "Jev is baffled. This food defies geometry." / "The cube cannot contain this one." / with a family: "Jev can't name the cube, but it's definitely {fam}." |

`{fam}` is "layered", "a shell", or "loose".

- **Share text:** "Hot dog? Officially a taco. Jev gives it 97%. The cube has spoken." / "Jev is torn on gyro: taco (38%) or sushi (30%). Settle it." / "Cheesecake? Officially a quiche. But Jev dissents: cake (62%)." / "Jev says canoe isn't food. If it were food, it would probably be a taco."
- **Toasts:** "Link copied." / "Couldn't copy. Here's the link:"

## 10. Visual system

### 10.1 Direction

"Bakery ledger": warm flour-paper surfaces, crust browns, one ketchup accent, Fraunces for questions, rulings, and stamps, and the system sans for everything else. Dark mode is "oven at night": espresso surfaces where the starch faces glow like toast.

### 10.2 Tokens

`apps/web/src/styles/tokens.css` declares every color once as `light-dark(light, dark)`. `:root` sets `color-scheme: light dark`, and `data-theme="light"` or `"dark"` on `<html>` pins one. The two themes cannot drift because there is only one declaration per token.

An inline script in `<head>` applies the saved theme (`cro.v1.theme`) before first paint. Its SHA-256 hash is in the CSP `script-src` in `public/_headers`, and `functions/static-headers.test.ts` fails if the script changes without the hash. Two `theme-color` metas follow the system, and the toggle rewrites them on an override.

### 10.3 Verified contrast (WCAG 2.2 AA)

`apps/web/src/styles/contrast.test.ts` parses `tokens.css` and holds every pair below in both themes:

- 4.5:1 for text, muted text, and accent text on bg, surface, and surface-2; accent ink on accent and accent hover; danger and success on surface; warn text on warn bg.
- 3:1 for control and focus on bg and surface, both bar colors on the bar track, and the starch face edge on the card (crust in light mode, crumb in dark mode).

Starch and open faces are told apart by texture and outline style (a solid crust edge against a dashed control outline), never by tint alone.

### 10.4 Type

- **Display:** Fraunces Variable (weight axis) from `@fontsource-variable/fraunces`, `font-display: swap`. The Latin file is 36.6 KB and is preloaded by a small Vite plugin.
- **Body:** system UI stack at 1rem / 1.55. Nerd stats use mono. Percentages use tabular numerals.

### 10.5 Icons

Inline SVG on a 24px grid, 1.75px stroke, `currentColor`, `aria-hidden`: share, link, refresh, sun, moon, half circle, closed box, wifi off, clock, alert, dice, close, pencil.

### 10.6 The cube

```html
<div class="cube-stage" role="img" aria-label="Cube diagram, Taco: starch on the bottom, left side and right side. The top, front end and back end are open.">
  <div class="cube-wrap">
    <div class="cube">
      <div class="face face--bottom is-starch"><div class="skin"><i class="out"></i><i class="in"></i></div></div>
      <!-- top, left, right, front, back -->
      <div class="slab is-starch">...</div>   <!-- cake only -->
      <div class="core">...</div>           <!-- nachos only, six starch faces -->
    </div>
  </div>
</div>
```

- `.face` places the plane, `.skin` carries flourish transforms, and `.out` and `.in` are the outer and inner layers with `backface-visibility: hidden`, so the inside of a taco is shaded darker with no lighting math.
- Starch faces: crumb fill with three speckle layers (11, 14, 17px tiles), a crust edge, and a per-face shade. Food rulings tint the crumb toward the `starch` color.
- Open faces: a faint glass tint with a dashed control outline.
- Cake gets a middle slab. Nachos get a smaller starch cube at the center, drawn with the same faces, as on cuberule.com.

## 11. Motion

Only `transform`, the individual transform properties, and `opacity` animate. The cube spin uses the Web Animations API so the reveal can read the current angle.

| t (ms) | What happens |
|---|---|
| loading | the dashed wireframe spins once per 2.4s and its faces pulse |
| 0 | the spin angle is read and the cube settles onto its hero angle plus most of a turn (800ms) |
| 250 | starch faces bake in: bottom, sides, ends, top, 70ms apart, with the category flourish |
| 700 | the verdict line rises in |
| 750 | the stamp slams in (260ms) and a torn ghost stamp follows at 1000ms |
| 850 | probability bars grow, winner first, 35ms apart |
| 950 | confidence line, canon badge, and chips rise in |
| 1400 | focus moves to the heading, but only for rulings the user typed |

**Flourishes:** salad wobbles, toast's base rises into place, sandwich's lid drops, taco's walls grow up from the base, sushi rolls on in order, quiche's four walls rise together, calzone crimps, cake's layers drop in one by one, nachos' inner cube drops in with a bounce.

**Reduced motion** (`prefers-reduced-motion: reduce`): no spin, bake, flourish, slam, or bar growth. The final state fades in over 150ms. Scrolling is instant. Nothing loops, and the hero cube animates once.

## 12. Accessibility

- Landmarks: header, nav, main, footer. The mock banner is a labelled `aside`. Skip link first.
- One h1. On the home page it is the daily question. Once a ruling shows, typed or deep linked, the ruling heading is the h1 ("Consulting the cube" while a deep link loads) and its probability list and error title are h2. The gallery and about headings are h2 and their cards are h3. `RulingCard` takes a `level` so the v0.2 debate cards can sit lower.
- The form has a visible label, the hint and error are linked by `aria-describedby`, and `aria-invalid` is set on error.
- One polite live region carries loading ("Ruling on hot dog."), error titles, toasts, and the verdict of a deep-linked ruling. A typed ruling moves focus to its heading instead; a deep link never steals focus.
- The cube is `role="img"` with a description built from its geometry. Stamps and bars are `aria-hidden` because the heading and the list text carry them.
- Color is never the only signal: rank and weight mark the winner, texture and outline mark starch, and every band has its own words.
- `:focus-visible` shows a 3px focus ring everywhere. Targets are at least 44px. The page reflows at 320px with no sideways scroll.
- The theme toggle names its current and next state ("Theme: system. Switch to light.").
- The 429 countdown never retries on its own.
- Tests: Testing Library over every ruling variant and error, axe-core over each of them and the home page (color contrast is covered by the token test instead, since jsdom cannot compute it).

## 13. Sharing and link previews

Crawlers do not run JavaScript, so the share text carries the food and verdict and the preview carries the brand.

**v0.1: one static card.** `index.html` has static `og:` and `twitter:` tags. `og:image` and `og:url` are absolute: the build replaces `%SITE_URL%` with `SITE_URL` (default `https://cube-rule-oracle.pages.dev`), so set it to the real subdomain when building for production. `public/og.png` (1200x630, about 58 KB) renders from `apps/web/og/og.svg` with `pnpm --filter @cube/web og`, which runs rsvg-convert with Fraunces unpacked from `@fontsource/fraunces`.

**v0.2: per-category share pages.** A post-build script writes `dist/is/{category}/index.html` with category OG tags and renders nine more cards from the same SVG. Pages serves `/is/taco/` from that file with no rewrite rules. Share links become `/is/taco/?food=hot+dog`, and the app replaces the path when the live ruling differs.

**v0.3: share image.** A canvas draws a 1080x1350 verdict card (food, an isometric cube from the same layout data, the stamp, the top three bars, the URL, the credit) and shares it with `navigator.share({ files })` or downloads it.

## 14. Mock mode

- The Function returns `mockCubeResponse(item)` with `mock: true` and `no-store` when `TYPESAFE_API_KEY` is unset.
- `pnpm --filter @cube/web dev:mock` serves the same mock straight from Vite, without wrangler, plus trigger foods for every state: `mock sure`, `mock leans`, `mock torn`, `mock family`, `mock baffled`, `mock 429`, `mock 502`, `mock 503`, `mock 504`, `mock 500`, `mock slow` (5s), `mock timeout` (12s). Core's own mock declines any item containing the word `slur` and treats consonant mash as nonsense.
- The UI shows the banner, the Simulated pill and caption, and `#about-mock`.

## 15. Performance budget

| Metric | Budget | v0.1 |
|---|---|---|
| Initial JS | 90 KB gzip | about 86 KB (React plus the app) |
| CSS | 12 KB gzip | about 7.3 KB |
| Display font | 40 KB woff2, preloaded | 36.6 KB |
| Above-the-fold images | none | none (CSS cube, inline SVG icons) |
| CLS | below 0.02 | the loading card reserves its height |

Debate, game, X-ray, and share image load through `import()` when they land, so the initial bundle stays inside the budget.

## 16. Release plan

- **v0.1 "The Oracle":** hero input with a daily question and hero cube, the ruling card with the 3D reveal, all nine bars, band copy with family fallback, honorary, nonsense, and declined states, the canon badge, starch and debate chips, deep links, share and copy, the static OG card, the gallery, about and credits, every error and rate-limit state, mock mode, themes, reduced motion, and nerd stats.
- **v0.2 "Fight Night":** Settle the debate, the "Is X a Y?" parser, per-category share pages and cards, recent foods, drag and keyboard cube rotation, and a torn crossfade. No new Jev questions.
- **v0.3 "Cube of the Day":** Guess the cube, the Starch X-ray on `eyes`, the debate heat meter, "it depends" variants, the Hall of Controversy, the share image, an in-app motion setting, and a PWA shell. The questions these need (the face Nouls, `debate_heat`, `varies_by_serving`) already run in every request.

## 17. Open questions

1. **Site URL.** Set `SITE_URL` at build time once the Porkbun subdomain is live, or link previews point at the default `pages.dev` host.
2. **Canon accuracy.** Audited against cuberule.com on 2026-09-22 ([canon-audit.md](canon-audit.md)), and `official.test.ts` pins the table. Audit again whenever the site changes.
3. **Privacy copy.** The about section describes the Function as of v0.1. Any new logging or storage needs the copy updated in the same change.

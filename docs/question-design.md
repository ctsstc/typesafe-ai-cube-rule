# Question design

How Cube Rule Oracle asks Jev to rule on a food, and how code turns the answers into a result card. The rules themselves come from [cuberule.com](https://cuberule.com/). This app is an unofficial fan project.

The code lives in `packages/core/src` and is published inside the workspace as `@cube/core`.

| Module | Holds |
|---|---|
| `categories.ts` | The nine categories, their families, starch types, input kinds and the rice clause |
| `questions.ts` | Every piece of question text, `THRESHOLDS`, `CUBE_MODEL`, `QUESTION_SET_VERSION` and the request builders |
| `input.ts` | `normalizeItem`, `precheckItem` and the canonical `/api/classify` query |
| `official.ts` | Exact lookup of the rulings published on cuberule.com |
| `result.ts` | Result types and `toCubeResult`, which applies every threshold |
| `mock.ts` | Deterministic keyless answers for local development |
| `wire.ts` | `ClassifyResponse`, `ClassifyErrorBody` and the error code to HTTP status map |

> [!IMPORTANT]
> All question text and thresholds stay in `questions.ts` so they can be reviewed in one place. Any change to a question or to `CUBE_MODEL` must bump `QUESTION_SET_VERSION`, because the version is part of the cache key. The fingerprint test in `questions.test.ts` fails until you do, and tells you the hash to record for the new version.

## Request and wire contract

- **State** is `{ item }`, where `item = normalizeItem(raw)`. The field name is neutral on purpose: calling it `food` would bias the not-food judgment. All Cube Rule knowledge lives in the questions.
- **`normalizeItem`** applies NFKC, lowercases, applies NFKC again, straightens curly quotes, maps every dash to `-`, turns control characters into spaces, collapses whitespace, cuts at 60 code points, then strips trailing punctuation. Cutting before stripping keeps it idempotent, which a 20,000-string fuzz test checks.
- **`precheckItem`** turns input with no letters and no emoji into a nonsense result without an API call.
- **One request, 16 questions**, pinned to `jev-1.13.0`: `client.systemOne(buildCubeRequest(item))`.
- **SPA:** `normalizeItem`, then `precheckItem`, then `fetch(classifyUrl(item))`, then `toCubeResult(item, body)`.
- **Pages Function** (`apps/web/functions/api/classify.ts`): `parseClassifyQuery(url.search)` returns `null` unless the query string is exactly `food=<normalized>&v=<QUESTION_SET_VERSION>`, so every cache key maps to one billed request. It answers 400 on `null`, the mock when `TYPESAFE_API_KEY` is unset, and otherwise the raw `{ model, answers }` from Jev.
- **Raw answers on the wire.** The SPA runs `toCubeResult`, so a threshold or copy change is a static redeploy with no new inference.
- **Caching:** a live success is `public, max-age=31536000, immutable`. The key is versioned, so nothing ever needs purging. Mock responses and errors are `no-store`.

The SPA bundle never sees the SDK or the rubric text. `@cube/core` is marked `"sideEffects": false` and the rubric constants are plain literals, so bundlers drop them. An entry that imports `normalizeItem`, `precheckItem`, `classifyUrl`, `toCubeResult` and `CATEGORIES` builds to about 8.7 KB minified (3.5 KB gzip) with esbuild, with no `TypeSafeClient`, API URL or question text in the output.

## Questions

| id | Type | Drives |
|---|---|---|
| `is_abusive` | Noul | Declines to rule on slurs, harassment, hate and explicit sexual text |
| `input_kind` | Choice: food, not_food, nonsense | Which card renders: ruling, honorary or "cannot rule" |
| `category` | Choice, 9 options with `starch_position`, `examples`, `not_for` | The ruling: cube, name, headline adverb, odds, dissent, family fallback |
| `honorary_category` | Choice, 9 options, explicit "treat the shell as starch" premise | The "Honorary Calzone" card for things that are not food |
| `starch` | Choice, 10 options including `none` and `other_starch` | Face colour, starch label, rice clause |
| `is_wet` | Noul | The "Wet" title prefix (Wet Salad, Wet Nachos) |
| `starch_base`, `starch_lid` | Noul | Jev's eyes: bottom and top faces |
| `starch_side_wall`, `starch_opposite_walls`, `starch_all_walls` | Noul, nested: at least 1, at least 2 opposite, all 4 | Jev's eyes: walls. The single-wall question is what reads a pie slice as a taco on its side |
| `starch_middle_layer` | Noul | Jev's eyes: cake layers |
| `starch_loose_pieces` | Noul | Jev's eyes: nachos core |
| `starch_block` | Noul | Jev's eyes: the muffin clause |
| `varies_by_serving` | Noul. A form word in `item` (slice, whole, folded, uncut) means no | "It depends how it's served" chip |
| `debate_heat` | Score, 4 situational levels | Share label: Settled, Mild, Spicy, Friendship-ending |

Design choices worth keeping:

- **Every question runs every time** (the fan-out pattern). Code ignores the branches the gates do not take.
- **Every question is self-contained.** Question ids are not sent to the model, so each question that says "structural starch" carries its definition.
- **One condition per Noul.** `is_wet` asks only about a pool of liquid, and `starch_block` only asks whether the item is one solid piece of starch.
- **Cake leads with "a starch layer in the middle, between fillings"** instead of asking Jev to count layers.
- **Site examples carry their structure** inside the `category` question only, such as "burrito (both ends folded shut)". Jev copies the ruling of an example that shares a word with `item`, so the structure has to sit in the example string. `CATEGORIES` keeps the site's wording, and the gloss keeps the site name before the parenthesis so eval leak detection still finds it.
- **Commands are nonsense.** `input_kind` treats an attempt to control the app's answer as nonsense even when it names a food, while a question about what kind of food something is stays food.
- **No-match outcomes exist everywhere:** `input_kind` is a separate presence judgment, Salad is the catch-all food category, `starch` has `none` and `other_starch`, and the honorary question sends things with no solid form to Salad.

## Abuse guard

The app is shared by public link, so a ruling on a slur or a harassing phrase would be a shareable page with that text on it. `is_abusive` asks one question: is `item` abusive text rather than the name of a food, dish, drink, object or harmless joke? "Abusive" is defined as a slur, harassment of a person or group, hateful content, or explicit sexual content.

- The `false` criteria list real dishes whose names only sound rude, such as spotted dick, faggot (the British meatball), cock-a-leekie soup, hot dog and sloppy joe, so Jev judges the whole phrase instead of single words.
- `toCubeResult` checks it first, before the official lookup and the nonsense gate, and returns `{ kind: "declined", item, model }` when `is_abusive >= THRESHOLDS.abusive` (0.85). The bar is high because declining a real dish is embarrassing too.
- In mock mode, any item containing the word `slur` (`MOCK_DECLINE_TRIGGER`) is declined, so the card can be built without a key.

> [!WARNING]
> A declined result still carries `item` so callers can key on it. The UI must never render it or put it in a share card or page title.

## From answers to a result

1. **Abuse gate.** Decline when `is_abusive` clears its threshold.
2. **Input gate.** An official ruling overrides `input_kind`: an official food means food, and "humans" means honorary. Otherwise `input_kind.choice` decides.
3. **Ruling.** Odds are sorted from the category probabilities. The verdict comes from `confidence`: unanimous at 0.8 or more, majority at 0.4 or more, split below that. The dissent is the runner-up when it has at least 0.15. On a split verdict, the family fallback reports the chosen category's family when that family's summed probability is at least 0.7.
4. **Official override.** `category = official?.category ?? ruling.category`. `official.jevAgrees` powers "Jev dissents", and the headline becomes "Officially ...".
5. **Food extras.** Wet prefix, starch label (hidden for Salad or `none`), rice clause, muffin clause, "depends how it's served", debate level (`round(score)` clamped to 0 to 3), and name traps (another category's name inside `item`, such as the "cake" in cheesecake).
6. **Jev's eyes.** Each face Noul becomes yes (0.7 or more), no (0.3 or less) or unsure. Code enforces all walls implies opposite walls implies one wall. The reading checks solid block (Toast), middle layer (Cake) and loose pieces (Nachos), then classifies the face set up to rotation with `shapeCategory`. It is `null` whenever an input it needs is unsure. The eyes are a display-only cross-check: never blended into the verdict, never shown as a probability.

Headlines read "Definitely a taco.", "Probably wet nachos.", "Arguably toast.", "Officially a quiche." and "If it were food, it would probably be a calzone."

## Thresholds

All values are untuned guesses until the eval set has run.

| Key | Value | Why |
|---|---|---|
| `unanimous` | 0.8 | Near the docs' routing examples. Above it the ruling reads "Definitely" |
| `majority` | 0.4 | A wrong food ruling costs nothing, and a hung jury is content, not a failure |
| `dissent` | 0.15 | A dissent chip is cheap and fun |
| `family` | 0.7 | Enough mass to say "definitely a Shell, the court is split on which" |
| `wet` | 0.6 | Leans against a false "Wet" title |
| `rice` | 0.5 | Rice is the leading main starch |
| `dependsOnServing` | 0.6 | Show the chip only when Jev leans yes |
| `yes` / `no` | 0.7 / 0.3 | The Noul page's three-way split. Middle values show as unsure |
| `abusive` | 0.85 | Decline only when Jev is sure. Real dishes with rude-sounding names must still get a ruling |

## Verification

- **Live smoke call** (`hot dog`, question set 2, 2026-09-22): 8,580 input tokens and 551 output tokens, 483 ms round trip. That is about $0.00036 per uncached call at $0.042 per million input tokens. Jev chose Taco with confidence 1.0, `is_abusive` was 0.01, the eyes read Taco and agreed, and `debate_heat` was 2.93 (Friendship-ending).
- **Vitest** (`pnpm vitest run --project core`): normalization fuzzing and the URL round trip, canonical query rejection, official lookups including `constructor` and `__proto__`, a shape table for every face-defined ruling on the site, mapper scenarios (apple pie slice, cheesecake, ramen, tomato soup, humans), the abuse guard, mock invariants, a fake-fetch round trip through the real `TypeSafeClient`, and the request fingerprint.
- **Type assertions** (`pnpm --filter @cube/core typecheck`): every Choice narrows to its option ids, the Score's probability keys are `"0" | "1" | "2" | "3"`, a missing option is a compile error, and the wire types match the error code map.

## Known risks

- **Name bias.** Jev reads literally, and in evals the pull came from example strings that share a word with `item` more than from option keys. Sushi burrito still goes calzone through "burrito", and whole pumpkin pie through "pie (whole)". Name traps make this visible. If glossing examples stops helping, try neutral option keys and map them back in code.
- **Cost of the eyes.** The 8 geometry Nouls roughly double the tokens, because each repeats the structural starch definition. To drop them, delete the Nouls, `readEyes` and the `eyes` and `muffinClause` fields, then bump the version.
- **Eyes limits.** They cannot express two adjacent walls or a corner, contradictory face answers give `null` or a wrong reading, and cheesecake or an uncut sub may disagree with the ruling. Frame a disagreement as "Jev's eyes vs Jev's gut", not as a correction.
- **Honorary path.** "Treat the shell as starch" is an indirection, which the Jev jaggedness page lists as a weak spot. Expect noisier answers there.
- **Abuse guard coverage.** One Noul will not catch everything, and the 0.85 bar trades misses for fewer false declines. Cached answers are public by URL, but the canonical key limits any damage to that one query.
- **Official lookup scope.** Only exact names match, after stripping a leading article and a trailing plural. Plain "pie", "quesadilla" and "sub" are left out on purpose because the site qualifies them.
- **Model upgrades.** Moving to a new Jev means rerunning the eval, then bumping `CUBE_MODEL` and `QUESTION_SET_VERSION` together.
- **Attribution.** The rice clause and "humans are just ravioli" quote cuberule.com, so the UI credits the site. Brand names appear only as text.

## Evaluating

1. **Build a labelled set:** every `OFFICIAL_RULINGS` alias, about 40 held-out foods labelled by two people (gyro, crunchwrap, spring roll, s'more, bao, tostada, burrito bowl, poke bowl, onigiri, club sandwich, folded quesadilla), not-food items, nonsense, the name-bias probes, and benign dishes with rude-sounding names for the abuse guard.
2. **Run each item once** and store the raw `{ model, answers, usage }`. `toCubeResult` is pure, so every threshold can then be tuned offline.
3. **Score Jev's own `ruling.category`**, not the final `category`, because the official override makes canonical items trivially correct. Plot confidence against accuracy to set `unanimous` and `majority`.
4. **Check the flags:** per-face accuracy of the eyes and their null rate, `is_wet` on soup, ramen, cereal and poutine, `varies_by_serving` on pie and quesadilla, and the `is_abusive` false-decline rate on real dishes.
5. **Repeat a handful of calls** to check consistency, then tune `THRESHOLDS`, keep the model pinned, and bump `QUESTION_SET_VERSION` whenever a question changes.

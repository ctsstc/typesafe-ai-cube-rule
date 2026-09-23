# Question design

How Cube Rule Oracle asks Jev to rule on a food, and how code turns the answers into a result card. The rules themselves come from [cuberule.com](https://cuberule.com/). This app is an unofficial fan project.

The code lives in `packages/core/src` and is published inside the workspace as `@cube/core`.

| Module | Holds |
|---|---|
| `categories.ts` | The nine categories, their families, starch types, input kinds, person kinds and the rice clause |
| `questions.ts` | Every piece of question text, `THRESHOLDS`, `CUBE_MODEL`, `QUESTION_SET_VERSION` and the request builders |
| `input.ts` | `normalizeItem`, `precheckItem` and the canonical `/api/classify` query |
| `official.ts` | Exact lookup of the rulings published on cuberule.com |
| `result.ts` | Result types and `toCubeResult`, which applies every threshold |
| `mock.ts` | Deterministic keyless answers for local development |
| `public.ts` | The public list gates (`publicListing`, `hasPersonalInfo`, `parseBlocklist`) and `toListEntry` |
| `wire.ts` | `ClassifyResponse`, `ClassifyErrorBody`, the error code to HTTP status map, and the `/api/lists` contract |

> [!IMPORTANT]
> All question text and thresholds stay in `questions.ts` so they can be reviewed in one place. Any change to a question or to `CUBE_MODEL` must bump `QUESTION_SET_VERSION`, because the version is part of the cache key. The fingerprint test in `questions.test.ts` fails until you do, and tells you the hash to record for the new version.

## Request and wire contract

- **State** is `{ item }`, where `item = normalizeItem(raw)`. The field name is neutral on purpose: calling it `food` would bias the not-food judgment. All Cube Rule knowledge lives in the questions.
- **`normalizeItem`** applies NFKC, lowercases, applies NFKC again, straightens curly quotes, maps every dash to `-`, turns control characters into spaces, collapses whitespace, cuts at 60 code points, then strips trailing punctuation. Cutting before stripping keeps it idempotent, which a 20,000-string fuzz test checks.
- **`precheckItem`** turns input with no letters and no emoji into a nonsense result without an API call.
- **One request, 17 questions**, pinned to `jev-1.13.0`: `client.systemOne(buildCubeRequest(item))`.
- **SPA:** `normalizeItem`, then `precheckItem`, then `fetch(classifyUrl(item))`, then `toCubeResult(item, body)`.
- **Pages Function** (`apps/web/functions/api/classify.ts`): `parseClassifyQuery(url.search)` returns `null` unless the query string is exactly `food=<normalized>&v=<QUESTION_SET_VERSION>`, so every cache key maps to one billed request. It answers 400 on `null`, the mock when `TYPESAFE_API_KEY` is unset, and otherwise the raw `{ model, answers }` from Jev.
- **Raw answers on the wire.** The SPA runs `toCubeResult`, so a threshold or copy change is a static redeploy with no new inference.
- **Caching:** a live success is `public, max-age=31536000, immutable`. The key is versioned, so nothing ever needs purging. Mock responses and errors are `no-store`.

The SPA bundle never sees the SDK or the rubric text. `@cube/core` is marked `"sideEffects": false` and the rubric constants are plain literals, so bundlers drop them. An entry that imports `normalizeItem`, `precheckItem`, `classifyUrl`, `toCubeResult` and `CATEGORIES` builds to about 8.7 KB minified (3.5 KB gzip) with esbuild, with no `TypeSafeClient`, API URL or question text in the output.

## Questions

| id | Type | Drives |
|---|---|---|
| `is_abusive` | Noul | Declines to rule on slurs, harassment, hate and explicit sexual text |
| `input_kind` | Choice: food, not_food, nonsense | Which card renders: ruling, honorary or "cannot rule". A feeling or other abstract phrase is not_food |
| `person_kind` | Choice: none, public, private | Public lists only. Never shown on a card. See [public lists](#public-lists) |
| `category` | Choice, 9 options with `starch_position`, `examples`, `not_for`, and `includes` on four of them | The ruling: cube, name, headline adverb, odds, dissent, family fallback |
| `honorary_category` | Choice, 9 options, explicit "treat the shell as starch" premise | The "Honorary Calzone" card for things that are not food |
| `starch` | Choice, 10 options including `none` and `other_starch` | Face colour, starch label, rice clause |
| `is_wet` | Noul | The "Wet" title prefix (Wet Salad, Wet Nachos) |
| `starch_base`, `starch_lid` | Noul | Jev's eyes: bottom and top faces |
| `starch_side_wall`, `starch_opposite_walls`, `starch_all_walls` | Noul, nested: at least 1, at least 2 opposite, all 4 | Jev's eyes: walls. The single-wall question is what reads a pie slice as a taco on its side |
| `starch_middle_layer` | Noul | Jev's eyes: cake layers. Read on the interior bars |
| `starch_loose_pieces` | Noul | Jev's eyes: nachos core. Read on the interior bars |
| `starch_block` | Noul | Jev's eyes: the muffin clause. Read on the interior bars for `eyes`, but the muffin clause chip keeps the face bar (0.7) |
| `varies_by_serving` | Noul. A form word in `item` (slice, whole, folded, uncut) means no | "It depends how it's served" chip |
| `debate_heat` | Score, 4 situational levels | Share label: Settled, Mild, Spicy, Friendship-ending |

Design choices worth keeping:

- **Every question runs every time** (the fan-out pattern). Code ignores the branches the gates do not take.
- **Every question is self-contained.** Question ids are not sent to the model, so each question that says "structural starch" carries its definition.
- **One condition per Noul.** `is_wet` asks only about a pool of liquid, and `starch_block` only asks whether the item is one solid piece of starch.
- **Cake leads with "a starch layer in the middle, between fillings"** instead of asking Jev to count layers.
- **Site examples carry their structure** inside the `category` question only, such as "burrito (both ends folded shut)". Jev copies the ruling of an example that shares a word with `item`, so the structure has to sit in the example string. `CATEGORIES` keeps the site's wording, and the gloss keeps the site name before the parenthesis so eval leak detection still finds it.
- **Contrasts name conditions, not foods.** A food named inside an option's `not_for` pulls items that share the word toward the category in its parenthesis, even from the wrong option. "Ends folded in or crimped shut (calzone)" works where "folded shut like a burrito (calzone)" dragged sushi burrito to calzone.
- **Boundary cases go in `includes`,** a category-only key, never in `starch_position`: `honorary_category` reuses `starch_position`, so food-specific text there leaks into the not-food path. State a boundary case in the option where the answer lives. The non-starch coating contrast left moon pie at sandwich 0.60 while it sat in `calzone.not_for` (v4), and moon pie rose to 0.72 when it moved into `sandwich.includes` (v5, alongside other edits).
- **Commands are nonsense.** `input_kind` treats an attempt to control the app's answer as nonsense even when it names a food, while a question about what kind of food something is stays food.
- **Abstract phrases are honorary** (see [below](#abstract-phrases)): `input_kind` counts a feeling as a thing that is not food.
- **Person kind is its own question.** `input_kind` already says a person is not food, but it cannot say whether that person is famous. A separate Choice keeps each question to one judgment, and its code only feeds the public lists.
- **No-match outcomes exist everywhere:** `input_kind` is a separate presence judgment, Salad is the catch-all food category, `starch` has `none` and `other_starch`, and the honorary question sends things with no solid form to Salad.

## Abuse guard

The app is shared by public link, so a ruling on a slur or a harassing phrase would be a shareable page with that text on it. `is_abusive` asks one question: is `item` abusive text rather than the name of a food, dish, drink, object or harmless joke? "Abusive" is defined as a slur, harassment of a person or group, hateful content, or explicit sexual content.

- The `false` criteria list real dishes whose names only sound rude, such as spotted dick, faggot (the British meatball), cock-a-leekie soup, hot dog and sloppy joe, so Jev judges the whole phrase instead of single words.
- A food word does not launder abuse: an insult, a slur, a hate group's name or a sexual term paired with a food is abusive unless the whole phrase is the real name of a dish. Before question set 6 said so, such phrases scored 0.62 to 0.81, just under the old bar.
- `toCubeResult` checks it first, before the official lookup and the nonsense gate, and returns `{ kind: "declined", item, model }` when `is_abusive >= THRESHOLDS.abusive` (0.5).
- The bar comes from 21 abusive probes and 183 other items in the eval (see [docs/eval.md](eval.md#abuse-guard)). On question set 6 every abusive probe scored 0.86 or more and nothing else passed 0.22, so 0.5 catches 21/21 with no false declines, including 26 rude-sounding dishes.
- In mock mode, any item containing the word `slur` (`MOCK_DECLINE_TRIGGER`) is declined, so the card can be built without a key. `my boss` (`MOCK_PRIVATE_PERSON_TRIGGER`), "my mom" or "dave from accounting" read as a private person, and a few celebrities as public.

> [!WARNING]
> A declined result still carries `item` so callers can key on it. The UI must never render it or put it in a share card or page title.

## Public lists

The site lists recent and interesting rulings (Latest rulings, Most debated, Jev vs the canon, Friendship-ending) so it feels alive. A list is public in a way a ruling is not: a ruling appears only to someone who typed or was sent that exact food, while a list shows it to every visitor. So `publicListing(item, response, options)` in `public.ts` is stricter than the ruling card, and the Pages Function must call it before it records anything for a list.

`publicListing` returns `{ listed, reason }`. It runs these gates in order and stops at the first one that fails:

| Reason | Hides |
|---|---|
| `declined`, `nonsense` | Any ruling that is not food or honorary. Abusive text is never listed, whatever the thresholds say |
| `blocked` | Items in `options.blocklist`, a set of normalized items. `parseBlocklist(text)` builds one from a comma or newline separated string, normalizing each entry |
| `personal_info` | `hasPersonalInfo(item)`: 7 or more digits in total (a phone number), an `@` (emails and handles), `http:`, `https:` or `www.`, a dot between letters such as `foo.com`, "dot com" spelled out, or a webmail name such as gmail |
| `private_person` | `person_kind` gives `private` a probability of `THRESHOLDS.publicPrivatePerson` (0.15) or more |
| `abusive` | `is_abusive` of `THRESHOLDS.publicAbusive` (0.05) or more, ten times stricter than the decline bar. Canon names skip this gate |

- **Fails closed.** Both Jev gates are written as `!(p < bar)`, so a missing or NaN answer hides the item.
- **Canon skips the abusive bar** because every canon name is a ruling cuberule.com published, and Jev scores "humans" 0.12.
- **The digit rule counts digits anywhere in the item,** so "7 up", "24 carrot cake" and "7-layer dip" stay listed and "555 123 4567" does not. "st. louis ribs" and "p.f. chang's" stay listed because no letter follows their dots directly. "dr.pepper" typed without a space is hidden as a domain, which costs one list entry and nothing else.
- **What the Function adds on top** (not in `@cube/core`): an item is listed only after at least `MIN_ASKS` separate asks, a kill switch var hides every list at once, the Function supplies the blocklist, and the activity line appears only above a threshold.

`toListEntry(item, result)` turns `toCubeResult` output into the row a list shows, or `null` for a result that is never listed. Its `category` is **Jev's own pick** and `official` is the canon ruling, so a card shows `official ?? category` and "Jev vs the canon" is `official !== null && official !== category`. `confidence` is rounded to 3 decimals, `runnerUp` is the dissent (the runner-up with at least `THRESHOLDS.dissent`), and an honorary row has `wet: false` and `debateLevel: 0`.

The wire contract lives in `wire.ts`: `LISTS_PATH` (`/api/lists`), `listsUrl()` (which adds `v=<QUESTION_SET_VERSION>`), `isListsQuery`, `ListEntry`, `ListsResponse`, `LIST_NAMES`, `isListEntry`, `isListsResponse` and `disabledListsResponse()` for the kill switch. `activity` is `null` whenever the Function does not show the activity line.

### Person kind

`person_kind` asks "Which kind of specific person, if any, does `item` name or describe?" with three options:

- **none:** no specific person. A food, drink, dish, object, animal, place, group of people, idea or random text.
- **public:** a specific person most people have heard of, including historical figures and fictional or legendary characters.
- **private:** a specific real person most people have never heard of: someone the typer knows, a first name on its own, or a full name that belongs to no famous person.

Jev reads literally, so the boundary cases sit in `how_to_judge` rather than being left to inference: a described person counts ("my boss"), a person anywhere in the phrase counts ("my aunt's casserole"), a food or drink named after a person is not a person ("a reuben sandwich"), and neither a group nor an animal with a human name is a specific person. The worked examples avoid the eval probes, except "my boss", "my mom" and "dave from accounting", which define the private option. The eval marks those three as in prompt.

On question set 7 the gate hid all 12 private people in the eval (the lowest scored 0.29) and none of the other 202 items (the highest scored 0.06). See [docs/eval.md](eval.md#question-set-7).

## From answers to a result

1. **Abuse gate.** Decline when `is_abusive` clears its threshold.
2. **Input gate.** An official ruling overrides `input_kind`: an official food means food, and "humans" means honorary. Otherwise `input_kind.choice` decides.
3. **Ruling.** Odds are sorted from the category probabilities. The verdict comes from `confidence`: unanimous at 0.8 or more, majority at 0.5 or more, split below that. The dissent is the runner-up when it has at least 0.15. On a split verdict, the family fallback reports the chosen category's family when that family's summed probability is at least 0.7.
4. **Official override.** `category = official?.category ?? ruling.category`. `official.jevAgrees` powers "Jev dissents", and the headline becomes "Officially ...".
5. **Food extras.** Wet prefix, starch label (hidden for Salad or `none`), rice clause, muffin clause, "depends how it's served", debate level (`round(score)` clamped to 0 to 3), and name traps (another category's name inside `item`, such as the "cake" in cheesecake).
6. **Jev's eyes.** Each face Noul becomes yes (0.7 or more), no (0.3 or less) or unsure. The solid block, middle layer and loose pieces Nouls use a narrower unsure band: yes at 0.6, no at 0.4. Code enforces all walls implies opposite walls implies one wall. The reading checks solid block (Toast), middle layer (Cake) and loose pieces (Nachos), then classifies the face set up to rotation with `shapeCategory`. It is `null` whenever an input it needs is unsure. The eyes are a display-only cross-check: never blended into the verdict, never shown as a probability.

Headlines read "Definitely a taco.", "Probably wet nachos.", "Arguably toast.", "Officially a quiche." and "If it were food, it would probably be a calzone."

## Thresholds

Thresholds are applied in code and never sent to Jev, so changing one needs no version bump: rescore with `pnpm eval --offline`. The round that set the current values is in [docs/eval.md](eval.md#threshold-round).

| Key | Value | Why |
|---|---|---|
| `unanimous` | 0.8 | Every tune and canon ruling at 0.8 or more has been right since question set 3. Above it the ruling reads "Definitely" |
| `majority` | 0.5 | Below 0.5 the top option held only 0.48 to 0.55 on tune, a hung jury that reads "Arguably". A wrong food ruling costs nothing, and a split is content, not a failure |
| `dissent` | 0.15 | A dissent chip is cheap and fun |
| `family` | 0.7 | Enough mass to say "definitely a Shell, the court is split on which" |
| `wet` | 0.6 | Leans against a false "Wet" title. 20/20 on the labelled items |
| `rice` | 0.4 | Mochi picks rice at 0.47 to 0.50, and nothing else sits between 0.01 and 0.69 |
| `dependsOnServing` | 0.5 | Show the chip when Jev leans yes. Plain pie (0.56) gets it, philly cheesesteak (0.46) does not |
| `yes` / `no` | 0.7 / 0.3 | Face Nouls. The Noul page's three-way split. Middle values show as unsure. A 0.6 / 0.4 band cut more nulls on tune but added wrong readings on canon |
| `interiorYes` / `interiorNo` | 0.6 / 0.4 | Solid block, middle layer and loose pieces. Cut eyes nulls on tune from 31% to 23% with no new wrong reading. The muffin clause chip stays on `yes` (0.7): its note says "raw and unsliced", and the lower bar added it to flat fried dough such as beaver tails |
| `abusive` | 0.5 | Midway between the highest score on anything that should get a ruling (0.22) and the lowest on an abusive probe (0.86). Declining a real dish is embarrassing, but a shared link must never show hateful text as a ruling |
| `publicAbusive` | 0.05 | Public lists only. Hides five rude-sounding dishes (slippery nipple shot 0.31, slutty brownies 0.11, faggots and peas 0.06, angry whopper and gypsy tart 0.05) and no other item that reaches it. A missing list entry costs nothing |
| `publicPrivatePerson` | 0.15 | Public lists only. On tune any bar from 0.1 to 0.2 hides every private person and nothing else. 0.15 sits between the highest score on anything else (0.06, my coworkers) and the lowest on a private person (0.29, an invented full name) |

## Abstract phrases

Product call: a phrase that names something, even something abstract like a feeling or a mood ("purple tuesday feelings", "existential dread"), gets an honorary ruling. Something with no solid form is an honorary salad, so the card reads "If it were food, it would definitely be a salad." Text that names nothing, such as keyboard mashing, a greeting, chat filler ("lol ok") or a command to the app, stays nonsense.

The honorary card is the more fun answer, and it is no riskier: the nonsense card echoes the text too, and the abuse guard runs before either. Question set 6 made the call explicit by listing a feeling among the things that are not food, with "a bad mood" as an example. All six abstract phrases in the eval now read not_food at 0.90 or more and get an honorary salad.

## Verification

- **Live smoke call** (`hot dog`, question set 2, 2026-09-22): 8,580 input tokens and 551 output tokens, 483 ms round trip. That is about $0.00036 per uncached call at TypeSafe's [published price](https://docs.typesafe.ai/models.md) of $0.042 per million input tokens. Jev chose Taco with confidence 1.0, `is_abusive` was 0.01, the eyes read Taco and agreed, and `debate_heat` was 2.93 (Friendship-ending).
- **Vitest** (`pnpm vitest run --project core`): normalization fuzzing and the URL round trip, canonical query rejection, official lookups including `constructor` and `__proto__`, a shape table for every face-defined ruling on the site, mapper scenarios (apple pie slice, cheesecake, ramen, tomato soup, humans), the abuse guard, every public list gate with its boundaries and benign lookalikes, the lists wire validators, mock invariants, a fake-fetch round trip through the real `TypeSafeClient`, and the request fingerprint.
- **Type assertions** (`pnpm --filter @cube/core typecheck`): every Choice narrows to its option ids, the Score's probability keys are `"0" | "1" | "2" | "3"`, a missing option is a compile error, and the wire types match the error code map.

## Known risks

- **Name bias.** Jev reads literally, and in evals the pull came from example strings that share a word with `item` more than from option keys. Question set 4 took the shared words out of the contrasts, and question set 5 glossed the shared-word examples (pigs in a blanket, egg roll, lobster roll, maki roll). Sausage roll still reads calzone (0.63 in question set 6) after four rounds of wording, including a `sushi.includes` sentence about pastry rolled and cut to length that only moved cinnamon roll the wrong way. The "bun ... hinged" lobster roll gloss of question set 5 pulled sloppy joe from sandwich 0.95 to 0.76; dropping the word bun brought it back to 0.81. Name traps make this visible. If glossing examples stops helping, try neutral option keys and map them back in code.
- **Cost of the eyes.** The 8 geometry Nouls roughly double the tokens, because each repeats the structural starch definition. To drop them, delete the Nouls, `readEyes` and the `eyes` and `muffinClause` fields, then bump the version.
- **Eyes limits.** They cannot express two adjacent walls or a corner, contradictory face answers give `null` or a wrong reading, and cheesecake or an uncut sub may disagree with the ruling. Frame a disagreement as "Jev's eyes vs Jev's gut", not as a correction.
- **Honorary path.** "Treat the shell as starch" is an indirection, which the Jev jaggedness page lists as a weak spot. Expect noisier answers there.
- **Unknown full names.** Jev cannot know that a name belongs to nobody famous. An invented full name scored public 0.69 and private 0.29, which the 0.15 bar still hides, but a name that sounds more famous could score lower. `MIN_ASKS` and the blocklist are the backstops.
- **Personal info patterns are rules, not understanding.** `hasPersonalInfo` catches plain and spelled-out forms: 7 or more digits counting digit words said in a row ("eight six seven five three oh nine"), `@`, URLs, a dot between words or before a common top-level domain (spaced or `。`), "dot" before one, bracketed "[at]" and "(dot)", "x at y dot z", webmail names, underscores, `$handles` and platform names such as instagram or venmo. It still misses street addresses, numbers read as teens and tens ("twelve thirty four"), top-level domains outside its list when spelled out, and anything creative enough. The person gate, `MIN_ASKS` and the blocklist are the backstops.
- **Drinks named after famous people** (an arnold palmer, a shirley temple) read as public. That is harmless: public figures are listed.
- **Abuse guard coverage.** One Noul will not catch everything. The eval's 21 abusive probes avoid extreme slurs and all scored high, so a novel slur or coded hate term may score lower than they did. Cached answers are public by URL, but the canonical key limits any damage to that one query.
- **Official lookup scope.** Only exact names match, after stripping a leading article and a trailing plural. Plain "pie", "quesadilla", "sub" and "sub sandwich" are left out on purpose because the site qualifies them. [canon-audit.md](canon-audit.md) records the audit behind the table.
- **Model upgrades.** Moving to a new Jev means rerunning the eval, then bumping `CUBE_MODEL` and `QUESTION_SET_VERSION` together.
- **Attribution.** The rice clause and "humans are just ravioli" quote cuberule.com, so the UI credits the site. Brand names appear only as text.

## Evaluating

1. **Build a labelled set:** every `OFFICIAL_RULINGS` alias, about 40 held-out foods labelled by two people (gyro, crunchwrap, spring roll, s'more, bao, tostada, burrito bowl, poke bowl, onigiri, club sandwich, folded quesadilla), not-food items, nonsense, the name-bias probes, benign dishes with rude-sounding names, and abusive probes stored base64-encoded for the abuse guard.
2. **Run each item once** and store the raw `{ model, answers, usage }`. `toCubeResult` is pure, so every threshold can then be tuned offline.
3. **Score Jev's own `ruling.category`**, not the final `category`, because the official override makes canonical items trivially correct. Plot confidence against accuracy to set `unanimous` and `majority`.
4. **Check the flags:** per-face accuracy of the eyes and their null rate, `is_wet` on soup, ramen, cereal and poutine, `varies_by_serving` on pie and quesadilla, and the `is_abusive` detection and false-decline rates.
5. **Repeat a handful of calls** to check consistency, then tune `THRESHOLDS`, keep the model pinned, and bump `QUESTION_SET_VERSION` whenever a question changes.

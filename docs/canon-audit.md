# Canon audit

`OFFICIAL_RULINGS` in `packages/core/src/official.ts` claims to hold only rulings published on cuberule.com. This page records the last check of that claim. `packages/core/src/official.test.ts` pins the audited table, so any change to the canon fails a test until someone audits it again and updates this page.

## Audit of 2026-09-22

- **Source:** the raw HTML of https://cuberule.com/, fetched with curl. GitHub Pages served it with `Last-Modified: Thu, 28 May 2026 05:29:52 GMT` and `ETag: "6a17d2d0-7cdf"`.
- **Method:** every key in `OFFICIAL_RULINGS` was checked against the site's example captions, the qualifier printed under each caption, and the image alt text. Nothing was taken from memory or from the tweet image.

### Changes

| Entry | Before | After | Why |
| --- | --- | --- | --- |
| `sub sandwich` | taco (uncut) | removed | The site only rules the uncut sub. A sub sliced all the way through is a sandwich, so the bare name cannot claim canon. `uncut sub` and `uncut sub sandwich` stay |
| `vanilla soy latte` | note "a three-bean soup wet salad" | note "a three-bean wet salad" | The site strikes "soup" out |
| `muffin` | note "blocks of starch are toast, in raw unsliced form" | note "in raw, unsliced form" | The site's own qualifier. The muffin clause chip already explains blocks of starch |
| `human`, `humans` | note "humans are just ravioli" | note "humans are just ravioli, per food critic Soleil Ho" | The site credits the ruling to Soleil Ho |

Nothing was added.

### What the site rules, and the keys we match

| Cube | Site caption (qualifier) | Keys |
| --- | --- | --- |
| Toast | pizza; nigiri sushi; pumpkin pie slice (bent toast) | pizza, nigiri, nigiri sushi, pumpkin pie slice, slice of pumpkin pie |
| Toast | Muffins or other blocks of starch (in raw, unsliced form) | muffin |
| Sandwich | quesadilla (non-folded); toast (pictured as a toast sandwich); victoria sponge cake | non folded quesadilla, unfolded quesadilla, flat quesadilla, toast sandwich, victoria sponge, victoria sponge cake, victoria sandwich |
| Taco | hot dog; sub sandwich (uncut); slice of pie (taco on its side) | hot dog, hotdog, uncut sub, uncut sub sandwich, slice of pie, pie slice, slice of cherry pie, cherry pie slice |
| Sushi | falafel wrap; pigs in a blanket; enchilada | falafel wrap, pigs in a blanket, pig in a blanket, pigs in blankets, enchilada |
| Quiche | cheesecake; soup (in a bread bowl); falafel pita; deep-dish pizza; salad (in a bread bowl); key lime pie | cheesecake, soup in a bread bowl, bread bowl soup, falafel pita, deep dish pizza, salad in a bread bowl, key lime pie |
| Calzone | burrito; corn dog; pie (whole); dumplings; pop-tarts; uncrustables (unbitten) | burrito, corn dog, corndog, whole pie, dumpling, pop tart, poptart, uncrustable |
| Salad | steak; mashed potatoes (creamy & smooth); flan; turducken (with sausage stuffing); chocolate; soup (a wet salad) | steak, mashed potatoes, mashed potato, flan, turducken, chocolate, soup, tomato soup |
| Salad | Vanilla Soy Latte: a three-bean wet salad | vanilla soy latte |
| Cake | lasagna; big mac; flapjacks | lasagna, lasagne, big mac, flapjacks, stack of flapjacks, stack of pancakes |
| Nachos | poutine; lucky charms; salad with croutons; fried noodles; couscous; ramen (wet nachos) | poutine, lucky charms, salad with croutons, caesar salad with croutons, fried noodles, couscous, ramen |
| Honorary calzone | Humans, as defined by food critic Soleil Ho: "humans are just ravioli" | human, humans |

`findOfficialRuling` also strips a leading article, dashes, apostrophes and a trailing plural, so "Pop-Tarts" and "dumplings" match without extra keys.

### Rules the audit applied

- **Aliases.** A key may be a spelling of the site's name (hotdog, corndog, poptart, lasagne, deep dish), a singular or plural, the food's other common name (Victoria sandwich is the same cake as Victoria sponge), or the site's own alt text for the photo (tomato soup, caesar salad with croutons, pigs in blankets, slice of cherry pie, stack of flapjacks). The flapjacks are pictured as pancakes with syrup and butter, so "stack of pancakes" names the same photo.
- **Qualifiers.** A bare name keeps a qualified ruling only when the qualifier describes the usual form: an Uncrustable is sold unbitten, a muffin comes unsliced, mashed potatoes are served smooth and a turducken's stuffing is not structural. The note still shows the qualifier on the card. When the qualifier picks one of several common forms, only the qualified name matches: plain "quesadilla", "pie", "sub" and "sub sandwich" have no canon, and plain "soup" is the site's wet salad, not the bread bowl.
- **Cube names.** Salad, toast, sandwich, taco, quiche, calzone and nachos rule as their own cube, since the site names each cube after its archetype. The site's sandwich slide captions a toast sandwich as "toast", so that photo is keyed as "toast sandwich" and plain "toast" stays with the Toast cube. Sushi and cake are left to Jev: the site files nigiri sushi under toast, Victoria sponge cake under sandwich and cheesecake under quiche, so the bare words do not pick one cube.
- **Humans.** The site does not name a cube for humans. Ravioli is pasta sealed on every side, like the site's own calzone examples (dumplings, pop-tarts), so humans rule as an honorary calzone.
- **Alt text not trusted.** The quiche and calzone slides reuse alt text from the taco slide ("a hot dog", "a sub-style sandwich", "a slice of cherry pie"), so no alias comes from those slides.

### Cube geometry

The site's cube drawings, by alt text: toast has the bottom face solid; sandwich the bottom and top; taco the bottom and two sides; sushi the bottom, top and two sides; quiche the bottom and all four sides; calzone all six; salad none; cake three stacked layers; nachos a smaller solid cube inside. `CATEGORIES` in `packages/core/src/categories.ts` matches every face set, and `Cube3D` draws the nachos interior as a smaller starch cube, like the site.

### Credits, as the site states them

- The Cube Rule slide credits "the holy prophet @Phosphatide" and links the original tweet, https://twitter.com/Phosphatide/status/974067376894328833.
- The closing slide says the site is made by @indirect and links https://twitter.com/indirect.
- The humans ruling credits food critic Soleil Ho.

The app credits @Phosphatide for the Cube Rule and @indirect for cuberule.com in the footer of every view, in the about section and in the README.

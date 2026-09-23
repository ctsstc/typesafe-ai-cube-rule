import {
  CATEGORIES,
  type CategoryFamily,
  type CategoryId,
  type CubeResult,
  type CubeRuling,
  describeCategory,
  type FoodResult,
  type HonoraryResult,
  RICE_CLAUSE,
  STARCHES,
} from "@cube/core";
import type { RulingErrorCode } from "./api";
import { formatPercent, lowerFirst, sentenceCase } from "./format";
import { pickVariant } from "./hash";

export const APP_NAME = "Cube Rule Oracle";

export type Band = "sure" | "leans" | "torn" | "baffled";

export function bandOf(ruling: CubeRuling): Band {
  if (ruling.verdict === "unanimous") return "sure";
  if (ruling.verdict === "majority") return "leans";
  return ruling.dissent ? "torn" : "baffled";
}

const FAMILY_PHRASE: Readonly<Record<CategoryFamily, string>> = {
  layered: "layered",
  shell: "a shell",
  loose: "loose",
};

const noun = (id: CategoryId) => CATEGORIES[id].noun;

export function probabilityOf(ruling: CubeRuling, id: CategoryId): number {
  return ruling.odds.find((o) => o.id === id)?.probability ?? 0;
}

export function confidenceLine(item: string, ruling: CubeRuling): string {
  const a = noun(ruling.category);
  const dissent = ruling.dissent;
  const b = dissent ? noun(dissent.id) : "";
  const family = ruling.family;
  switch (bandOf(ruling)) {
    case "sure":
      return pickVariant(item, "sure", [
        "Jev is sure.",
        "No notes. Case closed.",
        "Jev didn't even blink.",
      ]);
    case "leans":
      if (dissent) {
        return `Jev leans ${a}, with a dissent for ${b} (${formatPercent(dissent.probability)}).`;
      }
      return pickVariant(item, "leans", [
        `Jev leans ${a}.`,
        `Probably ${a}. Jev wouldn't bet the bakery on it.`,
      ]);
    case "torn": {
      const sameFamily =
        dissent !== null && CATEGORIES[dissent.id].family === CATEGORIES[ruling.category].family;
      if (family && sameFamily) {
        const fam = FAMILY_PHRASE[family.family];
        return pickVariant(item, "torn-family", [
          `Definitely ${fam}. Jev is torn between ${a} and ${b}.`,
          `${sentenceCase(fam)}, for sure. The argument is ${a} versus ${b}.`,
        ]);
      }
      if (family) {
        return `Definitely ${FAMILY_PHRASE[family.family]}. The court is split on which kind.`;
      }
      return pickVariant(item, "torn", [
        `Jev is torn between ${a} and ${b}.`,
        `Split decision: ${a} or ${b}. Depends how you hold it.`,
      ]);
    }
    case "baffled":
      if (family) {
        return `Jev can't name the cube, but it's definitely ${FAMILY_PHRASE[family.family]}.`;
      }
      return pickVariant(item, "baffled", [
        "Jev is baffled. This food defies geometry.",
        "The cube cannot contain this one.",
      ]);
  }
}

export interface OfficialCopy {
  readonly agrees: boolean;
  readonly text: string;
}

export function officialCopy(result: FoodResult | HonoraryResult): OfficialCopy | null {
  const { official, ruling } = result;
  if (!official) return null;
  const phrase = describeCategory(official.category);
  const note = official.note ? ` (${official.note})` : "";
  if (official.jevAgrees) {
    return { agrees: true, text: `Canon agrees: cuberule.com also rules it ${phrase}${note}.` };
  }
  const own = describeCategory(ruling.category);
  return {
    agrees: false,
    text: `Jev dissents. cuberule.com rules it ${phrase}${note}, but Jev on its own says ${own} (${formatPercent(probabilityOf(ruling, ruling.category))}).`,
  };
}

export interface StampCopy {
  readonly label: string;
  readonly ghost: string | null;
  readonly variant: "normal" | "torn" | "baffled" | "honorary" | "uncubeable" | "question";
}

export function stampFor(result: CubeResult): StampCopy | null {
  switch (result.kind) {
    case "declined":
      return null;
    case "nonsense":
      return { label: "Uncubeable", ghost: null, variant: "uncubeable" };
    case "honorary":
      return { label: CATEGORIES[result.category].name, ghost: null, variant: "honorary" };
    case "food": {
      if (result.official) return { label: result.title, ghost: null, variant: "normal" };
      const band = bandOf(result.ruling);
      if (band === "torn" && result.ruling.dissent) {
        return {
          label: `${result.title}?`,
          ghost: `${CATEGORIES[result.ruling.dissent.id].name}?`,
          variant: "torn",
        };
      }
      if (band === "baffled") return { label: `${result.title}?`, ghost: null, variant: "baffled" };
      return { label: result.title, ghost: null, variant: "normal" };
    }
  }
}

export function verdictLine(result: Exclude<CubeResult, { kind: "declined" }>): string {
  if (result.kind === "food") return result.headline;
  if (result.kind === "honorary") return "Not food. Probably.";
  return "Uncubeable.";
}

export interface ExtraChip {
  readonly id: string;
  readonly label: string;
  readonly swatch?: string;
}

export function extraChips(result: FoodResult): ExtraChip[] {
  const chips: ExtraChip[] = [];
  if (result.starch) {
    const starch = STARCHES[result.starch];
    chips.push({
      id: "starch",
      label: `Starch: ${starch.label.toLowerCase()}`,
      swatch: starch.color,
    });
  }
  if (result.wet) chips.push({ id: "wet", label: "Served wet" });
  if (result.dependsOnServing) chips.push({ id: "serving", label: "Depends how it's served" });
  if (result.riceClause) chips.push({ id: "rice", label: "Rice clause" });
  if (result.muffinClause) chips.push({ id: "muffin", label: "Muffin clause" });
  for (const trap of result.nameTraps) {
    chips.push({ id: `trap-${trap}`, label: `Name trap: ${noun(trap)}` });
  }
  chips.push({ id: "debate", label: `Debate: ${result.debate.label}` });
  return chips;
}

export function extraNotes(result: FoodResult): string[] {
  const notes: string[] = [];
  for (const trap of result.nameTraps) {
    notes.push(`The name says ${noun(trap)}. The starch says ${noun(result.category)}.`);
  }
  if (result.dependsOnServing) {
    notes.push("The starch moves depending on how it's served. This ruling is for the usual form.");
  }
  if (result.muffinClause) {
    notes.push("One solid block of starch counts as toast. That's the muffin clause.");
  }
  if (result.riceClause) notes.push(`Rice clause, straight from cuberule.com: "${RICE_CLAUSE}"`);
  return notes;
}

export function shareText(result: CubeResult): string | null {
  const food = sentenceCase(result.item);
  switch (result.kind) {
    case "declined":
    case "nonsense":
      return null;
    case "honorary":
      return `Jev says ${result.item} isn't food. ${result.headline}`;
    case "food": {
      const { ruling, official } = result;
      if (official && !official.jevAgrees) {
        return `${food}? ${result.headline} But Jev dissents: ${describeCategory(ruling.category)} (${formatPercent(probabilityOf(ruling, ruling.category))}).`;
      }
      if (!official && bandOf(ruling) === "torn" && ruling.dissent) {
        const top = `${noun(ruling.category)} (${formatPercent(probabilityOf(ruling, ruling.category))})`;
        const second = `${noun(ruling.dissent.id)} (${formatPercent(ruling.dissent.probability)})`;
        return `Jev is torn on ${result.item}: ${top} or ${second}. Settle it.`;
      }
      const pct = formatPercent(probabilityOf(ruling, result.category));
      return `${food}? ${result.headline} Jev gives it ${pct}. The cube has spoken.`;
    }
  }
}

export function resultTitle(result: CubeResult): string {
  const food = sentenceCase(result.item);
  switch (result.kind) {
    case "declined":
      return `Declined | ${APP_NAME}`;
    case "nonsense":
      return `${food}: uncubeable | ${APP_NAME}`;
    case "honorary":
      return `${food}: not food | ${APP_NAME}`;
    case "food":
      return `${food}: ${lowerFirst(result.headline.replace(/\.$/, ""))} | ${APP_NAME}`;
  }
}

export const HOME_TITLE = `${APP_NAME}: is a hot dog a sandwich?`;

export interface HeroQuestion {
  readonly question: string;
  readonly food: string;
  readonly category: CategoryId;
}

export const HERO_QUESTIONS: readonly [HeroQuestion, ...HeroQuestion[]] = [
  { question: "Is a hot dog a sandwich?", food: "hot dog", category: "sandwich" },
  { question: "Is a Pop-Tart a calzone?", food: "pop-tart", category: "calzone" },
  { question: "Is lasagna cake?", food: "lasagna", category: "cake" },
  { question: "Is pizza toast?", food: "pizza", category: "toast" },
  { question: "Is a burrito sushi?", food: "burrito", category: "sushi" },
  { question: "Is cheesecake a quiche?", food: "cheesecake", category: "quiche" },
  { question: "Is ramen nachos?", food: "ramen", category: "nachos" },
  { question: "Is a lobster roll a taco?", food: "lobster roll", category: "taco" },
  { question: "Is steak a salad?", food: "steak", category: "salad" },
];

export function heroQuestion(date = new Date()): HeroQuestion {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const day = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86_400_000,
  );
  return HERO_QUESTIONS[day % HERO_QUESTIONS.length] ?? HERO_QUESTIONS[0];
}

export const LOADING_LINES = [
  "Locating structural starch.",
  "Checking both ends.",
  "Measuring crust coverage.",
  "Consulting the cube.",
] as const;

export const STILL_THINKING = "Still thinking. Jev is usually faster than this.";

export interface ErrorCopy {
  readonly title: string;
  readonly body: string;
  readonly action: "retry" | "edit";
}

function resetTime(retryAfter: number | null): string {
  if (!retryAfter || retryAfter <= 0) return "midnight UTC";
  const reset = new Date(Date.now() + retryAfter * 1000);
  return `${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} your time`;
}

export function errorCopy(code: RulingErrorCode, retryAfter: number | null): ErrorCopy {
  switch (code) {
    case "rate_limited":
      return {
        title: "Too many cubes in the oven.",
        body:
          retryAfter && retryAfter > 0
            ? `Jev is fielding a lot of rulings. Try again in ${retryAfter} seconds.`
            : "Jev is fielding a lot of rulings. Try again in a moment.",
        action: "retry",
      };
    case "upstream_busy":
      return {
        title: "The oracle is overheated.",
        body: "Give it a moment and try again.",
        action: "retry",
      };
    case "timeout":
      return {
        title: "Jev is thinking unusually hard.",
        body: "That took too long. Want to try again?",
        action: "retry",
      };
    case "offline":
      return {
        title: "You're offline.",
        body: "The cube needs the internet to rule. Try again once you're back.",
        action: "retry",
      };
    case "network":
      return {
        title: "Couldn't reach the oracle.",
        body: "Check your connection and try again.",
        action: "retry",
      };
    case "bad_request":
      return {
        title: "That doesn't look like a food name.",
        body: "Letters, numbers, spaces, and apostrophes work best.",
        action: "edit",
      };
    case "challenge_required":
      return {
        title: "Couldn't confirm you're human.",
        body: "Cloudflare's quick check didn't go through, so Jev wasn't asked. Try again. If it keeps failing, a content blocker may be stopping challenges.cloudflare.com.",
        action: "retry",
      };
    case "daily_limit":
      return {
        title: "The oracle is resting until tomorrow.",
        body: `Jev has ruled on all the new foods it can today. New foods open again at ${resetTime(retryAfter)}. Foods someone has already asked about still work.`,
        action: "edit",
      };
    case "method_not_allowed":
    case "not_found":
    case "upstream_error":
    case "internal":
      return {
        title: "Something broke on our side.",
        body: "It's not you, and it's not the food.",
        action: "retry",
      };
  }
}

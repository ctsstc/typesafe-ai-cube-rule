import stats from "virtual:eval-stats";
import { CUBE_ANSWER_TYPES } from "@cube/core";
import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { Header } from "./Header";
import { HowJevRules } from "./HowJevRules";

// lib/evalStats.test.ts pins these to eval/results/v<QUESTION_SET_VERSION>/summary.json.
const { holdout, canon } = stats;

function section() {
  render(<HowJevRules />);
  return screen.getByRole("region", { name: "How Jev rules" });
}

describe("How Jev rules", () => {
  it("says it is unofficial before anything else", () => {
    const region = section();
    const heading = within(region).getByRole("heading", { level: 2 });
    const first = heading.nextElementSibling;
    expect(first?.tagName).toBe("P");
    expect(first).toHaveTextContent(
      /^Unofficial\. This fan app is not affiliated with or endorsed by TypeSafe, cuberule\.com or its creators\./,
    );
  });

  it("leads with the holdout score from the current eval summary", () => {
    const region = section();
    const rate = `${((holdout.all.hits / holdout.all.n) * 100).toFixed(1)}%`;
    const [firstStat] = within(region).getAllByRole("listitem");
    expect(firstStat).toHaveTextContent(`${rate}right on held-out items`);

    const row = within(region).getByRole("row", { name: /^Holdout\s/ });
    expect(row).toHaveTextContent(`${rate} (${holdout.all.hits} of ${holdout.all.n})`);
    const strict = within(region).getByRole("row", { name: /^Holdout, without/ });
    expect(strict).toHaveTextContent(`(${holdout.notInPrompt.hits} of ${holdout.notInPrompt.n})`);
    expect(region).toHaveTextContent(
      `${holdout.sure.hits} of ${holdout.sure.n} rulings we would print as Definitely were right`,
    );
  });

  it("says how often holdout was looked at, without claiming it never shaped a decision", () => {
    const region = section();
    expect(region).toHaveTextContent(
      `looked at only after each version of the questions was final (${stats.holdoutChecks} times so far), never while writing questions`,
    );
    expect(region.textContent).not.toMatch(/never tuned|number to trust/i);
  });

  it("discloses how many holdout and canon items leak into the questions", () => {
    const region = section();
    const holdoutNamed = holdout.all.n - holdout.notInPrompt.n;
    const canonNamed = canon.all.n - canon.notInPrompt.n;
    expect(region).toHaveTextContent(
      `${holdoutNamed} of the ${holdout.all.n} holdout items and ${canonNamed} of the ${canon.all.n} canon items are named`,
    );
  });

  it("counts the questions from the request Jev actually gets", () => {
    const region = section();
    const total = Object.keys(CUBE_ANSWER_TYPES).length;
    expect(
      within(region).getByRole("heading", { name: `One order, ${total} questions` }),
    ).toBeInTheDocument();
    const counts = [...region.querySelectorAll("article li > strong")]
      .map((el) => /^(\d+) (Choice|Score|Noul)/.exec(el.textContent ?? "")?.[1])
      .filter(Boolean)
      .map(Number);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(total);
  });

  it("labels the latency as a laptop measurement and keeps cache claims hedged", () => {
    const region = section();
    expect(region).toHaveTextContent(`${stats.latency.p50Ms} msmedian Jev call, from a laptop`);
    expect(region).toHaveTextContent("the developer's laptop calling TypeSafe's API directly");
    expect(region).toHaveTextContent("usually $0");
    expect(region).toHaveTextContent("Jev usually isn't asked twice");
    expect(region.textContent).not.toMatch(/up from|always free|costs nothing/i);
  });

  it("keeps confidence apart from probability", () => {
    expect(section()).toHaveTextContent("it is not a probability itself");
  });

  it("links only to TypeSafe's own sites, the repo and Claude Code", () => {
    const hosts = within(section())
      .getAllByRole("link")
      .map((a) => new URL(a.getAttribute("href") ?? "", location.href).host);
    expect(new Set(hosts)).toEqual(
      new Set(["typesafe.ai", "docs.typesafe.ai", "github.com", "claude.com"]),
    );
    expect(screen.getByRole("link", { name: "docs/eval.md on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/ctsstc/typesafe-ai-cube-rule/blob/main/docs/eval.md",
    );
  });

  it("is reachable from the header nav", () => {
    render(<Header />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "How Jev rules" })).toHaveAttribute(
      "href",
      "#how-jev-rules",
    );
  });

  it("loads into the home page with no axe violations", async () => {
    history.replaceState(null, "", "/");
    render(<App />);
    const region = await screen.findByRole("region", { name: "How Jev rules" });
    expect(region).toHaveAttribute("id", "how-jev-rules");
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

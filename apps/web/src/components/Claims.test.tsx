import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { PEOPLE_WROTE_IT } from "../test/claims";

describe("UI copy", () => {
  it("never claims people wrote every word", async () => {
    history.replaceState(null, "", "/");
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    expect(document.body.textContent).not.toMatch(PEOPLE_WROTE_IT);
  });

  it("says the words are templates and the site was built with Claude Code", async () => {
    history.replaceState(null, "", "/");
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    expect(document.body.textContent).toContain("templates in our code");
    expect(document.body.textContent).toContain("built with Claude Code");
  });

  it("never says holdout was never tuned against, since docs/eval.md gates decisions on it", async () => {
    history.replaceState(null, "", "/");
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    expect(document.body.textContent).not.toMatch(/never tuned/i);
  });

  it("has a pattern that catches the claims it is meant to", () => {
    for (const claim of [
      "Every word on this page was written by people.",
      "Every sentence on this site was written by a person.",
      "People wrote every word here.",
    ]) {
      expect(claim).toMatch(PEOPLE_WROTE_IT);
    }
    expect("Jev only returns numbers. The words are templates in our code.").not.toMatch(
      PEOPLE_WROTE_IT,
    );
  });
});

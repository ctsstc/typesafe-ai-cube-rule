import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { clearClassifyCache } from "../lib/api";
import { heroQuestion } from "../lib/copy";
import { response } from "../test/fixtures";

function serve() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const item = new URL(url, location.origin).searchParams.get("food") ?? "";
      return new Response(JSON.stringify(response(item)), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function outline(): string[] {
  return [...document.querySelectorAll("h1, h2, h3, h4")].map(
    (h) => `${h.tagName.toLowerCase()} ${h.textContent?.replace(/\s+/g, " ").trim()}`,
  );
}

async function expectNoAxeViolations() {
  const results = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe("page outline", () => {
  const hero = heroQuestion();

  beforeEach(() => {
    clearClassifyCache();
    serve();
  });
  afterEach(() => history.replaceState(null, "", "/"));

  it("leads the home page with the daily question", () => {
    history.replaceState(null, "", "/");
    render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      hero.question,
    ]);
    expect(screen.getByRole("region", { name: hero.question })).toContainElement(
      screen.getByRole("textbox", { name: "Name a food" }),
    );
  });

  it("makes a deep-linked ruling the page heading and drops an unrelated daily question", async () => {
    const food = hero.food === "steak" ? "flan" : "steak";
    history.replaceState(null, "", `/?food=${food}`);
    render(<App />);
    const ruling = await screen.findByRole("heading", {
      level: 1,
      name: new RegExp(`^${food}: Officially`, "i"),
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([ruling]);
    expect(screen.queryByText(hero.question)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Jev's probabilities/ })).toBeVisible();
    const levels = outline().map((line) => Number(line[1]));
    expect(levels.every((level, i) => i === 0 || level <= (levels[i - 1] ?? 0) + 1)).toBe(true);
    await expectNoAxeViolations();
  });

  it("keeps the daily question as a kicker when the ruling answers it", async () => {
    history.replaceState(null, "", `/?food=${encodeURIComponent(hero.food)}`);
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: /: / });
    const kicker = screen.getByText(hero.question);
    expect(kicker.tagName).toBe("P");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows the deep-link placeholder as the page heading while loading", () => {
    history.replaceState(null, "", "/?food=hot+dog");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Consulting the cube");
    expect(screen.getByRole("region", { name: "Name a food" })).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const chunk = vi.hoisted(() => {
  let arrive = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return { arrive, arrived };
});

vi.mock("./components/HowJevRules", async (importOriginal) => {
  await chunk.arrived;
  return importOriginal();
});

afterEach(() => history.replaceState(null, "", "/"));

describe("opening the page at a section's hash", () => {
  // Without scroll anchoring (Safari before 27), content that renders above the target later
  // pushes it off screen, so the scroll has to wait for How Jev rules.
  it("scrolls to #about only after How Jev rules above it has rendered", async () => {
    history.replaceState(null, "", "/#about");
    const scrolled: string[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this.id);
    });
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolled).toEqual([]);

    chunk.arrive();
    await screen.findByRole("region", { name: "How Jev rules" });
    await vi.waitFor(() => expect(scrolled).toEqual(["about"]));
  });
});

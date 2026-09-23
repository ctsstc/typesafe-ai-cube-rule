import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const chunks = vi.hoisted(() => {
  const gate = () => {
    let arrive = () => {};
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    return { arrive, arrived };
  };
  return { jev: gate(), about: gate() };
});

vi.mock("./components/HowJevRules", async (importOriginal) => {
  await chunks.jev.arrived;
  return importOriginal();
});

vi.mock("./components/About", async (importOriginal) => {
  await chunks.about.arrived;
  return importOriginal();
});

afterEach(() => history.replaceState(null, "", "/"));

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("opening the page at a section's hash", () => {
  // Without scroll anchoring (Safari before 27), content that renders above the target later
  // pushes it off screen, so the scroll has to wait for How Jev rules and About.
  it("scrolls to #about only after How Jev rules and About have both rendered", async () => {
    history.replaceState(null, "", "/#about");
    const scrolled: string[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this.id);
    });
    render(<App />);
    await settle();
    expect(scrolled).toEqual([]);

    chunks.jev.arrive();
    await settle();
    expect(scrolled).toEqual([]);
    expect(screen.queryByRole("region", { name: "How Jev rules" })).not.toBeInTheDocument();

    chunks.about.arrive();
    await screen.findByRole("region", { name: "About the Oracle" });
    expect(screen.getByRole("region", { name: "How Jev rules" })).toBeInTheDocument();
    await vi.waitFor(() => expect(scrolled).toEqual(["about"]), { timeout: 5000 });
  });
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { About } from "./About";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("credits the Cube Rule and cuberule.com the way the site does", () => {
    render(<Footer model={null} />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(
      "The Cube Rule is by @Phosphatide. cuberule.com is by @indirect.",
    );
    const link = (name: string) => within(footer).getByRole("link", { name });
    expect(link("@Phosphatide")).toHaveAttribute("href", "https://twitter.com/Phosphatide");
    expect(link("cuberule.com")).toHaveAttribute("href", "https://cuberule.com/");
    expect(link("@indirect")).toHaveAttribute("href", "https://twitter.com/indirect");
    expect(link("TypeSafe")).toHaveAttribute("href", "https://typesafe.ai/");
  });

  it("links to How Jev rules", () => {
    render(<Footer model={null} />);
    expect(screen.getByRole("link", { name: "How Jev rules" })).toHaveAttribute(
      "href",
      "#how-jev-rules",
    );
  });

  it.each([
    ["footer", () => render(<Footer model={null} />).getByRole("contentinfo")],
    ["about section", () => render(<About />).getByRole("region", { name: "About the Oracle" })],
  ])("credits the author, Claude Code and the source in the %s", (_where, mount) => {
    const scope = mount();
    expect(scope).toHaveTextContent(
      "Made by Cody Swartz (GitHub, LinkedIn). Built with Claude Code. Source code on GitHub.",
    );
    const link = (name: string) => within(scope).getByRole("link", { name });
    const expected: [string, string][] = [
      ["Cody Swartz on GitHub", "https://github.com/ctsstc"],
      ["Cody Swartz on LinkedIn", "https://linkedin.com/in/codyswartz/"],
      ["Claude Code", "https://claude.com/claude-code"],
      ["Source code on GitHub", "https://github.com/ctsstc/typesafe-ai-cube-rule"],
    ];
    for (const [name, href] of expected) {
      expect(link(name)).toHaveAttribute("href", href);
      expect(link(name)).toHaveAttribute("rel", "noopener");
    }
    expect(within(scope).queryByRole("link", { name: /codyswartz\.us/ })).toBeNull();
    expect(scope.innerHTML).not.toContain("codyswartz.us");
  });
});

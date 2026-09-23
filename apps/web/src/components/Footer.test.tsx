import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  });
});

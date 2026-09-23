import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { About } from "./About";

function privacyList(): HTMLElement {
  render(<About />);
  const article = screen.getByRole("heading", { name: "What gets sent where" }).closest("article");
  if (!article) throw new Error("What gets sent where has no article");
  return article;
}

describe("About: what gets sent where", () => {
  it("says foods go in the page address and stay out of Web Analytics", () => {
    const text = privacyList().textContent ?? "";
    expect(text).toContain("/?food=");
    expect(text).toContain("browser history");
    expect(text).toContain("Cloudflare Web Analytics counts page views without cookies");
    expect(text).toContain("strips ?food= before reporting");
  });

  it("says what Turnstile sees and that it can load with a shared link", () => {
    const text = privacyList().textContent ?? "";
    expect(text).toContain("the moment you open a shared link");
    expect(text).toContain("It sees your IP address, your browser and the page address");
    expect(text).not.toMatch(/never (?:when the page opens|on page load)/i);
  });

  it("claims only the cookie this site sets, not every cookie", () => {
    const text = privacyList().textContent ?? "";
    expect(text).toContain("the only cookie this site sets");
    expect(text.match(/only cookie(?! this site sets)/g)).toBeNull();
  });

  it("does not promise counters or IPs vanish on a schedule", () => {
    const text = privacyList().textContent ?? "";
    expect(text).toContain("the next time anyone passes the check");
    expect(text).toContain("database restore can bring them back for up to 30 days");
    expect(text).not.toMatch(/deleted once the day is over|first request after/i);
  });

  it("says what the public lists show and what they screen out", () => {
    const text = privacyList().textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain(
      "A food can show up in the public lists on this page the first time anyone asks about it, if it passes the checks: nothing abusive, no private people, no contact details and no gibberish.",
    );
    expect(text).toContain(
      "The lists started with foods from our own testing and foods people had already asked about, some from before the lists existed.",
    );
    expect(text).toContain("The server notes when each food was first asked");
    expect(text).toContain("never who asked, and no times");
    expect(text).toContain(
      "Pattern rules and Jev's own reading screen out names of private people, phone numbers, email addresses, links and anything flagged as abusive",
    );
    expect(text).toContain("No screen catches everything");
    expect(text).toContain("Who asked is not stored.");
    expect(text).not.toMatch(/anonymous|guarantee/i);
    expect(text).not.toMatch(/at least twice|two different browsers|two asks|second ask/i);
  });

  it("links the Cloudflare, Turnstile and TypeSafe privacy policies", () => {
    const list = privacyList();
    const expected: [string, string][] = [
      ["Turnstile privacy addendum", "https://www.cloudflare.com/turnstile-privacy-policy/"],
      ["Cloudflare's privacy policy", "https://www.cloudflare.com/privacypolicy/"],
      ["TypeSafe's privacy policy", "https://typesafe.ai/legal/privacy-policy"],
    ];
    for (const [name, href] of expected) {
      const link = within(list).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("rel", "noopener");
    }
  });
});

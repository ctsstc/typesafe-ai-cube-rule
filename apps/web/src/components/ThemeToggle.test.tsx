import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { THEME_KEY } from "../lib/theme";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  it("cycles system, light, dark and remembers the choice", () => {
    render(<ThemeToggle />);
    const root = document.documentElement;
    const button = () => screen.getByRole("button");

    expect(button()).toHaveAccessibleName("Theme: system. Switch to light.");
    expect(root.dataset.theme).toBeUndefined();

    fireEvent.click(button());
    expect(button()).toHaveAccessibleName("Theme: light. Switch to dark.");
    expect(root.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");

    fireEvent.click(button());
    expect(button()).toHaveAccessibleName("Theme: dark. Switch to system.");
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");

    fireEvent.click(button());
    expect(button()).toHaveAccessibleName("Theme: system. Switch to light.");
    expect(root.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("starts from the stored preference", () => {
    localStorage.setItem(THEME_KEY, "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Theme: dark. Switch to system.");
  });

  it("keeps the browser chrome color in step with an override", () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#fbf6ec" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#17120d" media="(prefers-color-scheme: dark)">';
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    const colors = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
      (m) => m.content,
    );
    expect(colors).toEqual(["#17120d", "#17120d"]);
  });
});

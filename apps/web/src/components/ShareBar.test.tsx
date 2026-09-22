import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncerProvider } from "./Announcer";
import { ShareBar } from "./ShareBar";

const restores: Array<() => void> = [];

function stubNavigator(name: "share" | "clipboard", value: unknown) {
  const had = Object.hasOwn(navigator, name);
  const previous = Object.getOwnPropertyDescriptor(navigator, name);
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  restores.push(() => {
    if (had && previous) Object.defineProperty(navigator, name, previous);
    else Reflect.deleteProperty(navigator, name);
  });
}

function renderBar(text: string | null = "Hot dog? Officially a taco.") {
  return render(
    <AnnouncerProvider>
      <ShareBar item="hot dog" text={text} onCubeAnother={() => {}} />
    </AnnouncerProvider>,
  );
}

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("ShareBar", () => {
  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
  });

  it("uses the Web Share API with the ruling text and deep link", async () => {
    const share = vi.fn(async () => {});
    stubNavigator("share", share);
    renderBar();
    await click("Share ruling");
    expect(share).toHaveBeenCalledWith({
      title: "Cube Rule Oracle",
      text: "Hot dog? Officially a taco.",
      url: `${location.origin}/?food=hot+dog`,
    });
  });

  it("stays quiet when the share sheet is cancelled", async () => {
    stubNavigator(
      "share",
      vi.fn(async () => Promise.reject(new DOMException("", "AbortError"))),
    );
    const writeText = vi.fn(async () => {});
    stubNavigator("clipboard", { writeText });
    renderBar();
    await click("Share ruling");
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText("Link copied.")).not.toBeInTheDocument();
  });

  it("copies the link when Web Share is missing", async () => {
    stubNavigator("share", undefined);
    const writeText = vi.fn(async () => {});
    stubNavigator("clipboard", { writeText });
    renderBar();
    await click("Share ruling");
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/?food=hot+dog`);
    expect(screen.getByText("Link copied.")).toBeInTheDocument();
  });

  it("shows a selectable link when the clipboard refuses", async () => {
    stubNavigator("clipboard", {
      writeText: vi.fn(async () => Promise.reject(new Error("denied"))),
    });
    renderBar();
    await click("Copy link");
    const field = screen.getByRole("textbox", { name: "Link to this ruling" });
    expect(field).toHaveValue(`${location.origin}/?food=hot+dog`);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByText("Couldn't copy. Here's the link:")).toBeInTheDocument();
  });

  it("hides the share button when there is nothing to share", () => {
    renderBar(null);
    expect(screen.queryByRole("button", { name: "Share ruling" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});

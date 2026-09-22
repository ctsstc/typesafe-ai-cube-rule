import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { clearClassifyCache } from "./lib/api";
import { noul, response } from "./test/fixtures";

function serve(body: (item: string) => unknown, status = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    const item = new URL(url, location.origin).searchParams.get("food") ?? "";
    return new Response(JSON.stringify(body(item)), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const input = () => screen.getByRole("textbox", { name: "Name a food" });
const submit = (value: string) => {
  fireEvent.change(input(), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Cube it" }));
};

describe("App", () => {
  beforeEach(() => {
    clearClassifyCache();
    history.replaceState(null, "", "/");
  });
  afterEach(() => history.replaceState(null, "", "/"));

  it("rules on a deep link and prefills the input once Jev has cleared it", async () => {
    history.replaceState(null, "", "/?food=Hot%20Dog");
    const fetchMock = serve((item) => response(item));
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Hot dog: Officially a taco." }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/api/classify?food=hot+dog&v=2", expect.anything());
    expect(input()).toHaveValue("hot dog");
    expect(document.title).toBe("Hot dog: officially a taco | Cube Rule Oracle");
  });

  it("never echoes a declined deep link, in the page, the input, or the URL", async () => {
    history.replaceState(null, "", "/?food=some+nasty+words");
    serve((item) => response(item, { is_abusive: noul(0.99) }));
    const { container } = render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Jev declines to cube that." }),
    ).toBeVisible();
    await waitFor(() => expect(location.search).toBe(""));
    expect(container).not.toHaveTextContent(/nasty/);
    expect(document.body).not.toHaveTextContent(/nasty/);
    expect(input()).toHaveValue("");
    expect(document.title).toBe("Declined | Cube Rule Oracle");
  });

  it("validates on submit only", () => {
    serve((item) => response(item));
    render(<App />);
    fireEvent.change(input(), { target: { value: "" } });
    expect(screen.queryByText("Type a food first.")).not.toBeInTheDocument();
    submit("   ");
    expect(screen.getByText("Type a food first.")).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input()).toHaveAccessibleDescription(
      "Singular works best. Jev only sees the name. Type a food first.",
    );
    submit("!!!");
    expect(screen.getByText("That needs at least one letter.")).toBeInTheDocument();
  });

  it("rules on typed input, pushes a shareable URL, and flags mock mode", async () => {
    const fetchMock = serve((item) => response(item, {}, true));
    render(<App />);
    submit("Lasagna");
    expect(await screen.findByRole("heading", { name: "Lasagna: Officially cake." })).toBeVisible();
    expect(location.search).toBe("?food=lasagna");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("complementary", { name: "Demo mode" })).toHaveTextContent(
      "these rulings are simulated",
    );
  });

  it("rules text with no letters as uncubeable without calling the API", async () => {
    const fetchMock = serve((item) => response(item));
    render(<App />);
    submit("1234");
    expect(await screen.findByRole("heading", { name: "1234: Uncubeable." })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores an earlier ruling on back without refetching", async () => {
    const fetchMock = serve((item) => response(item));
    render(<App />);
    submit("pizza");
    await screen.findByRole("heading", { name: "Pizza: Officially toast." });
    submit("burrito");
    await screen.findByRole("heading", { name: "Burrito: Officially a calzone." });
    act(() => {
      history.back();
    });
    await waitFor(() => expect(location.search).toBe("?food=pizza"));
    expect(await screen.findByRole("heading", { name: "Pizza: Officially toast." })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a 503 to the overheated panel", async () => {
    serve(() => ({ error: { code: "upstream_busy", message: "busy" } }), 503);
    render(<App />);
    submit("taco salad");
    expect(await screen.findByText("The oracle is overheated.")).toBeVisible();
  });

  it("passes axe on the home page", async () => {
    render(<App />);
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("links the skip link to the food input and credits the Cube Rule", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Skip to the oracle" })).toHaveAttribute(
      "href",
      "#food-input",
    );
    expect(screen.getAllByRole("link", { name: "@Phosphatide" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "cuberule.com" }).length).toBeGreaterThan(0);
  });
});

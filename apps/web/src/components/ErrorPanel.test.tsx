import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RulingError } from "../lib/api";
import { ErrorPanel } from "./ErrorPanel";

function show(error: RulingError) {
  const onRetry = vi.fn();
  const onEdit = vi.fn();
  render(<ErrorPanel error={error} onRetry={onRetry} onEdit={onEdit} />);
  return { onRetry, onEdit };
}

describe("ErrorPanel", () => {
  it("rests until tomorrow on daily_limit and points at other foods", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T21:00:00Z"));
    const { onEdit, onRetry } = show(new RulingError("daily_limit", 3 * 3600));
    expect(screen.getByText("The oracle is resting until tomorrow.")).toBeInTheDocument();
    expect(screen.getByText(/New foods open again at .+ your time\./)).toBeInTheDocument();
    expect(screen.getByText(/already asked about still work/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Try another food" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("offers a retry when the human check fails", async () => {
    const { onRetry } = show(new RulingError("challenge_required"));
    expect(screen.getByText("Couldn't confirm you're human.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(["not_found", "method_not_allowed"] as const)("treats %s as our fault", (code) => {
    show(new RulingError(code));
    expect(screen.getByText("Something broke on our side.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

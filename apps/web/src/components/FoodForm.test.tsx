import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FoodForm } from "./FoodForm";

function Harness({ onSubmit }: { readonly onSubmit: (item: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <FoodForm
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      onSurprise={() => {}}
      inputRef={createRef<HTMLInputElement>()}
    />
  );
}

describe("FoodForm", () => {
  it("submits the normalized food when Enter is pressed in the input", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name a food" }), "  Banh MI?{Enter}");
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("banh mi");
  });

  it("asks for a food instead of submitting an empty input", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name a food" }), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Type a food first.")).toBeInTheDocument();
  });
});

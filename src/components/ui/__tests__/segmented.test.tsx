// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Segmented } from "@/components/ui/Segmented";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
] as const;

describe("Segmented", () => {
  it("marks the picked option and calls onChange when another is clicked", () => {
    const onChange = vi.fn();
    render(<Segmented value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick" />);
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("disables one option without disabling the rest (independent of the group's own disabled)", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B", disabled: true, title: "Not available while viewing another branch" },
      { value: "c", label: "C" },
    ] as const;
    render(<Segmented value="a" options={options} onChange={onChange} ariaLabel="Pick" />);
    const b = screen.getByRole("radio", { name: "B" });
    expect(b).toHaveProperty("disabled", true);
    expect(b).toHaveAttribute("title", "Not available while viewing another branch");
    fireEvent.click(b);
    expect(onChange).not.toHaveBeenCalled();
    // The others stay pickable.
    expect(screen.getByRole("radio", { name: "A" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("radio", { name: "C" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("radio", { name: "C" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("skips a disabled option when moving with the arrow keys, and wraps around", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B", disabled: true },
      { value: "c", label: "C" },
    ] as const;
    render(<Segmented value="a" options={options} onChange={onChange} ariaLabel="Pick" />);
    const group = screen.getByRole("radiogroup", { name: "Pick" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    // B is disabled, so ArrowRight from A goes straight to C.
    expect(onChange).toHaveBeenCalledWith("c");
    onChange.mockClear();
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    // ArrowLeft from A wraps past the disabled B to C as well.
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("does nothing on arrow keys when every option is disabled", () => {
    const onChange = vi.fn();
    const options = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B", disabled: true },
    ] as const;
    render(<Segmented value="a" options={options} onChange={onChange} ariaLabel="Pick" />);
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Pick" }), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves the roving tab stop off a picked option that becomes disabled, so Tab still reaches the group", () => {
    const options = [
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B" },
    ] as const;
    // "a" is both the picked value and disabled (e.g. the mode you were on became unavailable).
    render(<Segmented value="a" options={options} onChange={vi.fn()} ariaLabel="Pick" />);
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("tabIndex", "0");
  });

  it("still disables every option through the group-level disabled prop", () => {
    render(<Segmented value="a" options={OPTIONS} onChange={vi.fn()} disabled ariaLabel="Pick" />);
    for (const label of ["A", "B", "C"]) {
      expect(screen.getByRole("radio", { name: label })).toHaveProperty("disabled", true);
    }
  });

  it("fills the container and splits it evenly between pieces when fill is set", () => {
    render(<Segmented value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" fill />);
    const group = screen.getByRole("radiogroup", { name: "Pick" });
    expect(group.className).toContain("w-full");
    expect(screen.getByRole("radio", { name: "A" }).className).toContain("flex-1");
  });

  it("accepts a node (not just plain text) as a piece's label", () => {
    const options = [
      { value: "a", label: "Plain" },
      {
        value: "b",
        label: (
          <>
            Commit <span data-testid="sha">abc1234</span>
          </>
        ),
      },
    ] as const;
    render(<Segmented value="a" options={options} onChange={vi.fn()} ariaLabel="Pick" />);
    expect(screen.getByTestId("sha")).toHaveTextContent("abc1234");
    expect(screen.getByRole("radio", { name: "Commit abc1234" })).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FilterDropdown, type FilterDropdownOption } from "@/components/ui/FilterDropdown";

afterEach(cleanup);

const STATE_OPTIONS: FilterDropdownOption<"open" | "closed" | "all">[] = [
  { value: "open", label: "열림" },
  { value: "closed", label: "닫힘" },
  { value: "all", label: "전체" },
];

function StatefulDropdown() {
  const [value, setValue] = useState<"open" | "closed" | "all">("open");
  return <FilterDropdown label="상태" value={value} options={STATE_OPTIONS} onChange={setValue} />;
}

describe("FilterDropdown", () => {
  it("shows the row name and the current value's label on the trigger", () => {
    render(<FilterDropdown label="상태" value="open" options={STATE_OPTIONS} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "상태 열림" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a checked ContextMenu anchored under the trigger", () => {
    render(<FilterDropdown label="상태" value="open" options={STATE_OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "상태 열림" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const openItem = screen.getByRole("menuitem", { name: "열림" });
    const closedItem = screen.getByRole("menuitem", { name: "닫힘" });
    expect(openItem.querySelector("svg")).toBeTruthy();
    expect(closedItem.querySelector("svg")).toBeNull();
  });

  it("picks a different option, updates the trigger's value, and closes the menu", () => {
    render(<StatefulDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "상태 열림" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "닫힘" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "상태 닫힘" })).toBeInTheDocument();
  });

  it("closes without calling onChange when the already-picked option is clicked again", () => {
    const onChange = vi.fn();
    render(<FilterDropdown label="상태" value="open" options={STATE_OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "상태 열림" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "열림" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

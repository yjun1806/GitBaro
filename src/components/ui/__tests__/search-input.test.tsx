// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { SearchInput } from "@/components/ui/TextInput";

afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

// D-medium #6: className이 안쪽 <input>으로 가서, 레이아웃 클래스(flex-1 등)를 넘긴 호출부
// (RepoTree, RepoListView)에서 칸 자체가 늘어나지 않았다. wrapperClassName으로 칸을, className으로
// 안쪽 <input>을 분리해서 받는다.
describe("SearchInput layout", () => {
  it("sends wrapperClassName to the outer box and className to the input", () => {
    const { container } = render(
      <SearchInput aria-label="filter" wrapperClassName="flex-1 min-w-0" className="font-mono" value="" onChange={vi.fn()} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("min-w-0");
    expect(wrapper.className).not.toContain("font-mono");

    const input = screen.getByRole("textbox", { name: "filter" });
    expect(input.className).toContain("font-mono");
  });

  it("shows a focus-within ring on the wrapper, not only on the input", () => {
    const { container } = render(<SearchInput aria-label="filter" value="" onChange={vi.fn()} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("focus-within:ring-2");
  });
});

function ClearableSearch() {
  const [value, setValue] = useState("abc");
  return (
    <SearchInput
      aria-label="sidebar search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClear={() => setValue("")}
    />
  );
}

describe("SearchInput clearing", () => {
  it("shows the clear button only once there is a value", () => {
    const { rerender } = render(<SearchInput aria-label="filter" value="" onChange={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SearchInput aria-label="filter" value="abc" onChange={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: i18n.t("common.clearSearch") })).toBeTruthy();
  });

  it("clears on the clear button click", () => {
    render(<ClearableSearch />);
    const input = screen.getByRole("textbox", { name: "sidebar search" }) as HTMLInputElement;
    expect(input.value).toBe("abc");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.clearSearch") }));
    expect(input.value).toBe("");
  });

  it("clears on Escape (real keydown on the input) when there is a value to clear", () => {
    render(<ClearableSearch />);
    const input = screen.getByRole("textbox", { name: "sidebar search" }) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });

  it("leaves other keys to the caller's own onKeyDown", () => {
    const onKeyDown = vi.fn();
    render(<SearchInput aria-label="filter" value="abc" onChange={vi.fn()} onClear={vi.fn()} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "filter" }), { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalled();
  });
});

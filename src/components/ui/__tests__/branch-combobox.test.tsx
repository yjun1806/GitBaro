// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { BranchCombobox } from "@/components/ui/BranchCombobox";
import type { BranchInfo } from "@/types";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

function branch(name: string): BranchInfo {
  return { name, isRemote: false, isHead: false } as BranchInfo;
}

// D-high #3: 목록이 `absolute`였을 때는 감싼 창(overflow-y-auto 몸통)이나 overflow-hidden 카드에
// 잘렸다. `AnchoredPanel`(position: fixed + 뷰포트 클램프)로 옮겨서 어떤 조상의 overflow에도
// 잘리지 않게 한다 — fixed는 조상의 overflow: hidden을 타지 않는다.
describe("BranchCombobox dropdown positioning", () => {
  it("renders its open list as position: fixed, not absolute (so ancestor overflow-hidden can't clip it)", () => {
    render(
      <div style={{ overflow: "hidden", height: 40 }}>
        <BranchCombobox value="" branches={[branch("main"), branch("feature/x")]} onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    const list = screen.getByRole("listbox");
    // The panel is the listbox's positioned ancestor (AnchoredPanel's own div).
    const panel = list.closest('[role="dialog"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.style.position).toBe("fixed");
  });

  it("selects a branch from the list and closes", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value="" branches={[branch("main"), branch("feature/x")]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: /feature\/x/ }));
    expect(onChange).toHaveBeenCalledWith("feature/x");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters the list as the search box changes", () => {
    render(
      <BranchCombobox value="" branches={[branch("main"), branch("feature/x")]} onChange={vi.fn()} placeholder="Pick" />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText(i18n.t("branch.filterBranches")), { target: { value: "feat" } });
    expect(screen.getByRole("option", { name: /feature\/x/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
  });
});

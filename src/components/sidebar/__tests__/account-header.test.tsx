// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { AccountHeader } from "../AccountHeader";

beforeEach(async () => {
  await i18n.changeLanguage("ko");
});
afterEach(cleanup);

function renderHeader(label = "MONDAYOVERSLEEPCLUB") {
  return render(
    <AccountHeader
      label={label}
      accountKey="acme"
      repoCount={5}
      ownerType="Organization"
      sortMode="custom"
      showActions
      expanded
      onToggle={vi.fn()}
    />,
  );
}

describe("AccountHeader", () => {
  it("gives the account name priority width instead of a fixed-width text sort button", () => {
    renderHeader();
    // The name renders in full (not pre-truncated to a fixed character count) —
    // CSS `truncate` handles overflow, so the DOM text itself must be complete.
    expect(screen.getByText("MONDAYOVERSLEEPCLUB")).toBeInTheDocument();
    // The old text sort button ("사용자 지정 순서 ▾") that used to eat the width is gone.
    expect(screen.queryByText(/사용자 지정 순서/)).toBeNull();
  });

  it("renders the sort control as an icon-only button that still names its mode", () => {
    renderHeader();
    const sortButton = screen.getByRole("button", { name: /정렬: 사용자 지정 순서/ });
    expect(sortButton).toHaveAttribute("title", expect.stringContaining("사용자 지정 순서"));
    expect(sortButton.textContent).toBe("");
  });

  it("keeps the sort and new-workspace buttons keyboard-reachable even though they're visually hidden by default", () => {
    renderHeader();
    // Not `hidden`/`display:none` — just opacity-0 until hover/focus-within/open,
    // so Tab can still reach them and screen readers still see them.
    const sortButton = screen.getByRole("button", { name: /정렬:/ });
    const newWorkspaceButton = screen.getByRole("button", { name: "새 워크스페이스" });
    expect(sortButton).toBeVisible();
    expect(newWorkspaceButton).toBeVisible();
  });

  it("opens the sort menu from the icon button and can change modes", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /정렬:/ }));
    expect(screen.getByRole("menu", { name: "정렬" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "이름순" })).toBeInTheDocument();
  });
});

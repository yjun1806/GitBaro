// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { StashEntry } from "@/types";
import { StashList } from "../StashList";

Element.prototype.scrollIntoView = vi.fn();
const writeText = vi.fn(async (_text: string) => {});

const stashes: StashEntry[] = [
  { index: 0, message: "WIP on main: tidy", commitId: "abc123", branchName: "main", timestamp: 1 },
];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(cleanup);

function renderList() {
  const handlers = { onSelectStash: vi.fn(), onApply: vi.fn(), onPop: vi.fn(), onDrop: vi.fn() };
  render(<StashList stashes={stashes} selectedIndex={null} {...handlers} />);
  fireEvent.contextMenu(screen.getByText("stash@{0}").closest("button")!);
  return handlers;
}
const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });

describe("StashList menu", () => {
  it("lists apply and pop, copy items, and drop last", () => {
    renderList();
    const groups = Array.from(screen.getByRole("menu").children).map((g) =>
      within(g as HTMLElement)
        .queryAllByRole("menuitem")
        .map((b) => b.textContent),
    );
    expect(groups.filter((g) => g.length > 0)).toEqual([
      [i18n.t("stash.apply"), i18n.t("stash.pop")],
      ["Copy stash message", i18n.t("history.contextMenu.copyHash")],
      [i18n.t("stash.drop")],
    ]);
  });

  it("copies the stash commit SHA", () => {
    renderList();
    fireEvent.click(menuItem(i18n.t("history.contextMenu.copyHash")));
    expect(writeText).toHaveBeenCalledWith("abc123");
  });

  it("drops only after the confirm dialog", () => {
    const { onDrop } = renderList();
    fireEvent.click(menuItem(i18n.t("stash.drop")));
    expect(onDrop).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: i18n.t("stash.drop") }));
    expect(onDrop).toHaveBeenCalledWith(0);
  });

  it("keeps acting on the same stash when a new one pushes it down the list", () => {
    const handlers = { onSelectStash: vi.fn(), onApply: vi.fn(), onPop: vi.fn(), onDrop: vi.fn() };
    const { rerender } = render(<StashList stashes={stashes} selectedIndex={null} {...handlers} />);
    fireEvent.contextMenu(screen.getByText("stash@{0}").closest("button")!);
    const shifted: StashEntry[] = [
      { index: 0, message: "WIP on main: newer", commitId: "def456", branchName: "main", timestamp: 2 },
      { ...stashes[0], index: 1 },
    ];
    rerender(<StashList stashes={shifted} selectedIndex={null} {...handlers} />);
    fireEvent.click(menuItem(i18n.t("stash.apply")));
    expect(handlers.onApply).toHaveBeenCalledWith(1);
  });

  it("closes the menu when its stash disappears", () => {
    const handlers = { onSelectStash: vi.fn(), onApply: vi.fn(), onPop: vi.fn(), onDrop: vi.fn() };
    const { rerender } = render(<StashList stashes={stashes} selectedIndex={null} {...handlers} />);
    fireEvent.contextMenu(screen.getByText("stash@{0}").closest("button")!);
    const other: StashEntry[] = [{ index: 0, message: "other", commitId: "zzz999", branchName: "main", timestamp: 3 }];
    rerender(<StashList stashes={other} selectedIndex={null} {...handlers} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/i18n/config";
import { BranchContextMenu } from "../BranchContextMenu";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

function renderMenu(over: Partial<Parameters<typeof BranchContextMenu>[0]> = {}) {
  const props = {
    isCurrent: false,
    isDefault: false,
    isRemote: false,
    position: { x: 0, y: 0 },
    onView: vi.fn(),
    onCheckout: vi.fn(),
    onCompare: vi.fn(),
    onMerge: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onCopyName: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<BranchContextMenu {...props} />);
  return props;
}
const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });

describe("BranchContextMenu", () => {
  it("views without checkout and keeps delete last", () => {
    const props = renderMenu();
    const labels = within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent);
    expect(labels[0]).toBe("View without checkout");
    expect(labels[labels.length - 1]).toBe(i18n.t("branch.contextMenu.delete"));
    fireEvent.click(menuItem("View without checkout"));
    expect(props.onView).toHaveBeenCalled();
  });

  it("offers GitHub only for a branch that is on GitHub", () => {
    renderMenu();
    expect((menuItem("View on GitHub") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const onOpenOnGitHub = vi.fn();
    renderMenu({ onOpenOnGitHub });
    fireEvent.click(menuItem("View on GitHub"));
    expect(onOpenOnGitHub).toHaveBeenCalled();
  });

  it("blocks view, checkout and delete on the current branch", () => {
    renderMenu({ isCurrent: true });
    for (const name of ["View without checkout", i18n.t("branch.contextMenu.checkout"), i18n.t("branch.contextMenu.delete")]) {
      expect((menuItem(name) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

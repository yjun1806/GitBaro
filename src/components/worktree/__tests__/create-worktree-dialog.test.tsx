// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import type { BranchInfo, WorktreeInfo } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

function branch(name: string): BranchInfo {
  return { name, isRemote: false, isHead: false } as BranchInfo;
}

function renderDialog(onClose = vi.fn()) {
  const branches = [branch("main"), branch("feature/login")];
  const worktrees: WorktreeInfo[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateWorktreeDialog repoPath="/repos/app" branches={branches} worktrees={worktrees} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

// D-high #3: BranchCombobox의 목록을 CreateWorktreeDialog(Dialog 안) 안에서 열어도 잘리지 않고
// 정상 동작해야 한다 — AnchoredPanel로 옮긴 뒤 Dialog 안에 중첩되는 첫 사례라 통합 테스트로 확인한다.
describe("CreateWorktreeDialog branch combobox", () => {
  it("opens the branch list inside the dialog, selects a branch, and fills the path", () => {
    renderDialog();
    const trigger = screen.getByRole("button", { name: i18n.t("worktree.selectBranch") });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: /feature\/login/ }));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "feature/login" })).toBeTruthy();
  });

  it("closes only the branch list on Escape, leaving the worktree dialog itself open", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("worktree.selectBranch") }));
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: i18n.t("worktree.create") })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

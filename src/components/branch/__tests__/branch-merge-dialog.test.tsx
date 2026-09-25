// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useToastStore } from "@/stores/toast";

const mergeBranch = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock("@/api/commands", () => ({ mergeBranch }));
vi.mock("@/hooks/useRepoAccountId", () => ({ useRepoAccountId: () => "acc-1" }));
vi.mock("@/api/queries", () => ({
  useBranchComparison: () => ({ data: { behindCount: 2 }, isLoading: false, error: null }),
  useMergeConflictCheck: () => ({ data: { canFastForward: false, hasConflicts: false, conflictFiles: [] }, isLoading: false }),
}));

const { BranchMergeDialog } = await import("../BranchMergeDialog");

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mergeBranch.mockClear();
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BranchMergeDialog repoPath="/r/app" currentBranch="main" source="feat/x" isDirty={false} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("BranchMergeDialog", () => {
  it("merges the row's branch into the current branch only after the command is confirmed", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("merge.incomingCount", { count: 2 }) }));
    expect(mergeBranch).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1];
    expect(within(confirm).getByText("git merge --no-ff feat/x")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: i18n.t("common.proceed") }));
    await waitFor(() => expect(mergeBranch).toHaveBeenCalledWith("/r/app", "feat/x", "merge", "acc-1"));
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.type)).toEqual(["success"]));
  });

  it("does not merge when the confirmation is cancelled", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("merge.incomingCount", { count: 2 }) }));
    const dialogs = screen.getAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1];
    fireEvent.click(within(confirm).getByRole("button", { name: i18n.t("common.cancel") }));
    expect(mergeBranch).not.toHaveBeenCalled();
  });
});

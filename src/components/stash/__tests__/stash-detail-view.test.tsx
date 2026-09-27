// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import type { StashShowResult } from "@/types";

const invoke = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined as unknown));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

let showResult: StashShowResult;

vi.mock("@/api/queries", () => ({
  useStashShow: () => ({ data: showResult, isLoading: false }),
  useCommitFileDiff: () => ({ data: null }),
  useStashMutations: () => ({
    apply: { mutateAsync: vi.fn() },
    pop: { mutateAsync: vi.fn() },
    drop: { mutateAsync: vi.fn() },
  }),
}));

vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));

const { StashDetailView } = await import("../StashDetailView");

const REPO = "/work/app";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  useToastStore.setState({ toasts: [] });
  useRepositoryStore.setState({ activeRepoPath: REPO });
  showResult = {
    entry: { index: 0, message: "WIP on main", branchName: "main", timestamp: 1_700_000_000, commitId: "c1" },
    files: [
      { path: "a.ts", status: "modified", insertions: 1, deletions: 0 },
      { path: "b.ts", status: "deleted", insertions: 0, deletions: 3 },
    ],
  };
});

afterEach(cleanup);

describe("StashDetailView file double-click", () => {
  it("opens the file in the editor", () => {
    render(<StashDetailView stashIndex={0} />);
    fireEvent.doubleClick(screen.getByTitle("a.ts"));
    expect(invoke).toHaveBeenCalledWith("open_in_editor", { repoPath: REPO, filePath: "a.ts" });
  });

  it("does not open a deleted file, and explains why", () => {
    render(<StashDetailView stashIndex={0} />);
    fireEvent.doubleClick(screen.getByTitle("b.ts"));
    expect(invoke).not.toHaveBeenCalledWith("open_in_editor", expect.anything());
    const { toasts } = useToastStore.getState();
    expect(toasts[toasts.length - 1]?.message).toBe(i18n.t("menu.cannotOpenDeleted"));
  });
});

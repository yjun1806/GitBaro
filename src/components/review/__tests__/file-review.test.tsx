// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useHistoryViewStore } from "@/stores/history-view";
import { useFileReviewStore } from "@/stores/file-review";
import { MaximizedFileList } from "@/components/layout/MaximizedFileList";
import { useCompareBaseStore } from "../compare-base";
import type { BranchChangedFile, BranchChanges } from "@/types";

const APP = "/work/app";

function file(path: string, blobId: string): BranchChangedFile {
  return { path, oldPath: null, status: "modified", additions: 1, deletions: 0, isBinary: false, blobId };
}

function changes(files: BranchChangedFile[]): BranchChanges {
  return {
    path: APP,
    branch: "feat/noti",
    headOid: "h",
    defaultBranch: "main",
    baseRef: "main",
    baseStatus: "found",
    mergeBaseOid: "b",
    committed: files,
    uncommitted: [],
    files,
  };
}

let current: BranchChanges = changes([]);
const getChangesVsDefault = vi.fn(async (_path: string) => current);
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  getChangesVsDefault: (path: string) => getChangesVsDefault(path),
  getFileDiffVsDefault: async () => null,
  getBranches: async () => [
    { name: "feat/noti", isHead: true, isRemote: false },
    { name: "main", isHead: false, isRemote: false, isDefault: true },
  ],
  getWorktrees: async () => [],
}));
vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const { FilesByRepo } = await import("../FilesByRepo");

function renderFiles() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FilesByRepo repos={[{ path: APP, name: "app" }]} />
    </QueryClientProvider>,
  );
  return client;
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest("[role=button]") as HTMLElement;
}

function progress(): string {
  return screen.getByTestId("viewed-progress").textContent ?? "";
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  current = changes([file("a.ts", "blob-a"), file("b.ts", "blob-b")]);
  getChangesVsDefault.mockClear();
  useUIStore.setState({ isSwitchingBranch: false });
  useCompareBaseStore.setState({ baseByPath: {} });
  useHistoryViewStore.getState().reset();
  useRepositoryStore.setState({ activeRepoPath: null });
  useFileReviewStore.setState({ marksByRepo: {}, collapseViewed: false });
});

afterEach(cleanup);

describe("per-file viewed marks in the changes list", () => {
  it("shows progress and dims a file once it is checked", async () => {
    renderFiles();
    await screen.findByText("a.ts");
    expect(progress()).toContain("0 of 2 files viewed");

    fireEvent.click(within(row("a.ts")).getByRole("checkbox"));

    expect(within(row("a.ts")).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(row("a.ts").dataset.viewed).toBe("true");
    expect(row("b.ts").dataset.viewed).toBeUndefined();
    expect(progress()).toContain("1 of 2 files viewed");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });

  it("does not open the file when the checkbox is clicked", async () => {
    renderFiles();
    await screen.findByText("a.ts");
    fireEvent.click(within(row("a.ts")).getByRole("checkbox"));

    expect(row("a.ts").getAttribute("aria-selected")).toBe("false");
  });

  it("clears the mark when the file content changes", async () => {
    const client = renderFiles();
    await screen.findByText("a.ts");
    fireEvent.click(within(row("a.ts")).getByRole("checkbox"));
    expect(progress()).toContain("1 of 2");

    current = changes([file("a.ts", "blob-a2"), file("b.ts", "blob-b")]);
    await act(() => client.invalidateQueries({ queryKey: ["changesVsDefault"] }));

    await waitFor(() => expect(progress()).toContain("0 of 2"));
    expect(row("a.ts").dataset.viewed).toBeUndefined();
    await waitFor(() => expect(useFileReviewStore.getState().marksByRepo).toEqual({}));
  });

  it("collapses viewed files into one group at the bottom and expands it again", async () => {
    renderFiles();
    await screen.findByText("a.ts");
    fireEvent.click(within(row("a.ts")).getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Collapse viewed" }));

    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(screen.getByTestId("viewed-group").textContent).toContain("1 viewed");

    fireEvent.click(screen.getByTestId("viewed-group"));

    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.queryByTestId("viewed-group")).toBeNull();
  });

  it("marks and unmarks a file from its right-click menu", async () => {
    renderFiles();
    await screen.findByText("a.ts");

    fireEvent.contextMenu(row("b.ts"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as viewed" }));
    expect(progress()).toContain("1 of 2");

    fireEvent.contextMenu(row("b.ts"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unmark as viewed" }));
    expect(progress()).toContain("0 of 2");
  });

  it("marks and unmarks every file from the list header menu", async () => {
    renderFiles();
    await screen.findByText("a.ts");

    fireEvent.contextMenu(screen.getByTestId("files-list-header"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark all as viewed" }));
    expect(progress()).toContain("2 of 2");

    fireEvent.contextMenu(screen.getByTestId("files-list-header"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unmark all" }));
    expect(progress()).toContain("0 of 2");
  });

  it("forgets marks whose branch was deleted", async () => {
    useFileReviewStore.setState({
      marksByRepo: {
        [APP]: {
          k: { branch: "feat/deleted", base: "main", path: "a.ts", contentId: "blob-a", at: 1 },
        },
      },
    });
    renderFiles();
    await screen.findByText("a.ts");

    await waitFor(() => expect(useFileReviewStore.getState().marksByRepo).toEqual({}));
  });
});

describe("MaximizedFileList viewed marks", () => {
  it("shows a checkbox per row only when the list supports marks", () => {
    const onToggleViewed = vi.fn();
    const onSelect = vi.fn();
    const items = [
      { key: "a", path: "src/a.ts", status: "modified" as const, viewed: true },
      { key: "b", path: "src/b.ts", status: "modified" as const, viewed: false },
    ];
    const { rerender } = render(
      <MaximizedFileList items={items} selectedKey={null} onSelect={onSelect} onToggleViewed={onToggleViewed} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);

    fireEvent.click(boxes[1]);
    expect(onToggleViewed).toHaveBeenCalledWith("b");
    expect(onSelect).not.toHaveBeenCalled();

    rerender(<MaximizedFileList items={items} selectedKey={null} onSelect={onSelect} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

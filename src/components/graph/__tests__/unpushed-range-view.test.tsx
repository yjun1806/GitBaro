// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useHistoryViewStore } from "@/stores/history-view";
import type { HistoryTarget, RangeChangedFile } from "@/types";
import { useRangeOpenForCurrentScope, useUnpushedRangeViewStore } from "../unpushed-range-view";

vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));

const REPO = "/work/app";
const HEAD: HistoryTarget = { kind: "head" };

const rangeCalls: { path: string | null; base: string | null; head: string | null }[] = [];
const diffCalls: { path: string | null; base: string | null; head: string | null; file: string | null }[] = [];
let files: RangeChangedFile[] = [];

vi.mock("@/api/queries", () => ({
  useRangeChangedFiles: (path: string | null, base: string | null, head: string | null) => {
    rangeCalls.push({ path, base, head });
    return { data: files, isLoading: false, isError: false };
  },
  useRangeFileDiff: (
    path: string | null,
    base: string | null,
    head: string | null,
    file: { path: string; oldPath: string | null } | null,
  ) => {
    diffCalls.push({ path, base, head, file: file?.path ?? null });
    return { data: null, isLoading: false, isError: false };
  },
}));

const { UnpushedRangeDetailPane } = await import("../UnpushedRangeView");

function file(path: string, extra: Partial<RangeChangedFile> = {}): RangeChangedFile {
  return { path, oldPath: null, status: "modified", additions: 1, deletions: 0, isBinary: false, tooLarge: false, ...extra };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  rangeCalls.length = 0;
  diffCalls.length = 0;
  files = [];
  useUnpushedRangeViewStore.getState().close();
});

afterEach(cleanup);

describe("UnpushedRangeDetailPane", () => {
  it("renders nothing when no range is open", () => {
    const { container } = render(<UnpushedRangeDetailPane />);
    expect(container.textContent).toBe("");
  });

  it("reads the changed files for base..head and shows the title, file count and totals", () => {
    files = [file("src/a.ts", { additions: 4, deletions: 1 }), file("src/b.ts", { additions: 2, deletions: 3 })];
    useUnpushedRangeViewStore.getState().open({ repoPath: REPO, historyTarget: HEAD, baseOid: "c3", headOid: "c1" });
    render(<UnpushedRangeDetailPane />);
    // base·head는 그대로 조회에 넘어간다(경계가 앉은 커밋 → 열린 워크트리의 HEAD).
    expect(rangeCalls[rangeCalls.length - 1]).toEqual({ path: REPO, base: "c3", head: "c1" });
    expect(screen.getByText("Not pushed yet · what pushing will send")).toBeTruthy();
    expect(screen.getByText("2 changed files")).toBeTruthy();
    // 파일 전체 합(+6 −4)은 각 줄의 합과 겹치지 않게 골랐다.
    expect(screen.getByText("+6")).toBeTruthy();
    expect(screen.getByText("−4")).toBeTruthy();
    // 파일을 아직 안 골랐으면 diff 대신 안내가 보인다.
    expect(screen.getByText("No file selected")).toBeTruthy();
  });

  it("opens the picked file's diff for the same range, and none for a fresh base of null (from the very start)", () => {
    files = [file("src/a.ts")];
    useUnpushedRangeViewStore.getState().open({ repoPath: REPO, historyTarget: HEAD, baseOid: null, headOid: "c1" });
    render(<UnpushedRangeDetailPane />);
    fireEvent.click(screen.getByText("a.ts"));
    expect(diffCalls[diffCalls.length - 1]).toEqual({ path: REPO, base: null, head: "c1", file: "src/a.ts" });
    expect(screen.getByText("diff-viewer")).toBeTruthy();
  });

  it("closes the range from its header button", () => {
    files = [file("src/a.ts")];
    useUnpushedRangeViewStore.getState().open({ repoPath: REPO, historyTarget: HEAD, baseOid: "c3", headOid: "c1" });
    render(<UnpushedRangeDetailPane />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useUnpushedRangeViewStore.getState().range).toBeNull();
  });

  it("has no per-file viewed checkbox (the unpushed range itself is the review unit)", () => {
    files = [file("src/a.ts")];
    useUnpushedRangeViewStore.getState().open({ repoPath: REPO, historyTarget: HEAD, baseOid: "c3", headOid: "c1" });
    render(<UnpushedRangeDetailPane />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("useRangeOpenForCurrentScope (#1 — MainColumn's own owner check)", () => {
  const FEAT = "/work/app-feat";

  beforeEach(() => {
    useRepositoryStore.setState({ activeRepoPath: REPO });
    useHistoryViewStore.getState().reset();
  });

  it("is false when nothing is open", () => {
    const { result } = renderHook(() => useRangeOpenForCurrentScope());
    expect(result.current).toBe(false);
  });

  it("is true only while the active repo/worktree matches the range's owner", () => {
    useUnpushedRangeViewStore.getState().open({ repoPath: REPO, historyTarget: HEAD, baseOid: "c3", headOid: "c1" });
    const { result, rerender } = renderHook(() => useRangeOpenForCurrentScope());
    expect(result.current).toBe(true);

    // 다른 워크트리를 열면(activeRepoPath가 바뀜) 이 화면 것이 아니게 된다 — 스토어 구독이 이미
    // 닫지만, 화면 쪽 확인도 같은 결론을 내야 한다.
    useRepositoryStore.setState({ activeRepoPath: FEAT });
    rerender();
    expect(result.current).toBe(false);
  });

  it("is false once the viewed branch no longer matches the owner's history target", () => {
    useUnpushedRangeViewStore.getState().open({ repoPath: REPO, historyTarget: HEAD, baseOid: "c3", headOid: "c1" });
    const { result, rerender } = renderHook(() => useRangeOpenForCurrentScope());
    expect(result.current).toBe(true);

    useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false });
    rerender();
    expect(result.current).toBe(false);
  });
});

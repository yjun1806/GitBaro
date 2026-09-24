// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useFollowStore } from "@/stores/follow";
import { useRepositoryStore } from "@/stores/repository";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import type { ActivityEvent, DiffHunk, DiffOutput, RepoInfo, RepoReviewStatus, WipFile } from "@/types";

const REPO = "/work/app";
/** 활성 저장소가 아닌 워크트리. 따라가기는 이 경로를 연 적 없이 따라간다. */
const WT = "/work/app-agent";

const wipFile = (path: string, modifiedAt: number, extra: Partial<WipFile> = {}): WipFile => ({
  path,
  origPath: null,
  status: "modified",
  staged: false,
  unstaged: true,
  modifiedAt,
  insertions: 1,
  deletions: 0,
  ...extra,
});

const lines = (n: number, extra: Record<number, string[]> = {}) =>
  Array.from({ length: n }, (_, i) => [`line ${i + 1}`, ...(extra[i + 1] ?? [])])
    .flat()
    .join("\n") + "\n";

/** 가짜 백엔드 상태. 테스트가 바꾼 뒤 `repo:activity`를 보내면 다음 조회에 반영된다. */
const backend = {
  files: [] as WipFile[],
  contents: {} as Record<string, string>,
  /** 스테이징 쪽 diff의 새 내용(일부만 스테이징한 파일). */
  stagedContents: {} as Record<string, string>,
  /** 워크트리별 파일 목록. 없으면 `files`(따라가는 워크트리). */
  filesByPath: {} as Record<string, WipFile[]>,
  /** `워크트리\0파일` → diff hunk(겹침 경고의 줄 범위). */
  hunks: {} as Record<string, DiffHunk[]>,
  /** `review_status` 응답(같은 저장소의 워크트리 목록). */
  scan: [] as RepoReviewStatus[],
};

const getWipFiles = vi.fn(async (path: string) => backend.filesByPath[path] ?? backend.files);
const getFileDiff = vi.fn(
  async (repoPath: string, filePath: string, staged: boolean): Promise<DiffOutput> => ({
    filePath,
    oldContent: lines(30),
    newContent: (staged ? backend.stagedContents[filePath] : backend.contents[filePath]) ?? "",
    binary: false,
    hunks: backend.hunks[`${repoPath}\u0000${filePath}`] ?? [],
  }),
);
const stageFiles = vi.fn(async (_repoPath: string, _paths: string[]) => {});
const openWorktree = vi.fn(async (_path: string) => {});

vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  getWipFiles: (path: string) => getWipFiles(path),
  getFileDiff: (repoPath: string, filePath: string, staged: boolean) => getFileDiff(repoPath, filePath, staged),
  stageFiles: (repoPath: string, paths: string[]) => stageFiles(repoPath, paths),
  getWorktrees: async () => [],
  reviewStatus: async () => backend.scan,
}));

vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => openWorktree }));

// jsdom has no scrollIntoView; the file list's keyboard nav scrolls the picked row into view.
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/components/diff/DiffViewer", () => ({
  DiffViewer: ({
    diff,
    staged,
    freshLines,
    revealLine,
    headerExtra,
  }: {
    diff: DiffOutput | null;
    staged?: boolean;
    freshLines?: ReadonlySet<number>;
    revealLine?: number | null;
    headerExtra?: React.ReactNode;
  }) => (
    <div>
      <div data-testid="diff-header">{headerExtra}</div>
      <div data-testid="diff-viewer" data-reveal={revealLine ?? ""} data-staged={String(staged ?? false)}>
        {`${diff?.filePath ?? "none"} fresh=${[...(freshLines ?? [])].join(",")}`}
      </div>
    </div>
  ),
}));

type Handler = (event: { payload: ActivityEvent }) => void;
const handlers: Handler[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: Handler) => {
    handlers.push(handler);
    return () => {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    };
  }),
}));

const { FollowPanel, FollowRepoFooter, OVERFLOW_POLL_MS } = await import("../FollowPanel");

function renderFollow(path = WT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <FollowPanel path={path} variant="inline" />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

const emit = (path: string) =>
  act(async () => {
    handlers.forEach((h) => h({ payload: { path, at: Date.now() } }));
  });

const diffText = () => screen.getByTestId("diff-viewer").textContent;
const nowSecs = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  handlers.length = 0;
  getWipFiles.mockClear();
  getFileDiff.mockClear();
  stageFiles.mockClear();
  openWorktree.mockClear();
  backend.files = [wipFile("src/b.ts", nowSecs() - 4), wipFile("src/a.ts", nowSecs() - 40)];
  backend.contents = { "src/a.ts": lines(10), "src/b.ts": lines(30) };
  backend.stagedContents = {};
  backend.filesByPath = {};
  backend.hunks = {};
  backend.scan = [];
  useLiveChangesStore.setState({ watched: [], overflow: [] });
  useRepositoryStore.setState({ activeRepoPath: REPO, repos: [] });
  useActivityTargetsStore.setState({ extraByKey: {} });
  useFollowStore.getState().start(WT);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FollowPanel", () => {
  it("lists files by modification time and shows the most recent one while following", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    const names = screen.getAllByRole("listitem").map((el) => el.getAttribute("title"));
    expect(names).toEqual(["src/b.ts", "src/a.ts"]);
    expect(screen.getByTestId("follow-badge").textContent).toBe("Following");
    expect(screen.getByText("4 seconds ago")).toBeTruthy();
  });

  it("highlights lines added since the previous diff and says which lines", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts fresh="));
    expect(screen.queryByRole("status")).toBeNull();

    backend.contents["src/b.ts"] = lines(30, { 23: ["a", "b", "c"] });
    await emit(WT);

    await waitFor(() => expect(diffText()).toContain("fresh=24,25,26"));
    expect(screen.getByRole("status").textContent).toContain("Just added at line 24–26");
    // Following scrolls the new lines into view.
    expect(screen.getByTestId("diff-viewer").getAttribute("data-reveal")).toBe("24");
  });

  it("moves to a file that just started changing and marks its new lines against the index", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));

    // c.ts was clean before; the agent now adds two lines after line 5.
    backend.contents["src/c.ts"] = lines(30, { 5: ["x", "y"] });
    backend.files = [wipFile("src/c.ts", nowSecs()), ...backend.files];
    await emit(WT);

    await waitFor(() => expect(diffText()).toContain("src/c.ts fresh=6,7"));
  });

  it("stops following when the user scrolls the diff, and stays on that file", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));

    fireEvent.wheel(screen.getByTestId("follow-diff"));
    expect(useFollowStore.getState()).toMatchObject({ mode: "paused", file: "src/b.ts" });
    expect(screen.getByTestId("follow-badge").textContent).toBe("Following paused");

    // A newer file appears, but the paused view stays where the user is.
    backend.files = [wipFile("src/c.ts", nowSecs()), ...backend.files];
    await emit(WT);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(diffText()).toContain("src/b.ts");

    fireEvent.click(screen.getByRole("button", { name: "Follow again" }));
    await waitFor(() => expect(diffText()).toContain("src/c.ts"));
    expect(useFollowStore.getState().mode).toBe("following");
  });

  it("stops following when the user picks a file", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    fireEvent.click(screen.getByTitle("src/a.ts"));
    expect(useFollowStore.getState()).toMatchObject({ mode: "paused", file: "src/a.ts" });
    await waitFor(() => expect(diffText()).toContain("src/a.ts"));
  });

  it("stops following from the notice's button without the click counting twice", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    backend.contents["src/b.ts"] = lines(31);
    await emit(WT);
    const notice = await screen.findByRole("status");
    fireEvent.click(notice.querySelector("button") as HTMLElement);
    expect(useFollowStore.getState().mode).toBe("paused");
  });

  it("refreshes a worktree that is not the active repository when its activity event arrives", async () => {
    renderFollow();
    await waitFor(() => expect(getWipFiles).toHaveBeenCalledTimes(1));
    expect(getWipFiles).toHaveBeenLastCalledWith(WT);
    expect(useRepositoryStore.getState().activeRepoPath).toBe(REPO);

    // Another path's activity (the active repository) does not reload the followed worktree.
    await emit(REPO);
    expect(getWipFiles).toHaveBeenCalledTimes(1);

    await emit(WT);
    await waitFor(() => expect(getWipFiles).toHaveBeenCalledTimes(2));
    expect(getFileDiff.mock.calls.every(([path]) => path === WT)).toBe(true);
  });

  it("adds the followed path to the activity watch while mounted", () => {
    const { unmount } = renderFollow();
    expect(useActivityTargetsStore.getState().extraByKey.follow).toEqual([WT]);
    unmount();
    expect(useActivityTargetsStore.getState().extraByKey.follow).toBeUndefined();
  });

  it("uses Korean labels", async () => {
    await i18n.changeLanguage("ko");
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    expect(screen.getByTestId("follow-badge").textContent).toBe("따라가는 중");
    backend.contents["src/b.ts"] = lines(30, { 23: ["a", "b", "c"] });
    await emit(WT);
    expect((await screen.findByRole("status")).textContent).toContain("방금 24–26행이 추가됐어요");
  });
});

describe("FollowPanel — starting from a clean worktree", () => {
  it("treats every file that shows up later as new against the index", async () => {
    backend.files = [];
    renderFollow();
    await screen.findByText("No uncommitted changes. Waiting for the next edit.");
    backend.contents["src/a.ts"] = lines(30, { 2: ["new"] });
    backend.files = [wipFile("src/a.ts", nowSecs())];
    await emit(WT);
    await waitFor(() => expect(diffText()).toContain("src/a.ts fresh=3"));
  });
});

describe("FollowPanel — review fixes", () => {
  it("marks new lines in a file that was already changed when following began (D4 first scene)", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    // a.ts was dirty before following started and has not been shown yet. Its content is kept as the baseline.
    await waitFor(() => expect(getFileDiff).toHaveBeenCalledWith(WT, "src/a.ts", false));

    // The agent now edits a.ts: three lines after line 3. It moves to the top and is shown.
    backend.contents["src/a.ts"] = lines(10, { 3: ["x", "y", "z"] });
    backend.files = [wipFile("src/a.ts", nowSecs()), wipFile("src/b.ts", nowSecs() - 10)];
    await emit(WT);

    await waitFor(() => expect(diffText()).toContain("src/a.ts fresh=4,5,6"));
    expect(screen.getByRole("status").textContent).toContain("Just added at line 4–6");
  });

  it("re-reads the list and the shown diff on a timer when the followed path is not watched", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useLiveChangesStore.setState({ watched: [], overflow: [WT] });
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));

    // No repo:activity event arrives for an overflowed path.
    backend.contents["src/b.ts"] = lines(30, { 23: ["a", "b", "c"] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OVERFLOW_POLL_MS);
    });

    await waitFor(() => expect(diffText()).toContain("fresh=24,25,26"));
  });

  it("does not poll a path that gets activity events", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    const calls = getWipFiles.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OVERFLOW_POLL_MS * 2);
    });
    expect(getWipFiles.mock.calls.length).toBe(calls);
  });

  it("stays paused on a file that left the list instead of jumping to the newest one", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    fireEvent.click(screen.getByTitle("src/a.ts"));
    await waitFor(() => expect(diffText()).toContain("src/a.ts"));

    // a.ts is committed, then c.ts changes.
    backend.files = [wipFile("src/c.ts", nowSecs()), wipFile("src/b.ts", nowSecs() - 10)];
    await emit(WT);

    await screen.findByText("src/a.ts has no uncommitted changes any more.");
    expect(screen.queryByTestId("diff-viewer")).toBeNull();
    expect(useFollowStore.getState()).toMatchObject({ mode: "paused", file: "src/a.ts" });

    fireEvent.click(screen.getAllByRole("button", { name: "Follow again" })[0]);
    await waitFor(() => expect(diffText()).toContain("src/c.ts"));
  });

  it("moves between files with the arrow keys, which pauses following", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    fireEvent.keyDown(screen.getByRole("list"), { key: "ArrowDown" });
    expect(useFollowStore.getState()).toMatchObject({ mode: "paused", file: "src/a.ts" });
    await waitFor(() => expect(diffText()).toContain("src/a.ts"));
  });

  it("lets the staged half of a partly staged file be viewed", async () => {
    backend.files = [wipFile("src/b.ts", nowSecs() - 4, { staged: true, unstaged: true })];
    backend.stagedContents["src/b.ts"] = lines(29);
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    expect(screen.getByText("partly staged")).toBeTruthy();
    expect(screen.getByTestId("diff-viewer").getAttribute("data-staged")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Staged" }));
    await waitFor(() => expect(screen.getByTestId("diff-viewer").getAttribute("data-staged")).toBe("true"));
    expect(getFileDiff).toHaveBeenCalledWith(WT, "src/b.ts", true);
    // Picking a side is the user taking over.
    expect(useFollowStore.getState().mode).toBe("paused");
  });

  it("shows when the shown file was last modified in the diff header", async () => {
    renderFollow();
    await waitFor(() => expect(diffText()).toContain("src/b.ts"));
    expect(screen.getByTestId("diff-header").textContent).toBe("Modified 4 seconds ago");
  });
});

describe("FollowRepoFooter", () => {
  function renderFooter(path: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <FollowRepoFooter path={path} />
      </QueryClientProvider>,
    );
  }

  it("offers stage all, commit and stash for the open worktree (D4 footer)", async () => {
    useFollowStore.getState().start(REPO);
    backend.files = [
      wipFile("src/b.ts", nowSecs()),
      wipFile("src/new.ts", nowSecs(), { status: "renamed", origPath: "src/old.ts" }),
      wipFile("src/only-staged.ts", nowSecs(), { staged: true, unstaged: false }),
      wipFile("src/c.ts", nowSecs(), { status: "conflicted" }),
    ];
    renderFooter(REPO);
    const stageAll = screen.getByRole("button", { name: "Stage all" });
    await waitFor(() => expect((stageAll as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(stageAll);
    await waitFor(() => expect(stageFiles).toHaveBeenCalledTimes(1));
    expect(stageFiles).toHaveBeenCalledWith(REPO, ["src/b.ts", "src/new.ts", "src/old.ts"]);

    fireEvent.click(screen.getByRole("button", { name: "Commit…" }));
    expect(useFollowStore.getState().target).toBeNull();
    expect(screen.getByRole("button", { name: "Stash" })).toBeTruthy();
  });

  it("opens another worktree from its follow panel", () => {
    renderFooter(WT);
    expect(screen.queryByRole("button", { name: "Stage all" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open this worktree" }));
    expect(openWorktree).toHaveBeenCalledWith(WT);
  });
});

describe("FollowPanel — same file in another worktree (D5)", () => {
  const addHunk = (line: number): DiffHunk[] => [
    {
      oldStart: line,
      oldLines: 0,
      newStart: line,
      newLines: 1,
      header: "",
      lines: [{ content: "x", lineType: "add", oldLineNo: null, newLineNo: line }],
    },
  ];

  beforeEach(() => {
    useRepositoryStore.setState({ repos: [{ path: REPO, name: "app" } as unknown as RepoInfo] });
    backend.scan = [
      {
        repoPath: REPO,
        worktrees: [
          { path: REPO, branch: "main", headOid: "c1", isMain: true },
          { path: WT, branch: "feat/agent", headOid: "f1", isMain: false },
        ],
      },
    ];
    // The main worktree also edits b.ts (different lines), but not a.ts.
    backend.filesByPath = { [REPO]: [wipFile("src/b.ts", nowSecs() - 100), wipFile("src/c.ts", nowSecs() - 100)] };
    backend.hunks = { [`${WT}\u0000src/b.ts`]: addHunk(2), [`${REPO}\u0000src/b.ts`]: addHunk(20) };
  });

  it("marks files another worktree of the same repository also changes", async () => {
    renderFollow();
    await waitFor(() => expect(screen.getAllByTestId("overlap-mark")).toHaveLength(1));
    const mark = screen.getByTestId("overlap-mark");
    expect(mark.closest("[role=listitem]")?.getAttribute("title")).toBe("src/b.ts");
    expect(mark.getAttribute("title")).toBe("Also being edited in another worktree: main");
  });

  it("warns above the diff with both worktrees' changed sections, and opens them side by side", async () => {
    renderFollow();
    const banner = await screen.findByTestId("overlap-banner");
    expect(banner.textContent).toContain("Same file");
    expect(banner.textContent).toContain("main");
    // Only the file on screen is read from the other worktree, and the ranges show right away.
    await waitFor(() =>
      expect(screen.getByTestId("overlap-banner").textContent).toContain("Different lines for now (lines 2 / 20)."),
    );
    expect(getFileDiff.mock.calls.filter(([repo]) => repo === REPO).map(([, file]) => file)).toEqual(["src/b.ts"]);

    fireEvent.click(screen.getByRole("button", { name: "View both worktrees side by side" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("src/b.ts");
    await waitFor(() => expect(screen.getAllByTestId("diff-viewer")).toHaveLength(3));
    // Opening the comparison is the user taking over: following pauses so the file stays put.
    expect(useFollowStore.getState().mode).toBe("paused");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("re-reads the other worktree's diff instead of keeping an old all-clear", async () => {
    const { client } = renderFollow();
    await waitFor(() =>
      expect(screen.getByTestId("overlap-banner").textContent).toContain("Different lines for now (lines 2 / 20)."),
    );
    // The main worktree now edits line 2 too. Any refresh of its diff must reach the banner.
    backend.hunks = { ...backend.hunks, [`${REPO}\u0000src/b.ts`]: addHunk(2) };
    await act(() => client.invalidateQueries({ queryKey: ["fileDiff", REPO] }));
    await waitFor(() =>
      expect(screen.getByTestId("overlap-banner").textContent).toContain("Both change lines 2 (lines 2 / 2)."),
    );
  });

  it("shows no warning for a file only this worktree changes", async () => {
    backend.filesByPath = { [REPO]: [wipFile("src/c.ts", nowSecs() - 100)] };
    renderFollow();
    await waitFor(() => expect(getWipFiles).toHaveBeenCalledWith(REPO));
    await screen.findByText(/src\/b\.ts fresh=/);
    expect(screen.queryByTestId("overlap-mark")).toBeNull();
    expect(screen.queryByTestId("overlap-banner")).toBeNull();
  });
});

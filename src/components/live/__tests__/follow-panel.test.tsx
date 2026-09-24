// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useFollowStore } from "@/stores/follow";
import { useRepositoryStore } from "@/stores/repository";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import type { ActivityEvent, DiffOutput, WipFile } from "@/types";

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
};

const getWipFiles = vi.fn(async (_path: string) => backend.files);
const getFileDiff = vi.fn(
  async (_repoPath: string, filePath: string): Promise<DiffOutput> => ({
    filePath,
    oldContent: lines(30),
    newContent: backend.contents[filePath] ?? "",
    binary: false,
    hunks: [],
  }),
);

vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  getWipFiles: (path: string) => getWipFiles(path),
  getFileDiff: (repoPath: string, filePath: string) => getFileDiff(repoPath, filePath),
}));

vi.mock("@/components/diff/DiffViewer", () => ({
  DiffViewer: ({
    diff,
    freshLines,
    revealLine,
  }: {
    diff: DiffOutput | null;
    freshLines?: ReadonlySet<number>;
    revealLine?: number | null;
  }) => (
    <div data-testid="diff-viewer" data-reveal={revealLine ?? ""}>
      {`${diff?.filePath ?? "none"} fresh=${[...(freshLines ?? [])].join(",")}`}
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

const { FollowPanel } = await import("../FollowPanel");

function renderFollow(path = WT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FollowPanel path={path} variant="inline" />
    </QueryClientProvider>,
  );
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
  backend.files = [wipFile("src/b.ts", nowSecs() - 4), wipFile("src/a.ts", nowSecs() - 40)];
  backend.contents = { "src/a.ts": lines(10), "src/b.ts": lines(30) };
  useRepositoryStore.setState({ activeRepoPath: REPO });
  useActivityTargetsStore.setState({ extraByKey: {} });
  useFollowStore.getState().start(WT);
});

afterEach(cleanup);

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

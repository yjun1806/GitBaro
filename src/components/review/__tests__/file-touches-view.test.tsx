// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { CommitTouch, FileTouches, RepoFileTouches } from "@/types";

type DiffCall = { path: string | null; base: string | null; head: string | null; file: string | null };
const diffCalls: DiffCall[] = [];
let touchesByPath: Record<string, RepoFileTouches | undefined> = {};

vi.mock("@/api/queries", () => ({
  useUnpushedFileTouches: (paths: readonly string[]) => paths.map((p) => touchesByPath[p]),
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

vi.mock("@/components/diff/DiffViewer", () => ({
  DiffViewer: ({ status }: { status?: string }) => <div>{`diff-viewer:${status}`}</div>,
}));

const { FileTouchesView } = await import("../FileTouchesView");

Element.prototype.scrollIntoView = vi.fn();

function commitTouch(overrides: Partial<CommitTouch> & { oid: string; subject: string; authorTime: number }): CommitTouch {
  return {
    shortOid: overrides.oid.slice(0, 7),
    parentOid: `${overrides.oid}^`,
    path: "src/multi.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    isBinary: false,
    tooLarge: false,
    ...overrides,
  };
}

function fileTouches(overrides: Partial<FileTouches> & { path: string; commits: CommitTouch[] }): FileTouches {
  return {
    oldPath: null,
    status: "modified",
    additions: 5,
    deletions: 2,
    isBinary: false,
    tooLarge: false,
    ...overrides,
  };
}

const REPO_A = "/w/app";
const REPO_B = "/w/backend";
const repoLabel = (path: string) => (path === REPO_A ? "app" : "backend");

function baseRepoTouches(): Record<string, RepoFileTouches> {
  return {
    [REPO_A]: {
      path: REPO_A,
      error: null,
      truncated: false,
      rangeBase: "base-a",
      head: "head-a",
      files: [
        fileTouches({
          path: "src/multi.ts",
          commits: [
            commitTouch({ oid: "m2", subject: "[XMS-364] two", authorTime: 300, path: "src/multi.ts" }),
            commitTouch({ oid: "m1", subject: "[XMS-371] one", authorTime: 200, path: "src/multi.ts" }),
          ],
        }),
        fileTouches({
          path: "src/unchanged.ts",
          status: null,
          additions: 0,
          deletions: 0,
          commits: [
            commitTouch({ oid: "u2", subject: "[XMS-500] a", authorTime: 250, path: "src/unchanged.ts" }),
            commitTouch({ oid: "u1", subject: "[XMS-500] b", authorTime: 150, path: "src/unchanged.ts" }),
          ],
        }),
        fileTouches({
          path: "src/single.ts",
          commits: [commitTouch({ oid: "s1", subject: "[XMS-900] solo", authorTime: 400, path: "src/single.ts" })],
        }),
      ],
    },
    [REPO_B]: { path: REPO_B, error: null, truncated: false, rangeBase: null, head: null, files: [] },
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  diffCalls.length = 0;
  touchesByPath = baseRepoTouches();
});

afterEach(cleanup);

describe("FileTouchesView", () => {
  it("groups files touched by 2+ commits before files touched by one, newest first within each group", () => {
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    const rows = screen.getAllByRole("option");
    const paths = rows.map((r) => r.getAttribute("title"));
    expect(paths).toEqual(["src/multi.ts", "src/unchanged.ts", "src/single.ts"]);
    expect(screen.getByText("Files touched by multiple commits")).toBeTruthy();
    expect(screen.getByText("Files touched by one commit")).toBeTruthy();
  });

  it("shows the ticket note only once a file's commits carry 2+ distinct ticket keys", () => {
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    expect(screen.getByText("Touched by XMS-364, XMS-371")).toBeTruthy();
    // unchanged.ts의 두 커밋은 같은 티켓 키(XMS-500)라 안내가 없다.
    expect(screen.queryByText(/Touched by XMS-500/)).toBeNull();
  });

  it("defaults to the combined diff across the file's commits, using the repository's rangeBase/head", () => {
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    const last = diffCalls[diffCalls.length - 1];
    expect(last).toEqual({ path: REPO_A, base: "base-a", head: "head-a", file: "src/multi.ts" });
    expect(screen.getByText("Commits that touched this file")).toBeTruthy();
    expect(screen.getByText("[XMS-364] two")).toBeTruthy();
    expect(screen.getByText("[XMS-371] one")).toBeTruthy();
  });

  it("switches to a single commit's own diff on click, and back to combined on a second click", () => {
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    fireEvent.click(screen.getByText("[XMS-364] two"));
    expect(diffCalls[diffCalls.length - 1]).toEqual({ path: REPO_A, base: "m2^", head: "m2", file: "src/multi.ts" });

    fireEvent.click(screen.getByText("[XMS-364] two"));
    expect(diffCalls[diffCalls.length - 1]).toEqual({ path: REPO_A, base: "base-a", head: "head-a", file: "src/multi.ts" });
  });

  it("shows a net-unchanged message instead of a diff when the combined commits cancel out", () => {
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    fireEvent.click(screen.getByTitle("src/unchanged.ts"));
    expect(screen.getByText("These commits cancel out, so nothing changed in the end")).toBeTruthy();
    expect(screen.queryByText(/diff-viewer/)).toBeNull();
  });

  it("shows a repository it could not read inline, without hiding the others", () => {
    touchesByPath[REPO_B] = { path: REPO_B, error: "not a repository", truncated: false, rangeBase: null, head: null, files: [] };
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    expect(screen.getByText("Couldn't read backend: not a repository")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("shows a quiet note for a repository whose older commits were not checked", () => {
    touchesByPath[REPO_A] = { ...touchesByPath[REPO_A]!, truncated: true };
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    expect(screen.getByText("app: some older commits were not checked")).toBeTruthy();
  });

  it("shows the empty state when nothing is unpushed anywhere", () => {
    touchesByPath = {
      [REPO_A]: { path: REPO_A, error: null, truncated: false, rangeBase: "head-a", head: "head-a", files: [] },
      [REPO_B]: { path: REPO_B, error: null, truncated: false, rangeBase: "head-b", head: "head-b", files: [] },
    };
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    expect(screen.getByText("No commits to push")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("moves the file selection with the arrow keys and focuses the diff pane on Enter", () => {
    render(<FileTouchesView paths={[REPO_A, REPO_B]} repoLabel={repoLabel} />);
    const list = screen.getByRole("listbox", { name: "By file" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    // 목록 순서: multi.ts(0, 기본 선택) → unchanged.ts(1) → single.ts(2).
    expect(diffCalls[diffCalls.length - 1]?.file).toBe("src/single.ts");

    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.getByTestId("file-touches-detail")).toBe(document.activeElement);
  });
});

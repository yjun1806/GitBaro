// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useHistoryViewStore } from "@/stores/history-view";
import { useCompareBaseStore } from "../compare-base";
import type { ActivityEvent, BranchChangedFile, BranchChanges, FileDiffVsDefault } from "@/types";

const APP = "/work/xames-app";
const API = "/work/xames-backend";
const DESIGN = "/work/xames-design";
const WEB = "/work/xames-web";

function file(path: string, additions: number, status: BranchChangedFile["status"] = "added"): BranchChangedFile {
  return { path, oldPath: null, status, additions, deletions: 0, isBinary: false };
}

function changes(path: string, branch: string, files: BranchChangedFile[]): BranchChanges {
  return {
    path,
    branch,
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

function diff(filePath: string, added: string[]): FileDiffVsDefault {
  return {
    filePath,
    oldPath: null,
    oldContent: "",
    newContent: added.join("\n"),
    binary: false,
    baseOid: "b",
    baseIsDivergencePoint: true,
    hunks: [
      {
        header: "@@ -0,0 +1 @@",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: added.length,
        lines: added.map((content, i) => ({ content, lineType: "add", oldLineNo: null, newLineNo: i + 1 })),
      },
    ],
  };
}

const CHANGES: Record<string, BranchChanges> = {
  [APP]: changes(APP, "feat/noti", [file("src/api/notifications.ts", 2), file("src/theme/tokens.ts", 1, "modified")]),
  [API]: changes(API, "feat/notification-settings", [file("src/notifications/settings.controller.ts", 2)]),
  [DESIGN]: changes(DESIGN, "feat/rename", [
    { path: "src/new.ts", oldPath: "src/old.ts", status: "renamed", additions: 1, deletions: 0, isBinary: false },
  ]),
};

const DIFFS: Record<string, FileDiffVsDefault> = {
  [`${APP}:src/api/notifications.ts`]: diff("src/api/notifications.ts", [
    'export const getSettings = () => http.get("/api/v1/notifications/settings");',
    "const ok = true;",
  ]),
  [`${APP}:src/theme/tokens.ts`]: diff("src/theme/tokens.ts", ["badg.fg = 1;"]),
  [`${API}:src/notifications/settings.controller.ts`]: diff("src/notifications/settings.controller.ts", [
    'const ROUTE = "/api/v1/notifications/settings";',
    "badg.fg = 2;",
  ]),
  [`${DESIGN}:src/new.ts`]: diff("src/new.ts", ['const ROUTE = "/api/v1/notifications/settings";']),
};

const getChangesVsDefault = vi.fn(async (path: string, _scope?: unknown) => CHANGES[path]);
const getFileDiffVsDefault = vi.fn(
  async (path: string, filePath: string, _oldPath: string | null, _scope?: unknown) => DIFFS[`${path}:${filePath}`],
);
/** 기준 선택 목록에 쓰는 브랜치·워크트리. */
const BRANCHES = [
  { name: "feat/noti", isHead: true, isRemote: false },
  { name: "main", isHead: false, isRemote: false, isDefault: true },
  { name: "dev", isHead: false, isRemote: false },
  { name: "origin/main", isHead: false, isRemote: true },
  { name: "origin/HEAD", isHead: false, isRemote: true },
];
const WORKTREES = [{ path: APP, branch: "feat/noti", isMain: false, base: { name: "dev" } }];
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  // 범위를 정했을 때만 둘째 인자를 넘긴다(예전 호출과 같은 모양을 유지).
  getChangesVsDefault: (path: string, scope?: unknown) =>
    scope ? getChangesVsDefault(path, scope) : getChangesVsDefault(path),
  getFileDiffVsDefault: (path: string, filePath: string, oldPath: string | null, scope?: unknown) =>
    scope ? getFileDiffVsDefault(path, filePath, oldPath, scope) : getFileDiffVsDefault(path, filePath, oldPath),
  getBranches: async () => BRANCHES,
  getWorktrees: async () => WORKTREES,
}));
vi.mock("@/components/diff/DiffViewer", () => ({
  DiffViewer: ({ diff }: { diff: { filePath: string } }) => <div>diff-viewer {diff.filePath}</div>,
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

const { FilesByRepo } = await import("../FilesByRepo");

function renderFiles(repos: { path: string; name: string }[], groupBy: "repo" | "folder" = "repo") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (shown: { path: string; name: string }[]) => (
    <QueryClientProvider client={client}>
      <FilesByRepo repos={shown} groupBy={groupBy} />
    </QueryClientProvider>
  );
  const result = render(tree(repos));
  /** 부모가 다시 그릴 때처럼 새 배열로 다시 그린다. */
  return { ...result, show: (shown: { path: string; name: string }[]) => result.rerender(tree(shown)) };
}

const BOTH = [
  { path: APP, name: "xames-app" },
  { path: API, name: "xames-backend" },
];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  handlers.length = 0;
  getChangesVsDefault.mockClear();
  getFileDiffVsDefault.mockClear();
  useUIStore.setState({ isSwitchingBranch: false });
  useCompareBaseStore.setState({ baseByPath: {} });
  useHistoryViewStore.getState().reset();
  useRepositoryStore.setState({ activeRepoPath: null });
});

afterEach(cleanup);

describe("FilesByRepo", () => {
  it("groups files by repository and shows each repository's own branch in the group header", async () => {
    renderFiles(BOTH);
    const app = await screen.findByRole("region", { name: "xames-app" });
    const api = screen.getByRole("region", { name: "xames-backend" });
    await waitFor(() => expect(within(app).getByTestId("group-branch").textContent).toBe("feat/noti"));
    await waitFor(() =>
      expect(within(api).getByTestId("group-branch").textContent).toBe("feat/notification-settings"),
    );
    expect(within(app).getByText("notifications.ts")).toBeTruthy();
    expect(within(api).getByText("settings.controller.ts")).toBeTruthy();
    expect(getChangesVsDefault).toHaveBeenCalledWith(APP);
    expect(getChangesVsDefault).toHaveBeenCalledWith(API);
  });

  it("shows the diff against main for a picked file", async () => {
    renderFiles(BOTH);
    fireEvent.click(await screen.findByText("settings.controller.ts"));
    expect(await screen.findByText("diff-viewer src/notifications/settings.controller.ts")).toBeTruthy();
  });

  it("reads no file diff until a file is picked", async () => {
    renderFiles(BOTH);
    await screen.findByText("settings.controller.ts");
    expect(getFileDiffVsDefault).not.toHaveBeenCalled();
  });

  it("re-reads a repository's changes on repo:activity for that repository", async () => {
    renderFiles(BOTH);
    await screen.findByText("notifications.ts");
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    const before = getChangesVsDefault.mock.calls.filter(([p]) => p === API).length;
    handlers.forEach((h) => h({ payload: { path: API, at: Date.now() } }));
    await waitFor(() =>
      expect(getChangesVsDefault.mock.calls.filter(([p]) => p === API).length).toBe(before + 1),
    );
    expect(getChangesVsDefault.mock.calls.filter(([p]) => p === APP)).toHaveLength(1);
  });

  it("drops the picked file when its repository is no longer shown", async () => {
    const view = renderFiles(BOTH);
    fireEvent.click(await screen.findByText("settings.controller.ts"));
    expect(await screen.findByText("diff-viewer src/notifications/settings.controller.ts")).toBeTruthy();
    view.show([{ path: APP, name: "xames-app" }]);
    expect(screen.queryByText("diff-viewer src/notifications/settings.controller.ts")).toBeNull();
    expect(screen.getByText("Pick a file")).toBeTruthy();
  });

  it("compares a renamed file against its old path", async () => {
    renderFiles([{ path: DESIGN, name: "xames-design" }]);
    fireEvent.click(await screen.findByText("new.ts"));
    expect(await screen.findByText("diff-viewer src/new.ts")).toBeTruthy();
    expect(getFileDiffVsDefault).toHaveBeenCalledWith(DESIGN, "src/new.ts", "src/old.ts");
  });

  it("splits a repository's files by folder when grouped by folder", async () => {
    renderFiles(BOTH, "folder");
    const app = await screen.findByRole("region", { name: "xames-app" });
    const api = await within(app).findByRole("group", { name: "src/api" });
    expect(within(api).getByText("notifications.ts")).toBeTruthy();
    expect(within(app).getByRole("group", { name: "src/theme" })).toBeTruthy();
  });

  it("covers the list and diff with the branch-switch overlay, like the other repo-view screens (W7 review)", async () => {
    renderFiles(BOTH);
    await screen.findByText("notifications.ts");
    expect(document.querySelector(".animate-spin")).toBeNull();
    act(() => useUIStore.setState({ isSwitchingBranch: true }));
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("names the comparison base and explains what is compared, in Korean too", async () => {
    await i18n.changeLanguage("ko");
    renderFiles([{ path: APP, name: "xames-app" }]);
    await waitFor(() =>
      expect(screen.getByTestId("files-summary").textContent).toBe(
        "feat/noti이(가) main에서 갈라진 뒤 바꾼 파일 2개 · 커밋 2 + 커밋 안 함 0",
      ),
    );
    expect(screen.getByText("main 대비 변경")).toBeTruthy();
    // 저장소가 하나면 설명은 맨 위에만 있다.
    expect(screen.queryByTestId("group-note")).toBeNull();
  });

  it("says unpushed changes when the branch is the default branch itself", async () => {
    await i18n.changeLanguage("ko");
    CHANGES[WEB] = {
      ...changes(WEB, "main", [file("a.ts", 1)]),
      baseRef: "origin/main",
      uncommitted: [file("b.ts", 1, "modified"), file("b.ts", 1, "modified")],
    };
    renderFiles([{ path: WEB, name: "xames-web" }]);
    await waitFor(() =>
      expect(screen.getByTestId("files-summary").textContent).toBe(
        "main에서 아직 push하지 않은 변경 (origin/main 대비) · 파일 1개 · 커밋 1 + 커밋 안 함 1",
      ),
    );
    delete CHANGES[WEB];
  });

  it("explains each repository in its own group when several are shown", async () => {
    renderFiles(BOTH);
    const api = await screen.findByRole("region", { name: "xames-backend" });
    await waitFor(() =>
      expect(within(api).getByTestId("group-note").textContent).toBe(
        "1 file changed on feat/notification-settings since it left main · 1 committed + 0 uncommitted",
      ),
    );
    expect(screen.getByText("Changes vs main")).toBeTruthy();
  });

  it("compares with a picked base branch, including the worktree's base, and goes back to the default", async () => {
    renderFiles([{ path: APP, name: "xames-app" }]);
    const picker = (await screen.findByRole("combobox", { name: "Comparison base" })) as HTMLSelectElement;
    await waitFor(() => expect(within(picker).getByRole("option", { name: "Worktree base (dev)" })).toBeTruthy());
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Default branch (main)");
    expect(options).toContain("origin/main");
    // 비교 대상 자신과 origin/HEAD 같은 별칭은 뺀다.
    expect(options).not.toContain("feat/noti");
    expect(options).not.toContain("origin/HEAD");

    fireEvent.change(picker, { target: { value: "dev" } });
    await waitFor(() => expect(getChangesVsDefault).toHaveBeenCalledWith(APP, { base: "dev", target: null }));
    expect(screen.getByText("Changes vs dev")).toBeTruthy();
    fireEvent.click(await screen.findByText("notifications.ts"));
    await waitFor(() =>
      expect(getFileDiffVsDefault).toHaveBeenCalledWith(APP, "src/api/notifications.ts", null, {
        base: "dev",
        target: null,
      }),
    );

    fireEvent.change(picker, { target: { value: "" } });
    expect(useCompareBaseStore.getState().baseByPath).toEqual({});
    expect(await screen.findByText("Changes vs main")).toBeTruthy();
  });

  it("shows the viewed branch against the base, without uncommitted changes, while another branch is viewed", async () => {
    useRepositoryStore.setState({ activeRepoPath: APP });
    useHistoryViewStore.getState().view(APP, { kind: "ref", name: "dev", isRemote: false });
    CHANGES[APP] = { ...CHANGES[APP], branch: "dev" };
    renderFiles([{ path: APP, name: "xames-app" }]);
    await waitFor(() => expect(getChangesVsDefault).toHaveBeenCalledWith(APP, { base: null, target: "dev" }));
    await waitFor(() =>
      expect(screen.getByTestId("files-summary").textContent).toBe(
        "2 files changed on dev since it left main · 2 committed (viewing, so uncommitted changes are left out)",
      ),
    );
    CHANGES[APP] = { ...CHANGES[APP], branch: "feat/noti" };
  });
});

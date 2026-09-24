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
const BIG = "/work/xames-big";
const WEB = "/work/xames-web";
const ADMIN = "/work/xames-admin";

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
  // 7자 문자열 "badg.fg"만 겹친다 — 연결되면 안 된다.
  [`${APP}:src/theme/tokens.ts`]: diff("src/theme/tokens.ts", ["badg.fg = 1;"]),
  [`${API}:src/notifications/settings.controller.ts`]: diff("src/notifications/settings.controller.ts", [
    'const ROUTE = "/api/v1/notifications/settings";',
    "badg.fg = 2;",
  ]),
  [`${DESIGN}:src/new.ts`]: diff("src/new.ts", ['const ROUTE = "/api/v1/notifications/settings";']),
};

// BIG: 예산(LINK_SCAN_FILE_LIMIT)보다 많은, 서로 무관한 파일을 가진 저장소.
const BIG_FILE_COUNT = 100;
const BIG_FILES: BranchChangedFile[] = Array.from({ length: BIG_FILE_COUNT }, (_, i) =>
  file(`src/gen/file${i}.ts`, 1),
);
CHANGES[BIG] = changes(BIG, "refactor/huge", BIG_FILES);
BIG_FILES.forEach((f, i) => {
  DIFFS[`${BIG}:${f.path}`] = diff(f.path, [`const unrelated${i} = ${i};`]);
});
// WEB/ADMIN이 공유하는, BIG의 파일에는 없는 연결 후보 문자열.
CHANGES[WEB] = changes(WEB, "feat/shared-route", [file("src/route.ts", 1)]);
DIFFS[`${WEB}:src/route.ts`] = diff("src/route.ts", ['const ROUTE = "/api/v1/shared/route";']);
CHANGES[ADMIN] = changes(ADMIN, "feat/shared-route", [file("src/route.ts", 1)]);
DIFFS[`${ADMIN}:src/route.ts`] = diff("src/route.ts", ['const ROUTE = "/api/v1/shared/route";']);

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
const linkScans = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/linked-changes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/linked-changes")>();
  return {
    ...actual,
    findLinkedChanges: (...args: Parameters<typeof actual.findLinkedChanges>) => {
      linkScans.count += 1;
      return actual.findLinkedChanges(...args);
    },
  };
});
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

const { FilesByRepo, LINK_SCAN_FILE_LIMIT } = await import("../FilesByRepo");

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

  it("links files that add the same long string, and not through a short one", async () => {
    renderFiles(BOTH);
    const app = await screen.findByRole("region", { name: "xames-app" });
    await waitFor(() => expect(screen.getAllByTestId("link-chip")).toHaveLength(2));
    const chips = screen.getAllByTestId("link-chip");
    expect(chips.every((c) => c.textContent?.includes("/api/v1/notifications/settings"))).toBe(true);
    // tokens.ts는 7자 문자열만 겹쳐서 연결 표시가 없다.
    const tokensRow = within(app).getByText("tokens.ts").closest("[role=button]") as HTMLElement;
    expect(within(tokensRow).queryByTestId("link-chip")).toBeNull();
  });

  it("opens linked changes side by side and labels them as a guess", async () => {
    renderFiles(BOTH);
    const app = await screen.findByRole("region", { name: "xames-app" });
    await waitFor(() => expect(within(app).getByTestId("link-chip")).toBeTruthy());
    fireEvent.click(within(app).getByTestId("link-chip"));
    const compare = await screen.findByTestId("linked-compare");
    expect(within(compare).getByText("a guess from matching strings")).toBeTruthy();
    await waitFor(() => expect(compare.querySelectorAll("mark")).toHaveLength(2));
    expect(within(compare).getByText("src/notifications/settings.controller.ts")).toBeTruthy();
    fireEvent.click(within(compare).getByText("Close link"));
    expect(screen.queryByTestId("linked-compare")).toBeNull();
  });

  it("shows the diff against main for a picked file", async () => {
    renderFiles(BOTH);
    fireEvent.click(await screen.findByText("settings.controller.ts"));
    expect(await screen.findByText("diff-viewer src/notifications/settings.controller.ts")).toBeTruthy();
  });

  it("does not read diffs to look for links when only one repository is shown", async () => {
    renderFiles([{ path: APP, name: "xames-app" }]);
    await screen.findByText("notifications.ts");
    expect(getFileDiffVsDefault).not.toHaveBeenCalled();
    expect(screen.queryByTestId("link-chip")).toBeNull();
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

  it("does not search for links again when only the view changes", async () => {
    const view = renderFiles(BOTH);
    await waitFor(() => expect(screen.getAllByTestId("link-chip")).toHaveLength(2));
    const scans = linkScans.count;
    // 새 배열이지만 같은 저장소, 파일 고르기, 그룹 접기 — 연결 계산을 다시 하지 않는다.
    view.show(BOTH.map((r) => ({ ...r })));
    fireEvent.click(screen.getByText("notifications.ts"));
    fireEvent.click(screen.getByRole("button", { name: /xames-backend/ }));
    expect(linkScans.count).toBe(scans);
  });

  it("compares a renamed file against its old path in the side-by-side view", async () => {
    renderFiles([
      { path: APP, name: "xames-app" },
      { path: DESIGN, name: "xames-design" },
    ]);
    const design = await screen.findByRole("region", { name: "xames-design" });
    await waitFor(() => expect(within(design).getByTestId("link-chip")).toBeTruthy());
    fireEvent.click(within(design).getByTestId("link-chip"));
    const compare = await screen.findByTestId("linked-compare");
    await waitFor(() => expect(compare.querySelectorAll("mark")).toHaveLength(2));
    const designCalls = getFileDiffVsDefault.mock.calls.filter(([p]) => p === DESIGN);
    expect(designCalls.length).toBeGreaterThan(0);
    expect(designCalls.every(([, , oldPath]) => oldPath === "src/old.ts")).toBe(true);
  });

  it("splits a repository's files by folder when grouped by folder", async () => {
    renderFiles(BOTH, "folder");
    const app = await screen.findByRole("region", { name: "xames-app" });
    const api = await within(app).findByRole("group", { name: "src/api" });
    expect(within(api).getByText("notifications.ts")).toBeTruthy();
    expect(within(app).getByRole("group", { name: "src/theme" })).toBeTruthy();
  });

  it("fills the link-scan budget round-robin, so a repo with many files does not starve the others (W7 review)", async () => {
    expect(BIG_FILE_COUNT).toBeGreaterThan(LINK_SCAN_FILE_LIMIT);
    renderFiles([
      { path: BIG, name: "xames-big" },
      { path: WEB, name: "xames-web" },
      { path: ADMIN, name: "xames-admin" },
    ]);
    const web = await screen.findByRole("region", { name: "xames-web" });
    await waitFor(() => expect(within(web).getByTestId("link-chip")).toBeTruthy());
    const admin = screen.getByRole("region", { name: "xames-admin" });
    expect(within(admin).getByTestId("link-chip")).toBeTruthy();
  });

  it("does not claim link-scan truncation when the eligible file count exactly fills the budget (W7 review)", async () => {
    // BIG alone has more eligible files than the budget when both other repos are hidden;
    // shrink the view to exactly LINK_SCAN_FILE_LIMIT files across two repos.
    const exact = LINK_SCAN_FILE_LIMIT - 1; // WEB contributes 1 more eligible file
    CHANGES[BIG] = changes(
      BIG,
      "refactor/huge",
      BIG_FILES.slice(0, exact),
    );
    renderFiles([
      { path: BIG, name: "xames-big" },
      { path: WEB, name: "xames-web" },
    ]);
    await screen.findByRole("region", { name: "xames-big" });
    await waitFor(() => expect(getFileDiffVsDefault).toHaveBeenCalled());
    expect(screen.queryByText(/links searched in the first/)).toBeNull();
    // restore the full fixture for later tests
    CHANGES[BIG] = changes(BIG, "refactor/huge", BIG_FILES);
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
    CHANGES[WEB] = changes(WEB, "feat/shared-route", [file("src/route.ts", 1)]);
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

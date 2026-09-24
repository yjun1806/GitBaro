// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import type { ActivityEvent, BranchChangedFile, BranchChanges, FileDiffVsDefault } from "@/types";

const APP = "/work/xames-app";
const API = "/work/xames-backend";
const DESIGN = "/work/xames-design";

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

const getChangesVsDefault = vi.fn(async (path: string) => CHANGES[path]);
const getFileDiffVsDefault = vi.fn(
  async (path: string, filePath: string, _oldPath: string | null) => DIFFS[`${path}:${filePath}`],
);
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  getChangesVsDefault: (path: string) => getChangesVsDefault(path),
  getFileDiffVsDefault: (path: string, filePath: string, oldPath: string | null) =>
    getFileDiffVsDefault(path, filePath, oldPath),
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

  it("uses the single-repository subtitle in Korean too", async () => {
    await i18n.changeLanguage("ko");
    renderFiles([{ path: APP, name: "xames-app" }]);
    expect(await screen.findByText(/그 저장소의 main과 비교/)).toBeTruthy();
    expect(screen.queryByText(/각 저장소의 main과 비교/)).toBeNull();
  });
});

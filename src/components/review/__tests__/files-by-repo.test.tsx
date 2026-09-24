// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import type { ActivityEvent, BranchChangedFile, BranchChanges, FileDiffVsDefault } from "@/types";

const APP = "/work/xames-app";
const API = "/work/xames-backend";

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
};

const getChangesVsDefault = vi.fn(async (path: string) => CHANGES[path]);
const getFileDiffVsDefault = vi.fn(async (path: string, filePath: string) => DIFFS[`${path}:${filePath}`]);
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  getChangesVsDefault: (path: string) => getChangesVsDefault(path),
  getFileDiffVsDefault: (path: string, filePath: string) => getFileDiffVsDefault(path, filePath),
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

function renderFiles(repos: { path: string; name: string }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FilesByRepo repos={repos} />
    </QueryClientProvider>,
  );
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
});

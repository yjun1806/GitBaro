// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import type { DiffOutput } from "@/types";
import { usePrViewStore } from "../pr-view";
import { detail, rawFiles, REPO, repo } from "./pr-fixtures";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
// diff 그리기는 DiffViewer의 몫이다. 여기서는 무엇을 넘겼는지만 본다.
vi.mock("@/components/diff/DiffViewer", () => ({
  DiffViewer: ({ diff, revealLine }: { diff: DiffOutput | null; revealLine?: number | null }) => (
    <div data-testid="diff-viewer">
      <span data-testid="diff-path">{diff?.filePath}</span>
      <span data-testid="diff-lines">{diff?.hunks.flatMap((h) => h.lines.map((l) => `${l.lineType}:${l.newLineNo ?? "-"}`)).join(",")}</span>
      <span data-testid="diff-old">{diff?.oldContent}</span>
      <span data-testid="diff-reveal">{revealLine ?? ""}</span>
    </div>
  ),
}));

const { PrDetailPane } = await import("../PrDetailPane");

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler> = {};

function renderPane() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PrDetailPane />
    </QueryClientProvider>,
  );
}

Element.prototype.scrollIntoView = vi.fn();

/** 왼쪽 칸의 파일 줄(개요의 코드 코멘트에도 같은 경로 글이 있어 줄만 고른다). */
async function fileRow(path: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = screen.getAllByTitle(path).find((el) => el.tagName === "BUTTON");
    if (!row) throw new Error(`no file row for ${path}`);
    return row;
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  handlers = {
    get_pull_request: () => detail(),
    list_pull_request_files: () => rawFiles,
    get_branches: () => [],
  };
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    const handler = handlers[cmd];
    if (!handler) return [];
    return handler(args);
  });
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useUIStore.setState({ isDiffMaximized: false });
  usePrViewStore.setState({ open: true, filter: "open", selected: { repoPath: REPO, number: 42 }, selectedFile: null });
});

afterEach(cleanup);

describe("PrDetailPane", () => {
  it("asks to pick a PR when none is selected", () => {
    usePrViewStore.setState({ selected: null });
    renderPane();
    expect(screen.getByText(i18n.t("pr.selectTitle"))).toBeTruthy();
  });

  it("shows the overview: sanitized description, checks, commits and time-ordered conversation", async () => {
    const { container } = renderPane();
    await screen.findByRole("heading", { name: "Add login form" });
    expect(container.querySelector(".pr-md strong")?.textContent).toBe("login");
    expect(container.innerHTML).not.toContain("onerror");
    expect(screen.getByText("test")).toBeTruthy();
    expect(screen.getByText("feat: add form")).toBeTruthy();

    const conversation = screen.getByRole("heading", { name: /Conversation/ }).parentElement!;
    const entries = within(conversation).getAllByRole("listitem");
    expect(entries.map((li) => li.textContent)).toEqual([
      expect.stringContaining("First comment"),
      expect.stringContaining(i18n.t("pr.reviewEvent.approved")),
    ]);
    expect(invoke).toHaveBeenCalledWith("get_pull_request", { repoPath: REPO, accountId: "yj", number: 42, force: false });
  });

  it("lists changed files with unresolved thread counts", async () => {
    renderPane();
    const row = await fileRow("src/login.ts");
    // 자리가 있는 스레드 1 + 지난 코드 스레드 1, 둘 다 해결 안 됨.
    expect(within(row).getByTitle(i18n.t("pr.thread.openCount", { count: 2 }))).toBeTruthy();
    expect(screen.getByTitle("assets/logo.png")).toBeTruthy();
  });

  it("shows GitHub's patch with threads under the diff when the commits are not local", async () => {
    renderPane();
    fireEvent.click(await fileRow("src/login.ts"));
    expect((await screen.findByTestId("diff-path")).textContent).toBe("src/login.ts");
    expect(screen.getByTestId("diff-lines").textContent).toBe("context:10,delete:-,add:11");
    expect(invoke).not.toHaveBeenCalledWith("get_pull_request_file_diff", expect.anything());

    // 자리가 있는 스레드는 펼쳐져 있고, 누르면 diff가 그 줄로 간다.
    expect(screen.getByText("Why this line?")).toBeTruthy();
    fireEvent.click(screen.getByTitle(i18n.t("pr.thread.reveal")));
    expect(screen.getByTestId("diff-reveal").textContent).toBe("11");

    // 지난 코드 스레드는 접혀 있다가 펼치면 diff 조각과 함께 보인다.
    expect(screen.queryByText("Stale remark")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("pr.thread.outdatedGroup", { count: 1 }) }));
    expect(screen.getByText("Stale remark")).toBeTruthy();
    expect(screen.getByText("+old line")).toBeTruthy();
  });

  it("uses the local diff when base and head are in the clone", async () => {
    handlers.get_pull_request = () => detail({ localDiff: true });
    handlers.get_pull_request_file_diff = () => ({
      filePath: "src/login.ts",
      oldPath: null,
      binary: false,
      insertions: 1,
      deletions: 0,
      hunks: [{ header: "@@ -1 +1,2 @@\n", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "x\n", oldLineNo: null, newLineNo: 2 }] }],
      oldContent: "full old file",
      newContent: "full new file",
      baseOid: "mb",
      baseIsDivergencePoint: true,
    });
    renderPane();
    fireEvent.click(await fileRow("src/login.ts"));
    await waitFor(() => expect(screen.getByTestId("diff-old").textContent).toBe("full old file"));
    expect(invoke).toHaveBeenCalledWith("get_pull_request_file_diff", {
      repoPath: REPO,
      baseSha: "base0",
      headSha: "head1",
      filePath: "src/login.ts",
      oldPath: null,
    });
  });

  it("points to GitHub when a file has no patch", async () => {
    renderPane();
    fireEvent.click(await fileRow("assets/logo.png"));
    expect(await screen.findByText(i18n.t("pr.file.noPatch"))).toBeTruthy();
  });

  it("opens a thread's file and line from the overview", async () => {
    renderPane();
    const codeComments = (await screen.findByRole("heading", { name: /Comments on code/ })).parentElement!;
    fireEvent.click(within(codeComments).getByText("Why this line?"));
    expect(usePrViewStore.getState().selectedFile).toBe("src/login.ts");
    expect((await screen.findByTestId("diff-reveal")).textContent).toBe("11");
  });

  it("explains a missing PR", async () => {
    handlers.get_pull_request = () => {
      throw { type: "GithubApi", message: "HTTP 404: Pull request not found" };
    };
    renderPane();
    expect(await screen.findByText(i18n.t("pr.error.notFound"))).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { usePrViewStore } from "../pr-view";
import { REPO, repo, summary } from "./pr-fixtures";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

const { PrListView } = await import("../PrListView");

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler> = {};

function renderList(props: Parameters<typeof PrListView>[0] = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PrListView {...props} />
    </QueryClientProvider>,
  );
}

Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  handlers = {
    get_branches: () => [{ name: "feat/current", isHead: true, isRemote: false }],
    list_pull_requests: () => [
      summary({ number: 1, title: "Older PR", headRef: "feat/other", reviewDecision: "approved", ciState: "success" }),
      summary({ number: 2, title: "My branch PR", headRef: "feat/current", commentCount: 2, threadCount: 1 }),
      summary({ number: 3, title: "Draft PR", isDraft: true, ciState: "failure" }),
    ],
  };
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    const handler = handlers[cmd];
    if (!handler) return [];
    return handler(args);
  });
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  usePrViewStore.setState({ open: true, filter: "open", selected: null, selectedFile: null });
});

afterEach(cleanup);

/** 줄마다 그 줄에 보이는 PR 제목(화면 순서). */
function rowTitles(): string[] {
  const titles = ["My branch PR", "Older PR", "Draft PR", "Some change"];
  return screen.getAllByRole("option").map((el) => titles.find((t) => el.textContent?.includes(t)) ?? "");
}

describe("PrListView", () => {
  it("lists open PRs with the checked-out branch's PR first and marked", async () => {
    renderList();
    // 브랜치 목록이 오면 지금 브랜치의 PR이 맨 위로 온다.
    await waitFor(() => expect(rowTitles()).toEqual(["My branch PR", "Older PR", "Draft PR"]));
    const mine = screen.getAllByRole("option")[0];
    expect(within(mine).getByText(i18n.t("pr.currentBranch"))).toBeTruthy();
    expect(within(mine).getByTitle(i18n.t("pr.commentCount", { count: 3 }))).toBeTruthy();

    const older = screen.getAllByRole("option")[1];
    expect(within(older).getByText(i18n.t("pr.review.approved"))).toBeTruthy();
    expect(within(older).getByText(i18n.t("pr.ci.success"))).toBeTruthy();
    const draft = screen.getAllByRole("option")[2];
    expect(within(draft).getByText(i18n.t("pr.state.draft"))).toBeTruthy();
    expect(within(draft).getByText(i18n.t("pr.ci.failure"))).toBeTruthy();

    expect(invoke).toHaveBeenCalledWith("list_pull_requests", {
      repoPath: REPO,
      accountId: "yj",
      state: "open",
      force: false,
    });
  });

  it("selects a PR for the detail pane on click", async () => {
    renderList();
    fireEvent.click(await screen.findByText("Older PR"));
    expect(usePrViewStore.getState().selected).toEqual({ repoPath: REPO, number: 1 });
  });

  it("switches the filter and asks for closed PRs", async () => {
    handlers.list_pull_requests = ({ state }) => (state === "closed" ? [] : [summary()]);
    renderList();
    await screen.findByText("Some change");
    fireEvent.click(screen.getByRole("button", { name: /State/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("pr.filter.closed") }));
    await screen.findByText(i18n.t("pr.empty.closed"));
    expect(invoke).toHaveBeenCalledWith("list_pull_requests", expect.objectContaining({ state: "closed" }));
  });

  it("shows only the branch's PRs while 'This branch only' is on, and every PR once it is off (5.1)", async () => {
    const onToggle = vi.fn();
    const { rerender } = renderList({ branchFilter: { branch: "feat/other", on: true, onToggle } });
    await waitFor(() => expect(rowTitles()).toEqual(["Older PR"]));
    const chip = screen.getByRole("button", { name: "This branch only" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalled();
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PrListView branchFilter={{ branch: "feat/other", on: false, onToggle }} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
  });

  it("does not show the previous repository's PRs while the next one loads", async () => {
    // 이전 저장소의 줄이 남아 있으면 그 줄을 눌러 새 저장소에서 엉뚱한 번호의 PR을 연다.
    const other = { ...repo, path: "/work/other", name: "other" } as typeof repo;
    handlers.list_pull_requests = ({ repoPath }) =>
      repoPath === REPO ? [summary({ title: "Old repo PR" })] : new Promise(() => {});
    renderList();
    await screen.findByText("Old repo PR");
    useRepositoryStore.setState({ repos: [repo, other], activeRepo: other, activeRepoPath: other.path });
    await waitFor(() => expect(screen.queryByText("Old repo PR")).toBeNull());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("refresh bypasses the backend cache", async () => {
    renderList();
    await screen.findByText("Older PR");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("pr.refresh") }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("list_pull_requests", expect.objectContaining({ force: true })),
    );
  });

  it("explains a 404 as an account that cannot see the repository", async () => {
    handlers.list_pull_requests = () => {
      throw { type: "GithubApi", message: "HTTP 404: Could not resolve to a Repository" };
    };
    renderList();
    await screen.findByText(i18n.t("pr.error.notFound"));
  });

  it("asks for an account before calling GitHub", async () => {
    const noAccount = { ...repo, accountId: null } as typeof repo;
    useRepositoryStore.setState({ repos: [noAccount], activeRepo: noAccount });
    renderList();
    await screen.findByText(i18n.t("pr.noAccount"));
    expect(invoke).not.toHaveBeenCalledWith("list_pull_requests", expect.anything());
  });

  it("opens the PR menu on right click with copy and GitHub actions", async () => {
    renderList();
    fireEvent.contextMenu(await screen.findByText("Older PR"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: i18n.t("pr.menu.copyLink") })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: i18n.t("pr.openOnGitHub") })).toBeTruthy();
    // head 브랜치(feat/other)가 로컬에도 원격에도 없으니 보기·체크아웃을 막는다.
    expect(
      within(menu).getByRole("menuitem", { name: i18n.t("pr.menu.checkout") }).hasAttribute("disabled") ||
        within(menu).getByRole("menuitem", { name: i18n.t("pr.menu.checkout") }).getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });
});

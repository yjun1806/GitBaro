// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import "@/i18n/config";
import i18n from "@/i18n/config";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";
import { buildRepoTree } from "@/lib/repo-tree";
import { useAccountStore } from "@/stores/account";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useWorkspaceStore } from "@/stores/workspace";

vi.mock("@/api/commands", () => ({ getWorktrees: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), ask: vi.fn() }));

import { RepoTree } from "../RepoTree";
import type { SidebarTreeData } from "../useSidebarTreeData";

const xames = makeRepo("xames", "acme");
const xamesAdmin = makeRepo("xames-admin", "acme");
const xamesApi = makeRepo("xames-api", "acme");
const solo = makeRepo("solo", "acme");
const repos = [xames, xamesAdmin, xamesApi, solo];

/** 스토어를 구독해 트리를 다시 만드는 사이드바. 스토어가 바뀌면 화면도 바뀐다. */
function Harness() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const orderByParent = useWorkspaceStore((s) => s.orderByParent);
  const sortModeByAccount = useWorkspaceStore((s) => s.sortModeByAccount);
  const currentRepos = useRepositoryStore((s) => s.repos);
  const data: SidebarTreeData = {
    tree: buildRepoTree({
      repos: currentRepos,
      accounts: [],
      workspaces,
      orderByParent,
      sortModeByAccount,
    }),
    signals: {},
    syncByPath: {},
    reviewByPath: {},
    reviewRepos: [],
    worktreesByRepo: {},
    lastChangedAt: {},
    watched: [],
    overflow: [],
    now: 0,
    branchOf: () => null,
  };
  return (
    <RepoTree data={data} fetchingPath={null} onSelectRepo={vi.fn()} onRepoContextMenu={vi.fn()} />
  );
}

function renderTree() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const item = (name: string) => screen.getByRole("treeitem", { name });
const suggestionTitle = () => i18n.t("workspace.suggestion.title", { name: "xames", count: 3 });

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  useAccountStore.setState({ accounts: [] });
  useActivityTargetsStore.setState({ extraByKey: {} });
  useToastStore.setState({ toasts: [] });
  useRepositoryStore.setState({
    repos,
    activeRepoPath: null,
    activeRepo: null,
    activeWorktrees: {},
    favoriteRepos: [],
  });
  useWorkspaceStore.setState({
    workspaces: [],
    orderByParent: {},
    sortModeByAccount: {},
    collapsed: [],
    dismissedSuggestions: [],
  });
});

afterEach(cleanup);

describe("workspace suggestion", () => {
  it("offers a workspace for three repositories with the same name prefix", () => {
    renderTree();
    const banner = screen.getByRole("region", { name: suggestionTitle() });
    expect(within(banner).getByText(suggestionTitle())).toBeInTheDocument();
  });

  it("is shown only once: dismissing records the key and it does not come back after remount", () => {
    const first = renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByRole("region", { name: suggestionTitle() })).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().dismissedSuggestions).toEqual(["acme/xames"]);

    first.unmount();
    renderTree();
    expect(screen.queryByRole("region", { name: suggestionTitle() })).not.toBeInTheDocument();
  });

  it("creates the workspace on accept and does not suggest it again after the workspace is deleted", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    const [ws] = useWorkspaceStore.getState().workspaces;
    expect(ws).toMatchObject({ name: "xames", accountKey: "acme" });
    expect(ws.repoPaths).toEqual([xames.path, xamesAdmin.path, xamesApi.path]);
    expect(item("xames-admin")).toHaveAttribute("aria-level", "3");
    expect(screen.queryByRole("region", { name: suggestionTitle() })).not.toBeInTheDocument();

    act(() => {
      useWorkspaceStore.getState().deleteWorkspace(ws.id);
    });
    expect(item("xames-admin")).toHaveAttribute("aria-level", "2");
    expect(screen.queryByRole("region", { name: suggestionTitle() })).not.toBeInTheDocument();
  });

  it("is hidden while searching", () => {
    renderTree();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "solo" } });
    expect(screen.queryByRole("region", { name: suggestionTitle() })).not.toBeInTheDocument();
  });
});

describe("workspace create / rename / delete", () => {
  it("creates a workspace from the account header and rejects an empty name", () => {
    useWorkspaceStore.setState({ dismissedSuggestions: ["acme/xames"] });
    renderTree();

    fireEvent.click(within(item("acme")).getByRole("button", { name: "New workspace" }));
    const dialog = screen.getByRole("dialog", { name: "New workspace in acme" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter a name");
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  games " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaces).toMatchObject([
      { name: "games", accountKey: "acme", repoPaths: [] },
    ]);
    expect(item("games")).toHaveAttribute("aria-level", "2");
    // 머리글 안의 버튼을 눌러도 계정이 접히지 않는다.
    expect(item("acme")).toHaveAttribute("aria-expanded", "true");
  });

  it("renames a workspace from its context menu", () => {
    const created = useWorkspaceStore.getState().createWorkspace("product", "acme", [solo.path]);
    if (!created.ok) throw new Error(created.reason);
    renderTree();

    fireEvent.contextMenu(item("product"), { clientX: 30, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workspace" });
    const input = within(dialog).getByLabelText("Name");
    expect(input).toHaveValue("product");
    fireEvent.change(input, { target: { value: "platform" } });
    fireEvent.submit(input);

    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("platform");
    expect(item("platform")).toBeInTheDocument();
  });

  it("deleting a workspace puts its repositories back under the account and keeps them", () => {
    useWorkspaceStore.setState({ dismissedSuggestions: ["acme/xames"] });
    const created = useWorkspaceStore
      .getState()
      .createWorkspace("product", "acme", [xamesAdmin.path, solo.path]);
    if (!created.ok) throw new Error(created.reason);
    renderTree();
    expect(item("solo")).toHaveAttribute("aria-level", "3");

    fireEvent.contextMenu(item("product"), { clientX: 30, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete workspace…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete workspace" });
    // 확인 문구가 저장소는 지우지 않는다고 알린다.
    expect(dialog).toHaveTextContent("move back directly under acme");
    expect(dialog).toHaveTextContent("not removed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete workspace" }));

    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    expect(screen.queryByRole("treeitem", { name: "product" })).not.toBeInTheDocument();
    expect(item("solo")).toHaveAttribute("aria-level", "2");
    expect(item("xames-admin")).toHaveAttribute("aria-level", "2");
    expect(useRepositoryStore.getState().repos.map((r) => r.path)).toEqual(repos.map((r) => r.path));
  });

  it("cancelling the delete confirmation keeps the workspace", () => {
    const created = useWorkspaceStore.getState().createWorkspace("product", "acme", [solo.path]);
    if (!created.ok) throw new Error(created.reason);
    renderTree();

    fireEvent.contextMenu(item("product"), { clientX: 30, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete workspace…" }));
    const cancels = within(screen.getByRole("dialog")).getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancels[cancels.length - 1]);

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(item("solo")).toHaveAttribute("aria-level", "3");
  });
});

describe("sort menu", () => {
  it("shows the current mode and switches the account's sort mode", () => {
    renderTree();
    const button = within(item("acme")).getByRole("button", { name: /Sort: Custom order/ });
    fireEvent.click(button);

    const menu = screen.getByRole("menu", { name: "Sort" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Custom order (drag)",
      "By name",
      "Recent activity",
      "Needs attention first",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "true");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "By name" }));
    expect(useWorkspaceStore.getState().sortModeByAccount.acme).toBe("name");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(within(item("acme")).getByRole("button", { name: /Sort: By name/ })).toBeInTheDocument();
    // 메뉴를 여닫아도 계정 행은 접히지 않는다.
    expect(item("acme")).toHaveAttribute("aria-expanded", "true");
  });

  it("supports the menu keyboard: arrows move focus and Escape closes", () => {
    renderTree();
    fireEvent.click(within(item("acme")).getByRole("button", { name: /Sort:/ }));
    const menu = screen.getByRole("menu", { name: "Sort" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().sortModeByAccount.acme).toBeUndefined();
  });
});

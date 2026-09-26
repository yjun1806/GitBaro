// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import type { BranchInfo, RepoInfo } from "@/types";

const branch = (name: string, isRemote = false): BranchInfo =>
  ({ name, isRemote, isHead: false, isDefault: false, upstream: null }) as BranchInfo;

const invoke = vi.fn(async (cmd: string, _args?: unknown): Promise<unknown> => {
  switch (cmd) {
    case "get_branches":
      return [branch("main"), branch("develop"), branch("origin/main", true), branch("origin/HEAD", true)];
    case "get_default_branches":
      return [{ path: APP, name: "main", hasLocal: true, remoteRef: "origin/main" }];
    case "get_worktrees":
      return [
        { path: APP, branch: "main", isMain: true, isBare: false },
        { path: "/work/app-feat", branch: "feat", isMain: false, isBare: false },
      ];
    case "validate_token":
      return { valid: true, canPush: true };
    default:
      return undefined;
  }
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const { RepoSettingsHost } = await import("../repo/RepoSettingsDialog");
const { useRepositoryStore } = await import("@/stores/repository");
const { useRepoSettingsStore } = await import("@/stores/repo-settings");
const { useAccountStore } = await import("@/stores/account");
const { useWorkspaceStore } = await import("@/stores/workspace");
const { usePreferencesStore, DEFAULT_PREFERENCES } = await import("@/stores/preferences");
const { AVATAR_HUES } = await import("@/lib/avatar-color");

const APP = "/work/app";
const app: RepoInfo = {
  path: APP,
  name: "app",
  currentBranch: "main",
  isDirty: false,
  remotes: [{ name: "origin", url: "https://github.com/acme/app.git" }],
  accountId: "acc1",
};

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RepoSettingsHost />
    </QueryClientProvider>,
  );
}

function openAt(section?: Parameters<ReturnType<typeof useRepoSettingsStore.getState>["open"]>[1]) {
  act(() => useRepoSettingsStore.getState().open(APP, section));
}

const nav = () => screen.getByRole("navigation");
const goTo = (label: string) => fireEvent.click(within(nav()).getByRole("button", { name: label }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  useRepositoryStore.setState({
    repos: [app],
    activeRepoPath: APP,
    activeRepo: app,
    favoriteRepos: [],
    autoSyncByRepo: {},
    repoPrefs: {},
    repoPermissions: {},
    activeWorktrees: {},
  });
  useAccountStore.setState({
    accounts: [
      { id: "acc1", username: "acme", email: "", avatarUrl: "" },
      { id: "acc2", username: "other", email: "", avatarUrl: "" },
    ],
  });
  useWorkspaceStore.setState({
    workspaces: [{ id: "w1", name: "product", accountKey: "acme", repoPaths: [] }],
    orderByParent: {},
  });
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  useRepoSettingsStore.setState({ repoPath: null, section: "name" });
});
afterEach(cleanup);

describe("Repository settings", () => {
  it("opens for one repository with every section on the left", () => {
    renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
    openAt();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(nav()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Name",
      "GitHub account",
      "Remote sync",
      "List",
      "Notifications",
      "Info",
      "Remove from list",
    ]);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("app");
  });

  it("saves a display name on blur and shows the folder name beside it, without renaming anything", () => {
    renderHost();
    openAt();
    const input = screen.getByRole("textbox", { name: "Display name" });
    expect(input).toHaveAttribute("placeholder", "app");
    fireEvent.change(input, { target: { value: "  Shop front " } });
    fireEvent.blur(input);
    const state = useRepositoryStore.getState();
    expect(state.repoPrefs[APP]).toEqual({ alias: "Shop front" });
    expect(state.repos[0].name).toBe("app");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Shop front");
    // 창 제목 아래에 실제 폴더 이름을 보인다.
    expect(screen.getByText("app", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use folder name" }));
    expect(useRepositoryStore.getState().repoPrefs).toEqual({});
  });

  it("keeps a typed name when the window closes before the field loses focus", () => {
    renderHost();
    openAt();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), { target: { value: "Shop" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useRepositoryStore.getState().repoPrefs[APP]).toEqual({ alias: "Shop" });
  });

  it("picks an avatar color from the palette and goes back to automatic", () => {
    renderHost();
    openAt();
    fireEvent.click(screen.getByRole("radio", { name: "Color 3" }));
    expect(useRepositoryStore.getState().repoPrefs[APP]).toEqual({ hue: AVATAR_HUES[2] });
    fireEvent.click(screen.getByRole("radio", { name: "Automatic" }));
    expect(useRepositoryStore.getState().repoPrefs).toEqual({});
  });

  it("assigns another account and checks its permission", async () => {
    renderHost();
    openAt("account");
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "acc2" } });
    expect(useRepositoryStore.getState().repos[0].accountId).toBe("acc2");
    expect(await screen.findByText("This account can push.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("validate_token", { accountId: "acc2", repoPath: APP });
  });

  it("follows the app default for auto sync until the repository gets its own setting", () => {
    usePreferencesStore.setState({ defaultAutoSync: { mode: "fetch", intervalMinutes: 5 } });
    renderHost();
    openAt("sync");
    const follow = screen.getByRole("switch", { name: "Use the app default" });
    expect(follow).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Check only" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Pull automatically" })).toBeDisabled();

    fireEvent.click(follow);
    expect(useRepositoryStore.getState().autoSyncByRepo[APP]).toEqual({ mode: "fetch", intervalMinutes: 5 });
    fireEvent.click(screen.getByRole("radio", { name: "Pull automatically" }));
    expect(useRepositoryStore.getState().autoSyncByRepo[APP]).toEqual({ mode: "pull", intervalMinutes: 5 });

    fireEvent.click(follow);
    expect(useRepositoryStore.getState().autoSyncByRepo).toEqual({});
  });

  it("marks a favorite and moves the repository into a workspace of its account", () => {
    renderHost();
    openAt("list");
    fireEvent.click(screen.getByRole("switch", { name: "Favorite" }));
    expect(useRepositoryStore.getState().favoriteRepos).toEqual([APP]);
    fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), { target: { value: "w1" } });
    expect(useWorkspaceStore.getState().workspaces[0].repoPaths).toEqual([APP]);
    fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), { target: { value: "" } });
    expect(useWorkspaceStore.getState().workspaces[0].repoPaths).toEqual([]);
  });

  it("overrides notifications for this repository only", () => {
    renderHost();
    openAt("notifications");
    const commits = screen.getByRole("radiogroup", { name: "New commits" });
    expect(within(commits).getByRole("radio", { name: "App setting" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(commits).getByRole("radio", { name: "Off" }));
    expect(useRepositoryStore.getState().repoPrefs[APP]).toEqual({ notify: { newCommits: "off" } });
    fireEvent.click(within(commits).getByRole("radio", { name: "App setting" }));
    expect(useRepositoryStore.getState().repoPrefs).toEqual({});
  });

  it("shows where the repository lives and what it points at", async () => {
    renderHost();
    openAt("info");
    expect(screen.getByText(APP)).toBeInTheDocument();
    expect(screen.getByText("https://github.com/acme/app.git")).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View on GitHub" })).toBeEnabled();
  });

  it("removes the repository from the list after confirming, and closes", async () => {
    renderHost();
    openAt();
    goTo("Remove from list");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    });
    expect(useRepositoryStore.getState().repos).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

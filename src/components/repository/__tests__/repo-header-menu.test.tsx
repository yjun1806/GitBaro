// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useAccountStore } from "@/stores/account";
import type { RepoInfo } from "@/types";

const invoke = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => false) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const { RepoHeaderContextMenu } = await import("../RepoHeaderContextMenu");
const { ask } = await import("@tauri-apps/plugin-dialog");

const API = "/r/api";
const WEB = "/r/web";
function repo(path: string, accountId: string | null = "acc1"): RepoInfo {
  const name = path.split("/").pop()!;
  return {
    path,
    name,
    currentBranch: "main",
    isDirty: false,
    remotes: [{ name: "origin", url: `https://github.com/acme/${name}.git` }],
    accountId,
  } as RepoInfo;
}

function renderMenu(target: RepoInfo, onRemove = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoHeaderContextMenu repo={target} settings={null} position={{ x: 0, y: 0 }} onRemove={onRemove} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onRemove };
}
const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });
const labels = () => within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  useRepositoryStore.setState({ repos: [repo(API), repo(WEB)], favoriteRepos: [] });
  useAccountStore.setState({ accounts: [{ id: "acc1", username: "acme" }] as never });
  useWorkspaceStore.setState({
    workspaces: [
      { id: "w1", name: "product", accountKey: "acme", repoPaths: [WEB] },
      { id: "w2", name: "other", accountKey: "someone-else", repoPaths: [] },
    ],
    orderByParent: {},
  });
});
afterEach(cleanup);

describe("RepoHeaderContextMenu", () => {
  it("keeps removal from the list last, behind a confirm", async () => {
    const { onRemove } = renderMenu(repo(API));
    const all = labels();
    expect(all[all.length - 1]).toBe(i18n.t("repo.contextMenu.remove"));
    await act(async () => {
      fireEvent.click(menuItem(i18n.t("repo.contextMenu.remove")));
    });
    expect(ask).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("toggles the favorite mark", () => {
    renderMenu(repo(API));
    fireEvent.click(menuItem("Add to favorites"));
    expect(useRepositoryStore.getState().favoriteRepos).toEqual([API]);
  });

  it("moves the repository only into a workspace of the same account", () => {
    renderMenu(repo(API));
    expect(labels()).toContain("Move to product");
    expect(labels()).not.toContain("Move to other");
    fireEvent.click(menuItem("Move to product"));
    expect(useWorkspaceStore.getState().workspaces[0].repoPaths).toEqual([WEB, API]);
  });

  it("takes a repository out of its workspace", () => {
    renderMenu(repo(WEB));
    fireEvent.click(menuItem("Take out of product"));
    expect(useWorkspaceStore.getState().workspaces[0].repoPaths).toEqual([]);
  });

  it("fetches with the repository's own account, and not at all without one", async () => {
    renderMenu(repo(API));
    await act(async () => {
      fireEvent.click(menuItem("Fetch"));
    });
    expect(invoke).toHaveBeenCalledWith("git_fetch", { repoPath: API, accountId: "acc1", automatic: false });
    cleanup();
    renderMenu(repo(API, null));
    expect((menuItem("Fetch") as HTMLButtonElement).disabled).toBe(true);
  });
});

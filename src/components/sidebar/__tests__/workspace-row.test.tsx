// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useAccountStore } from "@/stores/account";
import type { RepoInfo } from "@/types";

vi.mock("@/components/review/MultiRepoRemoteDialog", () => ({
  MultiRepoRemoteDialog: ({ paths }: { paths: string[] }) => <div data-testid="fetch-dialog">{paths.join(",")}</div>,
}));

const { WorkspaceRow } = await import("../WorkspaceRow");

function repo(path: string, owner: string): RepoInfo {
  const name = path.split("/").pop()!;
  return {
    path,
    name,
    currentBranch: "main",
    isDirty: false,
    remotes: [{ name: "origin", url: `https://github.com/${owner}/${name}.git` }],
    accountId: null,
  } as RepoInfo;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useAccountStore.setState({ accounts: [] });
  useRepositoryStore.setState({
    repos: [repo("/r/api", "acme"), repo("/r/moved", "someone-else")],
  });
  useWorkspaceStore.setState({
    workspaces: [{ id: "w1", name: "product", accountKey: "acme", repoPaths: ["/r/api", "/r/moved", "/r/gone"] }],
    activeWorkspaceId: null,
  });
});
afterEach(cleanup);

describe("WorkspaceRow", () => {
  it("fetches only the repositories the tree shows in the workspace", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
      <div role="tree">
        <WorkspaceRow
          nodeKey="ws:w1"
          workspaceId="w1"
          name="product"
          accountLabel="acme"
          repoCount={1}
          memberCount={1}
          signals={{ dirty: 0, live: false, watched: false, changedAt: 0, ahead: 0 }}
          now={0}
          expanded
          draggable={false}
          onToggle={vi.fn()}
        />
      </div>
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByRole("treeitem"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Fetch all repositories…" }));
    expect(screen.getByTestId("fetch-dialog").textContent).toBe("/r/api");
  });
});

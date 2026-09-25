// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import type { RepoInfo } from "@/types";

const invoke = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const openUrl = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
const branchData = vi.hoisted(() => ({ list: [] as { name: string; isRemote: boolean; upstream: string | null }[] }));
vi.mock("@/api/queries", () => ({ useBranches: () => ({ data: branchData.list }) }));
const { useCurrentPlaceMenu } = await import("../useCurrentPlaceMenu");

const writeText = vi.fn(async (_text: string) => {});
const WT = "/r/app-feat";

function Host({ branch }: { branch: string | null }) {
  const menu = useCurrentPlaceMenu(branch);
  return (
    <>
      <button type="button" onContextMenu={menu.onContextMenu}>
        chip
      </button>
      {menu.element}
    </>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
  branchData.list = [];
  const repo = {
    path: "/r/app",
    name: "app",
    remotes: [
      { name: "origin", url: "https://github.com/acme/app.git" },
      { name: "upstream", url: "https://github.com/up/app.git" },
    ],
  };
  useRepositoryStore.setState({ activeRepoPath: WT, activeRepo: repo as unknown as RepoInfo });
});
afterEach(cleanup);

describe("toolbar branch and worktree chip menu", () => {
  it("copies the branch and the open folder's path and opens the folder", () => {
    render(<Host branch="feat/x" />);
    fireEvent.contextMenu(screen.getByText("chip"));
    fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("branch.contextMenu.copyName") }));
    expect(writeText).toHaveBeenCalledWith("feat/x");
    fireEvent.contextMenu(screen.getByText("chip"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(writeText).toHaveBeenLastCalledWith(WT);
    fireEvent.contextMenu(screen.getByText("chip"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Terminal" }));
    expect(invoke).toHaveBeenCalledWith("open_in_terminal", { repoPath: WT });
  });

  it("has no branch items on a detached HEAD", () => {
    render(<Host branch={null} />);
    fireEvent.contextMenu(screen.getByText("chip"));
    expect(screen.queryByRole("menuitem", { name: i18n.t("branch.contextMenu.copyName") })).toBeNull();
    expect((screen.getByRole("menuitem", { name: "View on GitHub" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the tracked branch on its own remote, and not at all without one", () => {
    branchData.list = [{ name: "feat/x", isRemote: false, upstream: "upstream/feature-x" }];
    render(<Host branch="feat/x" />);
    fireEvent.contextMenu(screen.getByText("chip"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View on GitHub" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/up/app/tree/feature-x");
    cleanup();
    branchData.list = [{ name: "feat/x", isRemote: false, upstream: null }];
    render(<Host branch="feat/x" />);
    fireEvent.contextMenu(screen.getByText("chip"));
    expect((screen.getByRole("menuitem", { name: "View on GitHub" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";

// 저장소 전용 영역은 Tauri를 부른다. 이 테스트는 툴바가 어느 영역을 띄우는지만 본다.
vi.mock("@/components/toolbar/BranchZone", () => ({ BranchZone: () => <div>branch-zone</div> }));
vi.mock("@/components/toolbar/WorktreeZone", () => ({ WorktreeZone: () => <div>worktree-zone</div> }));
vi.mock("@/components/toolbar/SyncZone", () => ({ SyncZone: () => <div>sync-zone</div> }));
vi.mock("@/components/toolbar/AccountZone", () => ({ AccountZone: () => <div>account-zone</div> }));
vi.mock("@/api/queries", () => ({
  useReviewStatusQuery: () => ({ data: undefined }),
}));

import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const { ToolbarRoot } = await import("@/components/toolbar/ToolbarRoot");

const xames = makeRepo("xames", "mos");

function renderToolbar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToolbarRoot />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useRepositoryStore.setState({ repos: [xames], activeRepoPath: xames.path, activeRepo: xames });
  useWorkspaceStore.setState({
    workspaces: [{ id: "w1", name: "xames-ws", accountKey: "mos", repoPaths: [xames.path] }],
    activeWorkspaceId: null,
  });
});

afterEach(cleanup);

describe("ToolbarRoot — workspace mode", () => {
  it("shows the repository zones while a repository is picked", () => {
    renderToolbar();
    expect(screen.getByText("branch-zone")).toBeTruthy();
    expect(screen.getByText("sync-zone")).toBeTruthy();
    expect(screen.queryByText("xames-ws")).toBeNull();
  });

  it("turns off Fetch, Pull, Push, branch, Merge and Stash with a pick-a-repository hint", () => {
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace("w1");
    });
    renderToolbar();

    expect(screen.queryByText("branch-zone")).toBeNull();
    expect(screen.queryByText("worktree-zone")).toBeNull();
    expect(screen.queryByText("sync-zone")).toBeNull();
    // 워크스페이스 이름은 메인 칸 제목(W4-T3)이 맡는다. 툴바는 끄기만 한다.
    expect(screen.queryByText("xames-ws")).toBeNull();

    for (const label of ["Fetch", "Pull", "Push", "Branch", "Merge", "Stash"]) {
      const button = screen.getByRole("button", { name: `${label} — Pick a repository` });
      expect(button).toHaveProperty("disabled", true);
      expect(button.parentElement?.getAttribute("title")).toBe("Pick a repository");
    }
    // 계정과 설정은 그대로 쓸 수 있다.
    expect(screen.getByText("account-zone")).toBeTruthy();
    expect(screen.getByTitle("Settings")).toBeTruthy();
  });

  it("uses the Korean hint", async () => {
    await i18n.changeLanguage("ko");
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace("w1");
    });
    renderToolbar();
    expect(screen.getAllByTitle("저장소를 고르세요")).toHaveLength(6);
  });
});

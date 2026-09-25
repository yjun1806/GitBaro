// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";

// 저장소 전용 영역은 Tauri를 부른다. 이 테스트는 툴바가 어느 영역을 띄우는지만 본다.
vi.mock("@/components/toolbar/BranchZone", async () => {
  // 브랜치 버튼(BranchPanelButton)은 실제 것을 쓴다. 왼쪽 브랜치 칸만 가린다.
  const actual = await vi.importActual<typeof import("@/components/toolbar/BranchZone")>(
    "@/components/toolbar/BranchZone",
  );
  return { ...actual, BranchZone: () => <div>branch-zone</div> };
});
vi.mock("@/components/toolbar/WorktreeZone", () => ({ WorktreeZone: () => <div>worktree-zone</div> }));
vi.mock("@/components/toolbar/AccountZone", () => ({ AccountZone: () => <div>account-zone</div> }));
vi.mock("@/components/toolbar/AutoSyncHint", () => ({ AutoSyncHint: () => null }));
vi.mock("@/api/queries", () => ({
  useReviewStatusQuery: () => ({ data: undefined }),
  useBranches: () => ({ data: [] }),
  useHeadDetached: () => ({ data: false }),
  useTokenValidation: () => ({ data: undefined, isLoading: false }),
  useStatus: () => ({ data: [] }),
  useStashList: () => ({ data: [] }),
  useStashMutations: () => ({ push: {}, pushPartial: {} }),
  useRepoSyncStatuses: () => ({ data: undefined }),
  useUnpushedCommits: () => ({ data: undefined }),
  invalidateAfterSync: () => Promise.resolve(),
}));

import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const { ToolbarRoot } = await import("@/components/toolbar/ToolbarRoot");

const xames = makeRepo("xames", "mos");
const ALL_ACTIONS = ["fetch", "pull", "push", "branch", "editor", "terminal", "finder", "github"];

function renderToolbar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToolbarRoot />
    </QueryClientProvider>,
  );
}

function actionOrder(): string[] {
  return Array.from(document.querySelectorAll("[data-action]")).map(
    (el) => el.getAttribute("data-action") ?? "",
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

describe("ToolbarRoot — scope", () => {
  it("shows the repository zones and the git actions in the mockup order while a repository is picked", () => {
    renderToolbar();
    expect(screen.getByText("branch-zone")).toBeTruthy();
    expect(screen.getByText("worktree-zone")).toBeTruthy();
    expect(screen.queryByText("xames-ws")).toBeNull();
    expect(actionOrder()).toEqual(ALL_ACTIONS);
  });

  it("keeps the git actions in workspace mode; only Fetch, Pull and Push work across repositories", () => {
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace("w1");
    });
    renderToolbar();

    expect(screen.queryByText("branch-zone")).toBeNull();
    expect(screen.queryByText("worktree-zone")).toBeNull();
    // 워크스페이스 이름은 메인 칸 제목(W4-T3)이 맡는다.
    expect(screen.queryByText("xames-ws")).toBeNull();
    expect(actionOrder()).toEqual(ALL_ACTIONS);

    // Fetch·Pull·Push는 저장소별 확인 창(W5-T2)을 연다.
    for (const label of ["Fetch", "Pull", "Push"]) {
      expect(screen.getByRole("button", { name: label })).toHaveProperty("disabled", false);
    }
    for (const label of ["Branch", "Open in Terminal"]) {
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
    // 브랜치 하나와 저장소 열기 묶음의 버튼 넷이 꺼진다.
    expect(screen.getAllByTitle("저장소를 고르세요")).toHaveLength(5);
  });
});

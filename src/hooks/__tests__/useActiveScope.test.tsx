// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/commands", () => ({
  gitFetch: vi.fn(() => Promise.resolve()),
  getWorktrees: vi.fn(() => Promise.resolve([])),
  reviewStatus: vi.fn(() => Promise.resolve([])),
}));

import { useAccountStore } from "@/stores/account";
import {
  REPOS_STORAGE_KEY,
  REPOS_STORAGE_VERSION,
  sanitizeRepositoryState,
  useRepositoryStore,
} from "@/stores/repository";
import {
  WORKSPACES_STORAGE_KEY,
  migrateWorkspaceState,
  useWorkspaceStore,
} from "@/stores/workspace";
import {
  resolveActiveScope,
  useActiveScope,
  workspaceAccountId,
  workspaceWatchPaths,
} from "@/hooks/useActiveScope";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";
import { buildRepoTree } from "@/lib/repo-tree";
import type { GitHubAccount } from "@/types";

const personal = { id: "acc-yjun", username: "yjun" } as GitHubAccount;
const work = { id: "acc-mos", username: "mos" } as GitHubAccount;

const xames = makeRepo("xames", "mos", { accountId: work.id });
const xamesApp = makeRepo("xames-app", "mos", { accountId: work.id });
const gitbaro = makeRepo("GitBaro", "yjun", { accountId: personal.id });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function createWorkspace(): string {
  const result = useWorkspaceStore.getState().createWorkspace("xames", "mos", [
    xames.path,
    xamesApp.path,
  ]);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

beforeEach(() => {
  localStorage.clear();
  useAccountStore.setState({ accounts: [personal, work], activeAccountId: personal.id });
  useRepositoryStore.setState({
    repos: [xames, xamesApp, gitbaro],
    activeRepoPath: null,
    activeRepo: null,
    activeWorktrees: {},
  });
  useWorkspaceStore.setState({
    workspaces: [],
    orderByParent: {},
    sortModeByAccount: {},
    collapsed: [],
    dismissedSuggestions: [],
    activeWorkspaceId: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("저장소 ↔ 워크스페이스 전환", () => {
  it("워크스페이스를 고르면 저장소 선택이 풀리고 활성 계정이 워크스페이스 계정으로 바뀐다", () => {
    const id = createWorkspace();
    const { result } = renderHook(() => ({ ...useSelectRepo(), scope: useActiveScope() }), {
      wrapper,
    });

    act(() => result.current.selectRepo(gitbaro.path));
    expect(result.current.scope).toEqual({ kind: "repo", path: gitbaro.path });
    expect(useAccountStore.getState().activeAccountId).toBe(personal.id);

    act(() => result.current.selectWorkspace(id));
    expect(result.current.scope).toEqual({
      kind: "workspace",
      id,
      paths: [xames.path, xamesApp.path],
    });
    expect(useRepositoryStore.getState().activeRepoPath).toBeNull();
    expect(useRepositoryStore.getState().activeRepo).toBeNull();
    expect(useAccountStore.getState().activeAccountId).toBe(work.id);
  });

  it("저장소를 고르면 워크스페이스 선택이 풀리고 계정이 그 저장소의 계정으로 바뀐다", () => {
    const id = createWorkspace();
    const { result } = renderHook(() => ({ ...useSelectRepo(), scope: useActiveScope() }), {
      wrapper,
    });

    act(() => result.current.selectWorkspace(id));
    expect(useAccountStore.getState().activeAccountId).toBe(work.id);

    act(() => result.current.selectRepo(gitbaro.path));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(result.current.scope).toEqual({ kind: "repo", path: gitbaro.path });
    expect(useAccountStore.getState().activeAccountId).toBe(personal.id);
  });

  it("다른 경로(클론·워크트리 열기)로 저장소가 잡혀도 워크스페이스 선택이 풀린다", () => {
    const id = createWorkspace();
    useWorkspaceStore.getState().setActiveWorkspace(id);

    useRepositoryStore.getState().setActiveRepo("/repos/xames-wt/feature", xames.path);

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });

  it("없는 워크스페이스는 고르지 않고 저장소 선택도 그대로 둔다", () => {
    useRepositoryStore.getState().setActiveRepo(gitbaro.path);

    expect(useWorkspaceStore.getState().setActiveWorkspace("nope")).toEqual({
      ok: false,
      reason: "unknown-workspace",
    });
    expect(useRepositoryStore.getState().activeRepoPath).toBe(gitbaro.path);
  });

  it("고른 워크스페이스를 지우면 선택이 풀린다", () => {
    const id = createWorkspace();
    useWorkspaceStore.getState().setActiveWorkspace(id);

    useWorkspaceStore.getState().deleteWorkspace(id);

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });
});

describe("resolveActiveScope", () => {
  const ws = { id: "w1", name: "x", accountKey: "mos", repoPaths: [xames.path, "/gone"] };
  const accounts = [personal, work];

  it("아무것도 고르지 않았으면 null", () => {
    expect(resolveActiveScope(null, null, [ws], [xames], accounts)).toBeNull();
  });

  it("저장소 목록에 없는 경로는 워크스페이스 범위에서 뺀다", () => {
    expect(resolveActiveScope(null, "w1", [ws], [xames], accounts)).toEqual({
      kind: "workspace",
      id: "w1",
      paths: [xames.path],
    });
  });

  it("저장값이 어긋나 둘 다 잡혀 있으면 저장소를 따른다", () => {
    expect(resolveActiveScope(xames.path, "w1", [ws], [xames], accounts)).toEqual({
      kind: "repo",
      path: xames.path,
    });
  });

  it("지워진 워크스페이스를 가리키면 null", () => {
    expect(resolveActiveScope(null, "gone", [ws], [xames], accounts)).toBeNull();
  });

  it("사이드바와 같은 규칙: 계정이 바뀐 저장소는 워크스페이스 범위에서 빠진다", () => {
    // 원격이 없는 저장소는 지정된 계정의 username으로 계정이 정해진다.
    const local = makeRepo("notes", null, { accountId: personal.id });
    const other = makeRepo("dotfiles", "yjun", { accountId: personal.id });
    const personalWs = {
      id: "w2",
      name: "personal",
      accountKey: "yjun",
      repoPaths: [local.path, other.path],
    };
    const before = resolveActiveScope(null, "w2", [personalWs], [local, other], accounts);
    expect(before).toEqual({ kind: "workspace", id: "w2", paths: [local.path, other.path] });

    // 툴바에서 notes의 계정을 mos로 바꿨다. 사이드바는 notes를 mos 아래로 옮긴다.
    const moved = { ...local, accountId: work.id };
    const after = resolveActiveScope(null, "w2", [personalWs], [moved, other], accounts);
    expect(after).toEqual({ kind: "workspace", id: "w2", paths: [other.path] });
    const tree = buildRepoTree({
      repos: [moved, other],
      accounts,
      workspaces: [personalWs],
      orderByParent: {},
      sortModeByAccount: {},
    });
    const wsNode = tree
      .flatMap((a) => a.children)
      .find((n) => n.kind === "workspace" && n.workspace.id === "w2");
    expect(wsNode?.kind === "workspace" && wsNode.repos.map((r) => r.repo.path)).toEqual(
      after?.kind === "workspace" ? after.paths : null,
    );
  });

  it("계정을 아직 모르는 저장소는 사이드바처럼 워크스페이스에 둔다", () => {
    // 계정 목록을 불러오기 전(accounts가 빔)이라 원격 없는 scratch의 계정은 pending이다.
    const localWork = makeRepo("scratch", null, { accountId: work.id });
    const w = { id: "w3", name: "x", accountKey: "mos", repoPaths: [localWork.path] };
    expect(resolveActiveScope(null, "w3", [w], [localWork], [])).toEqual({
      kind: "workspace",
      id: "w3",
      paths: [localWork.path],
    });
  });

  it("같은 저장소가 두 워크스페이스에 적혀 있으면 앞선 워크스페이스에만 든다", () => {
    const first = { id: "a", name: "a", accountKey: "mos", repoPaths: [xames.path] };
    const second = { id: "b", name: "b", accountKey: "mos", repoPaths: [xames.path, xamesApp.path] };
    expect(
      resolveActiveScope(null, "b", [first, second], [xames, xamesApp], accounts),
    ).toEqual({ kind: "workspace", id: "b", paths: [xamesApp.path] });
  });
});

describe("workspaceAccountId", () => {
  const ws = { id: "w1", name: "x", accountKey: "mos", repoPaths: [gitbaro.path, xames.path] };

  it("워크스페이스 계정 키와 이름이 같은 계정이 지정돼 있으면 그 계정", () => {
    expect(workspaceAccountId(ws, [gitbaro, xames], [personal, work])).toBe(work.id);
  });

  it("이름이 같은 계정이 없으면 가장 많은 저장소에 지정된 계정(순서와 상관없이)", () => {
    const org = { ...ws, accountKey: "some-org" };
    const orgRepos = [
      makeRepo("a", "some-org", { accountId: personal.id }),
      makeRepo("b", "some-org", { accountId: work.id }),
      makeRepo("c", "some-org", { accountId: work.id }),
    ];
    expect(workspaceAccountId(org, orgRepos, [personal, work])).toBe(work.id);
    expect(workspaceAccountId(org, [...orgRepos].reverse(), [personal, work])).toBe(work.id);
  });

  it("수가 같으면 워크스페이스에서 먼저 나오는 저장소의 계정", () => {
    const org = { ...ws, accountKey: "some-org" };
    expect(workspaceAccountId(org, [gitbaro, xames], [personal, work])).toBe(personal.id);
  });

  it("로그인하지 않은 계정 id는 세지 않는다", () => {
    const org = { ...ws, accountKey: "some-org" };
    const repos = [
      makeRepo("a", "some-org", { accountId: "logged-out" }),
      makeRepo("b", "some-org", { accountId: "logged-out" }),
      makeRepo("c", "some-org", { accountId: work.id }),
    ];
    expect(workspaceAccountId(org, repos, [personal, work])).toBe(work.id);
  });

  it("지정된 계정이 없으면 null(활성 계정을 바꾸지 않는다)", () => {
    const bare = [makeRepo("xames", "mos")];
    expect(workspaceAccountId({ ...ws, repoPaths: [bare[0].path] }, bare, [work])).toBeNull();
  });
});

describe("workspaceWatchPaths", () => {
  it("저장소와 그 워크트리를 모두 넣는다. 스캔에 없는 저장소는 저장소 경로만", () => {
    const scan = [
      {
        repoPath: xames.path,
        worktrees: [
          { path: xames.path, branch: "main", headOid: "a", isMain: true },
          { path: "/repos/xames/.claude/worktrees/x", branch: "x", headOid: "b", isMain: false },
        ],
      },
    ];
    expect(workspaceWatchPaths([xames.path, xamesApp.path], scan)).toEqual([
      xames.path,
      "/repos/xames/.claude/worktrees/x",
      xamesApp.path,
    ]);
  });
});

describe("저장 형식", () => {
  it("gitbaro-repos v0 값을 기존 값 그대로 복원하고 v0으로 저장한다", async () => {
    const v0 = {
      repos: [xames, gitbaro],
      activeRepoPath: "/repos/xames-wt/feature",
      repoVisibility: { [xames.path]: { isPrivate: true } },
      ownerTypes: { mos: "Organization" },
      collapsedGroups: ["mos"],
      favoriteRepos: [gitbaro.path],
      activeWorktrees: { [xames.path]: "/repos/xames-wt/feature" },
      autoSyncByRepo: { [xames.path]: { mode: "off" } },
    };
    localStorage.setItem(REPOS_STORAGE_KEY, JSON.stringify({ state: v0, version: 0 }));

    await useRepositoryStore.persist.rehydrate();

    const s = useRepositoryStore.getState();
    expect(s.repos).toEqual([xames, gitbaro]);
    expect(s.activeRepoPath).toBe("/repos/xames-wt/feature");
    // 워크트리를 보던 채로 저장됐어도 소유 저장소를 다시 찾는다.
    expect(s.activeRepo?.path).toBe(xames.path);
    expect(s.repoVisibility).toEqual(v0.repoVisibility);
    expect(s.ownerTypes).toEqual(v0.ownerTypes);
    expect(s.collapsedGroups).toEqual(["mos"]);
    expect(s.favoriteRepos).toEqual([gitbaro.path]);
    expect(s.activeWorktrees).toEqual(v0.activeWorktrees);
    expect(s.autoSyncByRepo).toEqual(v0.autoSyncByRepo);

    act(() => useRepositoryStore.getState().toggleFavorite(xames.path));
    const saved = JSON.parse(localStorage.getItem(REPOS_STORAGE_KEY)!);
    expect(saved.version).toBe(REPOS_STORAGE_VERSION);
    // 버전을 올리면 migrate가 없는 이전 빌드가 저장값을 버린다.
    expect(saved.version).toBe(0);
    expect(saved.state.collapsedGroups).toEqual(["mos"]);
  });

  it("잠시 v1로 저장한 값도 버리지 않고 복원한다", async () => {
    const v1 = { repos: [xames, gitbaro], activeRepoPath: gitbaro.path, favoriteRepos: [xames.path] };
    localStorage.setItem(REPOS_STORAGE_KEY, JSON.stringify({ state: v1, version: 1 }));

    await useRepositoryStore.persist.rehydrate();

    const s = useRepositoryStore.getState();
    expect(s.repos).toEqual([xames, gitbaro]);
    expect(s.activeRepoPath).toBe(gitbaro.path);
    expect(s.favoriteRepos).toEqual([xames.path]);
  });

  it("같은 버전의 값에서도 깨진 필드만 버리고 나머지는 복원한다", async () => {
    useRepositoryStore.setState({ favoriteRepos: [], activeWorktrees: {} });
    localStorage.setItem(
      REPOS_STORAGE_KEY,
      JSON.stringify({
        state: { repos: [xames], favoriteRepos: "x", activeWorktrees: { a: "b", c: 1 } },
        version: 0,
      }),
    );

    await useRepositoryStore.persist.rehydrate();

    const s = useRepositoryStore.getState();
    expect(s.repos).toEqual([xames]);
    expect(s.favoriteRepos).toEqual([]);
    expect(s.activeWorktrees).toEqual({ a: "b" });
  });

  it("거르기는 깨진 필드만 버리고 나머지는 그대로 둔다", () => {
    expect(
      sanitizeRepositoryState({
        repos: [xames],
        activeRepoPath: 3,
        favoriteRepos: "x",
        activeWorktrees: { a: "b", c: 1 },
      }),
    ).toEqual({ repos: [xames], activeWorktrees: { a: "b" } });
  });

  it("gitbaro-workspaces v1 값을 v2로 옮기면 선택 없음으로 시작하고 나머지는 살린다", async () => {
    const v1 = {
      workspaces: [{ id: "w1", name: "x", accountKey: "mos", repoPaths: [xames.path] }],
      orderByParent: { "acct:mos": ["ws:w1"] },
      sortModeByAccount: { mos: "todo" },
      collapsed: ["ws:w1"],
      dismissedSuggestions: ["mos/xames"],
    };
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify({ state: v1, version: 1 }));

    await useWorkspaceStore.persist.rehydrate();

    const s = useWorkspaceStore.getState();
    expect(s.activeWorkspaceId).toBeNull();
    expect(s.workspaces).toEqual(v1.workspaces);
    expect(s.orderByParent).toEqual(v1.orderByParent);
    expect(s.sortModeByAccount).toEqual(v1.sortModeByAccount);
    expect(s.collapsed).toEqual(v1.collapsed);
    expect(s.dismissedSuggestions).toEqual(v1.dismissedSuggestions);
    expect(migrateWorkspaceState(v1, 1).activeWorkspaceId).toBeNull();
  });

  it("앱을 다시 켜면 고른 워크스페이스를 복원한다", async () => {
    const id = createWorkspace();
    useWorkspaceStore.getState().setActiveWorkspace(id);
    const saved = localStorage.getItem(WORKSPACES_STORAGE_KEY)!;
    expect(JSON.parse(saved).state.activeWorkspaceId).toBe(id);

    useWorkspaceStore.setState({ activeWorkspaceId: null });
    localStorage.setItem(WORKSPACES_STORAGE_KEY, saved);
    await useWorkspaceStore.persist.rehydrate();

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(id);
    expect(JSON.parse(localStorage.getItem(REPOS_STORAGE_KEY) ?? "null")?.state.activeRepoPath ?? null).toBeNull();
  });

  it("저장된 선택이 없는 워크스페이스를 가리키면 선택 없음으로 복원한다", () => {
    expect(
      migrateWorkspaceState({ workspaces: [], activeWorkspaceId: "gone" }, 2).activeWorkspaceId,
    ).toBeNull();
  });
});

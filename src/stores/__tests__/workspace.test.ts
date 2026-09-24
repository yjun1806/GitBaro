// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRepositoryStore } from "@/stores/repository";
import {
  WORKSPACES_STORAGE_KEY,
  sanitizeWorkspaceState,
  useWorkspaceStore,
} from "@/stores/workspace";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const xames = makeRepo("xames", "mos");
const xamesApp = makeRepo("xames-app", "mos");
const xamesAdmin = makeRepo("xames-admin", "mos");
const gitbaro = makeRepo("GitBaro", "yjun");

const ws = () => useWorkspaceStore.getState();

function createOk(name: string, accountKey: string, paths: string[] = []): string {
  const result = ws().createWorkspace(name, accountKey, paths);
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.id;
}

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRepositoryStore.setState({ repos: [xames, xamesApp, xamesAdmin, gitbaro] });
    useWorkspaceStore.setState({
      workspaces: [],
      orderByParent: {},
      sortModeByAccount: {},
      collapsed: [],
      dismissedSuggestions: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("규칙 강제", () => {
    it("다른 계정의 저장소를 넣으려 하면 거부하고 상태를 바꾸지 않는다", () => {
      const id = createOk("xames", "mos");

      const result = ws().addRepoToWorkspace(id, gitbaro.path);

      expect(result).toEqual({ ok: false, reason: "account-mismatch" });
      expect(ws().workspaces[0].repoPaths).toEqual([]);
    });

    it("다른 계정의 저장소로 워크스페이스를 만들 수 없다", () => {
      const result = ws().createWorkspace("mix", "mos", [xames.path, gitbaro.path]);

      expect(result).toEqual({ ok: false, reason: "account-mismatch" });
      expect(ws().workspaces).toEqual([]);
    });

    it("목록에 없는 저장소와 없는 워크스페이스는 거부한다", () => {
      const id = createOk("xames", "mos");

      expect(ws().addRepoToWorkspace(id, "/repos/nope")).toEqual({
        ok: false,
        reason: "unknown-repo",
      });
      expect(ws().addRepoToWorkspace("nope", xames.path)).toEqual({
        ok: false,
        reason: "unknown-workspace",
      });
    });

    it("빈 이름은 거부한다", () => {
      expect(ws().createWorkspace("  ", "mos")).toEqual({ ok: false, reason: "empty-name" });
      const id = createOk("x", "mos");
      expect(ws().renameWorkspace(id, "")).toEqual({ ok: false, reason: "empty-name" });
    });

    it("저장소는 워크스페이스 하나에만 속한다 — 다른 곳에 넣으면 옮겨 간다", () => {
      const a = createOk("a", "mos", [xames.path, xamesApp.path]);
      const b = createOk("b", "mos");

      expect(ws().addRepoToWorkspace(b, xames.path)).toEqual({ ok: true });

      const byId = Object.fromEntries(ws().workspaces.map((w) => [w.id, w.repoPaths]));
      expect(byId[a]).toEqual([xamesApp.path]);
      expect(byId[b]).toEqual([xames.path]);
    });

    it("새 워크스페이스를 만들 때 이미 다른 워크스페이스에 있던 저장소도 옮겨 온다", () => {
      const a = createOk("a", "mos", [xames.path]);
      const b = createOk("b", "mos", [xames.path, xamesApp.path]);

      const byId = Object.fromEntries(ws().workspaces.map((w) => [w.id, w.repoPaths]));
      expect(byId[a]).toEqual([]);
      expect(byId[b]).toEqual([xames.path, xamesApp.path]);
    });
  });

  describe("순서·정렬·삭제", () => {
    it("index를 주면 워크스페이스 안 그 자리에 넣는다", () => {
      const id = createOk("x", "mos", [xames.path, xamesApp.path]);

      ws().addRepoToWorkspace(id, xamesAdmin.path, 1);

      expect(ws().orderByParent[`ws:${id}`]).toEqual([
        `repo:${xames.path}`,
        `repo:${xamesAdmin.path}`,
        `repo:${xamesApp.path}`,
      ]);
    });

    it("워크스페이스에 넣은 저장소는 계정 순서에서 빠진다", () => {
      ws().setChildOrder("acct:mos", [`repo:${xames.path}`, `repo:${xamesApp.path}`]);
      const id = createOk("x", "mos");

      ws().addRepoToWorkspace(id, xames.path);

      expect(ws().orderByParent["acct:mos"]).toEqual([`repo:${xamesApp.path}`]);
    });

    it("순서를 바꾸면 그 계정의 정렬이 사용자 지정이 된다", () => {
      ws().setSortMode("mos", "name");
      ws().setSortMode("yjun", "name");

      ws().setChildOrder("acct:mos", [`repo:${xamesApp.path}`, `repo:${xames.path}`]);

      expect(ws().sortModeByAccount).toEqual({ mos: "custom", yjun: "name" });
    });

    it("워크스페이스를 지우면 저장소는 계정 아래 그 자리로 돌아가고 저장소 목록은 그대로다", () => {
      const id = createOk("x", "mos", [xamesApp.path, xamesAdmin.path]);
      ws().setChildOrder("acct:mos", [`repo:${xames.path}`, `ws:${id}`]);
      ws().toggleCollapsed(`ws:${id}`);

      expect(ws().deleteWorkspace(id)).toEqual({ ok: true });

      expect(ws().workspaces).toEqual([]);
      expect(ws().orderByParent["acct:mos"]).toEqual([
        `repo:${xames.path}`,
        `repo:${xamesApp.path}`,
        `repo:${xamesAdmin.path}`,
      ]);
      expect(ws().collapsed).toEqual([]);
      expect(useRepositoryStore.getState().repos).toHaveLength(4);
    });

    it("제안을 닫으면 한 번만 기록한다", () => {
      ws().dismissSuggestion("mos/xames");
      ws().dismissSuggestion("mos/xames");

      expect(ws().dismissedSuggestions).toEqual(["mos/xames"]);
    });
  });

  describe("지운 저장소 정리", () => {
    it("저장소를 지우면 워크스페이스·순서·접힘에서도 빠진다", () => {
      const id = createOk("x", "mos", [xames.path, xamesApp.path]);
      ws().setChildOrder(`ws:${id}`, [`repo:${xamesApp.path}`, `repo:${xames.path}`]);
      ws().toggleCollapsed(`repo:${xames.path}`);

      useRepositoryStore.getState().removeRepo(xames.path);

      expect(ws().workspaces[0].repoPaths).toEqual([xamesApp.path]);
      expect(ws().orderByParent[`ws:${id}`]).toEqual([`repo:${xamesApp.path}`]);
      expect(ws().collapsed).toEqual([]);
    });

    it("지웠다가 다시 추가한 저장소는 예전 워크스페이스로 돌아가지 않는다", () => {
      createOk("x", "mos", [xames.path, xamesApp.path]);

      useRepositoryStore.getState().removeRepo(xames.path);
      useRepositoryStore.getState().addRepo(xames);

      expect(ws().workspaces[0].repoPaths).toEqual([xamesApp.path]);
    });

    it("저장소 스토어가 복원되기 전의 빈 repos로는 정리하지 않는다", () => {
      createOk("x", "mos", [xames.path, xamesApp.path]);
      vi.spyOn(useRepositoryStore.persist, "hasHydrated").mockReturnValue(false);

      useRepositoryStore.setState({ repos: [] });

      expect(ws().workspaces[0].repoPaths).toEqual([xames.path, xamesApp.path]);
    });

    it("워크스페이스 스토어가 복원되기 전에도 정리하지 않는다", () => {
      createOk("x", "mos", [xames.path]);
      vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(false);

      useRepositoryStore.setState({ repos: [] });

      expect(ws().workspaces[0].repoPaths).toEqual([xames.path]);
    });
  });

  describe("저장", () => {
    it("저장 키와 버전 1로 기록한다", () => {
      createOk("x", "mos", [xames.path]);

      const saved = JSON.parse(localStorage.getItem(WORKSPACES_STORAGE_KEY)!);
      expect(saved.version).toBe(1);
      expect(saved.state.workspaces[0]).toMatchObject({ name: "x", accountKey: "mos" });
      expect(saved.state).not.toHaveProperty("createWorkspace");
    });

    it("v1 저장값을 복원한다", async () => {
      localStorage.setItem(
        WORKSPACES_STORAGE_KEY,
        JSON.stringify({
          state: {
            workspaces: [{ id: "w1", name: "x", accountKey: "mos", repoPaths: [xames.path] }],
            orderByParent: { "acct:mos": ["ws:w1"] },
            sortModeByAccount: { mos: "todo" },
            collapsed: ["ws:w1"],
            dismissedSuggestions: ["mos/xames"],
          },
          version: 1,
        }),
      );

      await useWorkspaceStore.persist.rehydrate();

      expect(ws().workspaces).toEqual([
        { id: "w1", name: "x", accountKey: "mos", repoPaths: [xames.path] },
      ]);
      expect(ws().sortModeByAccount).toEqual({ mos: "todo" });
      expect(ws().collapsed).toEqual(["ws:w1"]);
    });

    it("깨진 저장값은 옳은 부분만 살린다", () => {
      const result = sanitizeWorkspaceState({
        workspaces: [
          { id: "w1", name: "a", accountKey: "mos", repoPaths: ["/r/1", "/r/2"] },
          { id: "w2", name: "b", accountKey: "mos", repoPaths: ["/r/2", 3] },
          { id: 5 },
        ],
        orderByParent: { "acct:mos": ["ws:w1"], bad: "x" },
        sortModeByAccount: { mos: "name", yjun: "weird" },
        collapsed: "nope",
      });

      expect(result).toEqual({
        workspaces: [
          { id: "w1", name: "a", accountKey: "mos", repoPaths: ["/r/1", "/r/2"] },
          { id: "w2", name: "b", accountKey: "mos", repoPaths: [] },
        ],
        orderByParent: { "acct:mos": ["ws:w1"] },
        sortModeByAccount: { mos: "name" },
        collapsed: [],
        dismissedSuggestions: [],
      });
    });
  });
});

describe("gitbaro-repos 접힘 상태 가져오기", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  const legacy = JSON.stringify({
    state: { repos: [], collapsedGroups: ["mondayoversleepclub", "Local"] },
    version: 0,
  });

  it("새 키가 없고 옛 키가 있으면 collapsedGroups를 acct:<이름>으로 복사한다", async () => {
    localStorage.setItem("gitbaro-repos", legacy);

    const { useWorkspaceStore: fresh } = await import("@/stores/workspace");

    expect(fresh.getState().collapsed).toEqual(["acct:mondayoversleepclub", "acct:Local"]);
    // 원본은 지우지 않는다(RepoListView가 계속 쓴다).
    expect(JSON.parse(localStorage.getItem("gitbaro-repos")!).state.collapsedGroups).toEqual([
      "mondayoversleepclub",
      "Local",
    ]);
  });

  it("새 키에 저장값이 있으면 옛 값을 가져오지 않는다", async () => {
    localStorage.setItem("gitbaro-repos", legacy);
    localStorage.setItem(
      WORKSPACES_STORAGE_KEY,
      JSON.stringify({ state: { collapsed: ["ws:w1"] }, version: 1 }),
    );

    const { useWorkspaceStore: fresh } = await import("@/stores/workspace");

    expect(fresh.getState().collapsed).toEqual(["ws:w1"]);
  });

  it("둘 다 없으면 빈 상태로 시작한다", async () => {
    const { useWorkspaceStore: fresh } = await import("@/stores/workspace");

    expect(fresh.getState().collapsed).toEqual([]);
    expect(fresh.getState().workspaces).toEqual([]);
  });
});

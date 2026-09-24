import { describe, expect, it } from "vitest";
import {
  QUIET_WINDOW_MS,
  buildRepoTree,
  type AccountNode,
  type BuildRepoTreeInput,
  type RepoNode,
  type WorkspaceNode,
} from "@/lib/repo-tree";
import { makeRepo } from "./repo-tree-fixtures";

const NOW = 1_800_000_000_000;

const xames = makeRepo("xames", "mos");
const xamesApp = makeRepo("xames-app", "mos");
const xamesAdmin = makeRepo("xames-admin", "mos");
const gitbaro = makeRepo("GitBaro", "yjun");
const muxa = makeRepo("muxa", "yjun");

function build(overrides: Partial<BuildRepoTreeInput> = {}): AccountNode[] {
  return buildRepoTree({
    repos: [xames, xamesApp, xamesAdmin, gitbaro, muxa],
    accounts: [],
    workspaces: [],
    orderByParent: {},
    sortModeByAccount: {},
    now: NOW,
    ...overrides,
  });
}

const account = (tree: AccountNode[], key: string) => tree.find((a) => a.accountKey === key)!;

/** 자식 노드를 「ws:이름」 또는 저장소 이름으로 나열한다. */
const labels = (nodes: (WorkspaceNode | RepoNode)[]) =>
  nodes.map((n) => (n.kind === "workspace" ? `ws:${n.workspace.name}` : n.repo.name));

describe("buildRepoTree", () => {
  it("계정은 기존 사이드바 그룹(origin owner)과 같은 기준으로 나뉜다", () => {
    const tree = build();

    expect(tree.map((a) => a.key)).toEqual(["acct:mos", "acct:yjun"]);
  });

  it("원격도 계정도 없는 저장소는 Local 계정에 들어간다", () => {
    const tree = build({ repos: [makeRepo("scratch", null)] });

    expect(tree.map((a) => [a.accountKey, a.label])).toEqual([["local", "Local"]]);
  });

  describe("계정 판별", () => {
    const upper = makeRepo("a", "YJun");
    const lowerSsh = makeRepo("b", null, {
      remotes: [{ name: "origin", url: "git@github.com:yjun/b.git" }],
    });

    it("owner 표기의 대소문자가 달라도 한 계정으로 본다", () => {
      const tree = build({
        repos: [upper, lowerSsh],
        workspaces: [{ id: "w1", name: "w", accountKey: "yjun", repoPaths: [upper.path, lowerSsh.path] }],
      });

      expect(tree.map((a) => [a.accountKey, a.label])).toEqual([["yjun", "YJun"]]);
      const ws = tree[0].children[0] as WorkspaceNode;
      expect(ws.repos.map((r) => r.repo.name)).toEqual(["a", "b"]);
    });

    // GitHub 밖 origin(또는 origin 없음) + accountId 저장소는 계정 목록이 있어야 계정을 안다.
    const gitlab = makeRepo("g", null, {
      remotes: [{ name: "origin", url: "https://gitlab.com/yj/g.git" }],
      accountId: "acc1",
    });
    const noOrigin = makeRepo("n", null, { accountId: "acc1" });
    const pendingInput: Partial<BuildRepoTreeInput> = {
      repos: [gitlab, noOrigin],
      workspaces: [{ id: "w", name: "w", accountKey: "yj", repoPaths: [gitlab.path, noOrigin.path] }],
    };
    const shape = (tree: AccountNode[]) =>
      tree.map((a) => [
        a.accountKey,
        a.children.map((c) =>
          c.kind === "workspace" ? [c.key, c.repos.map((r) => r.repo.name)] : c.repo.name,
        ),
      ]);

    it("계정 목록을 불러오기 전에도 워크스페이스 소속을 그대로 보여 준다", () => {
      const before = build({ ...pendingInput, accounts: [] });
      const after = build({ ...pendingInput, accounts: [{ id: "acc1", username: "yj" }] });

      expect(shape(before)).toEqual([["yj", [["ws:w", ["g", "n"]]]]]);
      expect(shape(after)).toEqual(shape(before));
    });

    it("계정 목록에 없는 accountId 저장소가 워크스페이스 밖이면 기존처럼 Other에 둔다", () => {
      const tree = build({ repos: [noOrigin], accounts: [] });

      expect(tree.map((a) => [a.accountKey, a.label])).toEqual([["other", "Other"]]);
    });
  });

  it("워크스페이스에 넣지 않은 저장소는 계정 바로 아래에 온다", () => {
    const tree = build({
      workspaces: [
        { id: "w1", name: "xames", accountKey: "mos", repoPaths: [xamesApp.path, xamesAdmin.path] },
      ],
    });
    const mos = account(tree, "mos");

    expect(labels(mos.children)).toEqual(["ws:xames", "xames"]);
    const ws = mos.children[0] as WorkspaceNode;
    expect(ws.repos.map((r) => r.repo.name)).toEqual(["xames-app", "xames-admin"]);
  });

  it("저장소 목록에 없는 경로는 워크스페이스에 남아 있어도 무시한다", () => {
    const tree = build({
      workspaces: [
        { id: "w1", name: "xames", accountKey: "mos", repoPaths: ["/repos/gone", xamesApp.path] },
      ],
    });
    const ws = account(tree, "mos").children[0] as WorkspaceNode;

    expect(ws.repos.map((r) => r.repo.path)).toEqual([xamesApp.path]);
  });

  it("계정이 바뀐 저장소는 워크스페이스 밖, 자기 계정 아래에 둔다", () => {
    const tree = build({
      workspaces: [{ id: "w1", name: "mix", accountKey: "mos", repoPaths: [gitbaro.path] }],
    });

    expect((account(tree, "mos").children[0] as WorkspaceNode).repos).toEqual([]);
    expect(labels(account(tree, "yjun").children)).toContain("GitBaro");
  });

  it("저장소가 없는 계정의 빈 워크스페이스도 사라지지 않는다", () => {
    const tree = build({
      workspaces: [{ id: "w9", name: "empty", accountKey: "org9", repoPaths: [] }],
    });

    expect(labels(account(tree, "org9").children)).toEqual(["ws:empty"]);
  });

  it("브랜치 이름이 같아도 저장소를 묶지 않는다", () => {
    const a = makeRepo("a", "mos", { currentBranch: "feat/x" });
    const b = makeRepo("b", "mos", { currentBranch: "feat/x" });
    const tree = build({ repos: [a, b] });

    expect(labels(account(tree, "mos").children)).toEqual(["a", "b"]);
  });

  it("워크트리는 저장소 아래에 붙는다", () => {
    const tree = build({
      worktreesByRepo: { [gitbaro.path]: [{ path: "/wt/fix", branch: "fix/audit" }] },
    });
    const repo = account(tree, "yjun").children.find(
      (n): n is RepoNode => n.kind === "repo" && n.repo.name === "GitBaro",
    )!;

    expect(repo.worktrees).toEqual([
      { kind: "worktree", key: "wt:/wt/fix", path: "/wt/fix", branch: "fix/audit" },
    ]);
  });

  describe("정렬", () => {
    const workspaces = [
      { id: "w1", name: "beta", accountKey: "mos", repoPaths: [xamesAdmin.path] },
    ];

    it("custom: 저장된 순서가 먼저, 저장되지 않은 노드는 뒤에 입력 순서로 붙는다", () => {
      const tree = build({
        workspaces,
        orderByParent: { "acct:mos": [`repo:${xamesApp.path}`, "ws:w1"] },
        sortModeByAccount: { mos: "custom" },
      });

      expect(labels(account(tree, "mos").children)).toEqual(["xames-app", "ws:beta", "xames"]);
    });

    it("custom: 워크스페이스 안 순서도 따로 저장한다", () => {
      const tree = build({
        workspaces: [
          { id: "w1", name: "x", accountKey: "mos", repoPaths: [xames.path, xamesApp.path] },
        ],
        orderByParent: { "ws:w1": [`repo:${xamesApp.path}`, `repo:${xames.path}`] },
      });
      const ws = account(tree, "mos").children[0] as WorkspaceNode;

      expect(ws.repos.map((r) => r.repo.name)).toEqual(["xames-app", "xames"]);
    });

    it("name: 워크스페이스와 저장소를 이름순으로 섞어 정렬한다", () => {
      const tree = build({ workspaces, sortModeByAccount: { mos: "name" } });

      expect(labels(account(tree, "mos").children)).toEqual(["ws:beta", "xames", "xames-app"]);
    });

    it("recent: 마지막 파일 변경이 늦은 순, 기록 없는 것은 뒤로", () => {
      const tree = build({
        workspaces,
        sortModeByAccount: { mos: "recent" },
        signals: {
          [xames.path]: { lastChangedAt: NOW - 5_000 },
          [xamesAdmin.path]: { lastChangedAt: NOW - 1_000 },
        },
      });

      expect(labels(account(tree, "mos").children)).toEqual(["ws:beta", "xames", "xames-app"]);
    });

    it("todo: 할 일이 있는 것 먼저, 그 안에서는 이름순", () => {
      const tree = build({
        workspaces,
        sortModeByAccount: { mos: "todo" },
        signals: {
          [xamesApp.path]: { dirtyCount: 2 },
          [xames.path]: { behind: 1 },
        },
      });

      expect(labels(account(tree, "mos").children)).toEqual(["xames", "xames-app", "ws:beta"]);
    });

    it("todo: 워크트리의 새 커밋도 저장소의 할 일로 센다", () => {
      const tree = build({
        repos: [xames, xamesApp],
        sortModeByAccount: { mos: "todo" },
        worktreesByRepo: { [xamesApp.path]: [{ path: "/wt/a", branch: "feat/a" }] },
        signals: { "/wt/a": { newCommits: 3 } },
      });

      expect(labels(account(tree, "mos").children)).toEqual(["xames-app", "xames"]);
    });

    it("정렬 방식은 계정마다 따로 적용된다", () => {
      const tree = build({ sortModeByAccount: { yjun: "name" } });

      expect(labels(account(tree, "yjun").children)).toEqual(["GitBaro", "muxa"]);
      expect(account(tree, "mos").sortMode).toBe("custom");
    });
  });

  describe("조용한 저장소", () => {
    const quiet = { dirtyCount: 0, newCommits: 0, ahead: 0, behind: 0, lastChangedAt: null };

    it("표시가 모두 0이고 10분 안 변경이 없으면 조용한 저장소로 뺀다", () => {
      const tree = build({
        signals: {
          [muxa.path]: quiet,
          [gitbaro.path]: { ...quiet, lastChangedAt: NOW - QUIET_WINDOW_MS - 1 },
        },
      });
      const yjun = account(tree, "yjun");

      expect(labels(yjun.children)).toEqual([]);
      expect(yjun.quietRepos.map((r) => r.repo.name)).toEqual(["GitBaro", "muxa"]);
    });

    it("10분 안에 바뀌었거나 표시가 하나라도 있으면 조용하지 않다", () => {
      const tree = build({
        signals: {
          [muxa.path]: { ...quiet, lastChangedAt: NOW - 60_000 },
          [gitbaro.path]: { ...quiet, ahead: 1 },
        },
      });

      expect(account(tree, "yjun").quietRepos).toEqual([]);
    });

    it("신호를 아직 받지 못한 저장소는 숨기지 않는다", () => {
      expect(account(build(), "yjun").quietRepos).toEqual([]);
    });

    it("워크트리에 할 일이 있으면 저장소는 조용하지 않다", () => {
      const tree = build({
        worktreesByRepo: { [muxa.path]: [{ path: "/wt/m", branch: "b" }] },
        signals: { [muxa.path]: quiet, "/wt/m": { dirtyCount: 1 } },
      });

      expect(account(tree, "yjun").quietRepos).toEqual([]);
    });

    it("워크스페이스 안 저장소는 조용해도 빼지 않는다", () => {
      const tree = build({
        workspaces: [{ id: "w1", name: "x", accountKey: "yjun", repoPaths: [muxa.path] }],
        signals: { [muxa.path]: quiet },
      });
      const yjun = account(tree, "yjun");

      expect((yjun.children[0] as WorkspaceNode).repos.map((r) => r.repo.name)).toEqual(["muxa"]);
      expect(yjun.quietRepos).toEqual([]);
    });
  });
});

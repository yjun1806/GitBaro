// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";
import { buildRepoTree, repoNodeKey, workspaceNodeKey } from "@/lib/repo-tree";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { applyDrop, planDrop, zoneFor, type DropZone } from "../tree-dnd";

const alpha = makeRepo("alpha", "mos");
const beta = makeRepo("beta", "mos");
const gamma = makeRepo("gamma", "mos");
const delta = makeRepo("delta", "mos");
const mine = makeRepo("mine", "yjun");

const ACCT = "acct:mos";
const ws = () => useWorkspaceStore.getState();
const key = (r: { path: string }) => repoNodeKey(r.path);

/** 지금 스토어 상태로 사이드바가 그리는 트리. */
function currentTree() {
  const s = ws();
  return buildRepoTree({
    repos: useRepositoryStore.getState().repos,
    accounts: [],
    workspaces: s.workspaces,
    orderByParent: s.orderByParent,
    sortModeByAccount: s.sortModeByAccount,
  });
}

/** 끌어서 놓기 한 번: 지금 트리로 계산하고 스토어에 쓴다. */
function drop(activeKey: string, overKey: string, zone: DropZone) {
  const plan = planDrop(currentTree(), activeKey, overKey, zone);
  return { plan, result: plan ? applyDrop(plan) : null };
}

/** 계정 바로 아래에 보이는 형제 키 순서. */
function accountChildren(account = "mos"): string[] {
  const node = currentTree().find((a) => a.accountKey === account)!;
  return [...node.children, ...node.quietRepos].map((c) => c.key);
}

function workspaceRepos(id: string): string[] {
  return ws().workspaces.find((w) => w.id === id)!.repoPaths;
}

function createWorkspace(name: string, paths: string[]): string {
  const result = ws().createWorkspace(name, "mos", paths);
  if (!result.ok) throw new Error(result.reason);
  return result.id;
}

beforeEach(() => {
  localStorage.clear();
  useAccountStore.setState({ accounts: [] });
  useRepositoryStore.setState({ repos: [alpha, beta, gamma, delta, mine] });
  useWorkspaceStore.setState({
    workspaces: [],
    orderByParent: {},
    sortModeByAccount: {},
    collapsed: [],
    dismissedSuggestions: [],
  });
});

describe("zoneFor", () => {
  it("저장소를 워크스페이스 행에 올리면 위 1/4은 앞, 나머지는 안으로 넣는다", () => {
    expect(zoneFor("repo", "workspace", 0.1, true)).toBe("before");
    expect(zoneFor("repo", "workspace", 0.5, true)).toBe("into");
    expect(zoneFor("repo", "workspace", 0.9, true)).toBe("into");
  });

  it("접힌 워크스페이스는 아래 1/4에 놓으면 뒤에 둔다", () => {
    expect(zoneFor("repo", "workspace", 0.9, false)).toBe("after");
  });

  it("그 밖에는 위 절반이 앞, 아래 절반이 뒤다", () => {
    expect(zoneFor("repo", "repo", 0.3, false)).toBe("before");
    expect(zoneFor("repo", "repo", 0.7, false)).toBe("after");
    expect(zoneFor("workspace", "workspace", 0.5, false)).toBe("after");
  });
});

describe("끌어서 순서 바꾸기", () => {
  it("계정 아래 저장소 순서를 orderByParent에 저장하고 정렬을 「사용자 지정」으로 바꾼다", () => {
    ws().setSortMode("mos", "name");

    const { result } = drop(key(delta), key(alpha), "before");

    expect(result).toEqual({ ok: true });
    expect(ws().orderByParent[ACCT]).toEqual([key(delta), key(alpha), key(beta), key(gamma)]);
    expect(ws().sortModeByAccount.mos).toBe("custom");
    expect(accountChildren()).toEqual([key(delta), key(alpha), key(beta), key(gamma)]);
  });

  it("이름순으로 보던 순서에서 출발해, 보이던 그대로 한 칸만 바뀐다", () => {
    // 저장된 사용자 순서는 gamma가 맨 앞이지만 화면은 이름순이다.
    ws().setChildOrder(ACCT, [key(gamma), key(beta), key(alpha), key(delta)]);
    ws().setSortMode("mos", "name");

    drop(key(alpha), key(beta), "after");

    // 이름순 화면: alpha, beta, delta, gamma
    expect(ws().orderByParent[ACCT]).toEqual([key(beta), key(alpha), key(delta), key(gamma)]);
  });

  it("워크스페이스 행도 계정 안에서 순서를 바꾼다", () => {
    const id = createWorkspace("pair", [beta.path]);
    const wsKey = workspaceNodeKey(id);
    expect(accountChildren()[0]).toBe(wsKey);

    drop(wsKey, key(gamma), "after");

    expect(ws().orderByParent[ACCT]).toEqual([key(alpha), key(gamma), wsKey, key(delta)]);
    expect(ws().sortModeByAccount.mos).toBe("custom");
  });

  it("제자리에 놓으면 아무것도 바꾸지 않는다", () => {
    expect(planDrop(currentTree(), key(alpha), key(beta), "before")).toBeNull();
    expect(planDrop(currentTree(), key(alpha), key(alpha), "after")).toBeNull();
    expect(ws().sortModeByAccount).toEqual({});
  });

  it("워크스페이스 안 저장소 순서는 그 워크스페이스 키로 저장한다", () => {
    const id = createWorkspace("pair", [alpha.path, beta.path, gamma.path]);

    drop(key(gamma), key(alpha), "before");

    expect(ws().orderByParent[workspaceNodeKey(id)]).toEqual([key(gamma), key(alpha), key(beta)]);
    expect(workspaceRepos(id)).toEqual([alpha.path, beta.path, gamma.path]);
    expect(ws().sortModeByAccount.mos).toBe("custom");
  });
});

describe("워크스페이스로 넣기·빼기", () => {
  it("워크스페이스 행 위에 놓으면 그 워크스페이스 끝에 들어가고 계정 순서에서 빠진다", () => {
    const id = createWorkspace("pair", [alpha.path]);
    ws().setChildOrder(ACCT, [workspaceNodeKey(id), key(delta), key(beta), key(gamma)]);

    const { plan, result } = drop(key(delta), workspaceNodeKey(id), "into");

    expect(plan).toEqual({ type: "into", workspaceId: id, repoPath: delta.path });
    expect(result).toEqual({ ok: true });
    expect(workspaceRepos(id)).toEqual([alpha.path, delta.path]);
    expect(ws().orderByParent[ACCT]).toEqual([workspaceNodeKey(id), key(beta), key(gamma)]);
  });

  it("이미 들어 있는 워크스페이스 위에 놓으면 아무것도 하지 않는다", () => {
    const id = createWorkspace("pair", [alpha.path]);
    expect(planDrop(currentTree(), key(alpha), workspaceNodeKey(id), "into")).toBeNull();
  });

  it("워크스페이스 안 저장소 사이에 놓으면 그 자리에 들어간다", () => {
    const id = createWorkspace("pair", [alpha.path, beta.path]);

    drop(key(delta), key(beta), "before");

    expect(workspaceRepos(id)).toEqual([alpha.path, delta.path, beta.path]);
    expect(ws().orderByParent[workspaceNodeKey(id)]).toEqual([key(alpha), key(delta), key(beta)]);
    expect(accountChildren()).toEqual([workspaceNodeKey(id), key(gamma)]);
  });

  it("워크스페이스의 저장소를 계정 아래 저장소 사이에 놓으면 워크스페이스에서 빠진다", () => {
    const id = createWorkspace("pair", [alpha.path, beta.path]);

    drop(key(beta), key(delta), "before");

    expect(workspaceRepos(id)).toEqual([alpha.path]);
    expect(ws().orderByParent[ACCT]).toEqual([
      workspaceNodeKey(id),
      key(gamma),
      key(beta),
      key(delta),
    ]);
    expect(accountChildren()).toEqual([workspaceNodeKey(id), key(gamma), key(beta), key(delta)]);
  });

  it("다른 워크스페이스로 옮기면 원래 워크스페이스에서 빠진다", () => {
    const from = createWorkspace("from", [alpha.path, beta.path]);
    const to = createWorkspace("to", [gamma.path]);

    drop(key(beta), workspaceNodeKey(to), "into");

    expect(workspaceRepos(from)).toEqual([alpha.path]);
    expect(workspaceRepos(to)).toEqual([gamma.path, beta.path]);
  });
});

describe("다른 계정", () => {
  it("다른 계정의 워크스페이스 위에는 놓을 수 없고 스토어를 바꾸지 않는다", () => {
    const id = createWorkspace("pair", [alpha.path]);
    const before = { ...ws() };

    const { plan, result } = drop(key(mine), workspaceNodeKey(id), "into");

    expect(plan).toEqual({ type: "blocked" });
    expect(result).toEqual({ ok: false, reason: "account-mismatch" });
    expect(ws().workspaces).toBe(before.workspaces);
    expect(ws().orderByParent).toBe(before.orderByParent);
  });

  it("다른 계정의 저장소 사이에도 놓을 수 없다", () => {
    expect(planDrop(currentTree(), key(mine), key(alpha), "before")).toEqual({ type: "blocked" });
  });

  it("워크스페이스를 워크스페이스 안으로 넣지 않는다", () => {
    const outer = createWorkspace("outer", [alpha.path]);
    const inner = createWorkspace("inner", [beta.path]);
    expect(planDrop(currentTree(), workspaceNodeKey(inner), key(alpha), "before")).toBeNull();
    expect(
      planDrop(currentTree(), workspaceNodeKey(inner), workspaceNodeKey(outer), "into"),
    ).toBeNull();
  });
});

import type { AccountNode, WorkspaceNode } from "@/lib/repo-tree";
import { useWorkspaceStore, type WorkspaceResult } from "@/stores/workspace";

/**
 * 사이드바 트리의 끌어서 놓기 규칙(순수 함수)과, 결정된 결과를 스토어에 쓰는 함수.
 *
 * - 끌 수 있는 것: 저장소 행, 워크스페이스 행. 워크트리는 git이 정하므로 끌지 않는다.
 * - 저장소를 워크스페이스 행 위에 놓으면 그 워크스페이스에 들어간다.
 * - 다른 계정의 행 위에는 놓을 수 없다(워크스페이스는 한 계정 안에만 있다).
 * - 행 사이에 놓으면 그 부모(계정 또는 워크스페이스)의 순서를 저장한다. 순서는 지금 화면에
 *   보이는 순서에서 출발하므로, 이름순 등으로 보고 있었어도 보이던 그대로 이어서 바뀐다.
 *   순서를 저장하면 그 계정의 정렬은 「사용자 지정」이 된다(`setChildOrder`).
 */

export type DragKind = "repo" | "workspace";
export type DropZone = "before" | "after" | "into";

interface NodeLocation {
  kind: DragKind;
  key: string;
  accountKey: string;
  /** 부모 노드 키(`acct:<계정>` 또는 `ws:<id>`) */
  parentKey: string;
  /** 부모 아래 형제 키, 지금 보이는 순서대로 */
  siblings: string[];
  repoPath?: string;
  workspaceId?: string;
}

export type DropPlan =
  /** 저장소를 워크스페이스 행 위에 놓아 그 워크스페이스 끝에 넣는다. */
  | { type: "into"; workspaceId: string; repoPath: string }
  /** 형제 순서를 바꾼다. `move`가 있으면 먼저 저장소의 소속을 옮긴다. */
  | {
      type: "reorder";
      parentKey: string;
      order: string[];
      move?:
        | {
            to: "workspace";
            workspaceId: string;
            repoPath: string;
            index: number;
          }
        | { to: "account"; repoPath: string };
    }
  /** 다른 계정의 행 위라 놓을 수 없다. */
  | { type: "blocked" };

/** 계정 아래 형제: 워크스페이스와 저장소, 그 뒤에 「조용한 저장소」 줄의 저장소. */
function accountSiblings(account: AccountNode): string[] {
  return [...account.children.map((c) => c.key), ...account.quietRepos.map((r) => r.key)];
}

function workspaceLocation(account: AccountNode, ws: WorkspaceNode, siblings: string[]) {
  return {
    kind: "workspace" as const,
    key: ws.key,
    accountKey: account.accountKey,
    parentKey: account.key,
    siblings,
    workspaceId: ws.workspace.id,
  };
}

/** 트리에서 노드(저장소·워크스페이스)의 자리를 찾는다. 없으면 null. */
export function locateNode(tree: AccountNode[], key: string): NodeLocation | null {
  for (const account of tree) {
    const siblings = accountSiblings(account);
    for (const child of [...account.children, ...account.quietRepos]) {
      if (child.kind === "workspace") {
        if (child.key === key) return workspaceLocation(account, child, siblings);
        const repo = child.repos.find((r) => r.key === key);
        if (repo) {
          return {
            kind: "repo",
            key,
            accountKey: account.accountKey,
            parentKey: child.key,
            siblings: child.repos.map((r) => r.key),
            repoPath: repo.repo.path,
          };
        }
      } else if (child.key === key) {
        return {
          kind: "repo",
          key,
          accountKey: account.accountKey,
          parentKey: account.key,
          siblings,
          repoPath: child.repo.path,
        };
      }
    }
  }
  return null;
}

/**
 * 포인터가 놓을 행의 어디쯤 있는지로 놓는 방식을 정한다.
 * `ratio`는 행 위쪽 0 ~ 아래쪽 1.
 * - 저장소를 워크스페이스 행에: 위 1/4은 앞, 접힌 워크스페이스의 아래 1/4은 뒤, 나머지는 안으로.
 *   펼친 워크스페이스는 바로 아래가 그 안의 첫 저장소이므로 「뒤」를 두지 않는다.
 * - 그 밖: 위 절반은 앞, 아래 절반은 뒤.
 */
export function zoneFor(
  activeKind: DragKind,
  overKind: DragKind,
  ratio: number,
  overExpanded: boolean,
): DropZone {
  if (activeKind === "repo" && overKind === "workspace") {
    if (ratio < 0.25) return "before";
    if (!overExpanded && ratio > 0.75) return "after";
    return "into";
  }
  return ratio < 0.5 ? "before" : "after";
}

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** 놓은 결과를 계산한다. 아무것도 바뀌지 않으면 null. */
export function planDrop(
  tree: AccountNode[],
  activeKey: string,
  overKey: string,
  zone: DropZone,
): DropPlan | null {
  if (activeKey === overKey) return null;
  const active = locateNode(tree, activeKey);
  const over = locateNode(tree, overKey);
  if (!active || !over) return null;
  if (active.accountKey !== over.accountKey) return { type: "blocked" };

  if (zone === "into") {
    if (active.kind !== "repo" || over.kind !== "workspace" || !over.workspaceId) return null;
    if (active.parentKey === over.key) return null;
    return {
      type: "into",
      workspaceId: over.workspaceId,
      repoPath: active.repoPath!,
    };
  }

  // 워크스페이스는 계정 바로 아래에서만 순서를 바꾼다(워크스페이스 안에 워크스페이스는 없다).
  if (active.kind === "workspace" && over.parentKey !== active.parentKey) return null;

  const rest = over.siblings.filter((k) => k !== active.key);
  const at = rest.indexOf(over.key) + (zone === "after" ? 1 : 0);
  const order = [...rest.slice(0, at), active.key, ...rest.slice(at)];

  if (over.parentKey === active.parentKey) {
    return sameOrder(order, active.siblings)
      ? null
      : { type: "reorder", parentKey: over.parentKey, order };
  }

  const repoPath = active.repoPath!;
  const targetWorkspace = over.parentKey.startsWith("ws:")
    ? over.parentKey.slice("ws:".length)
    : null;
  return {
    type: "reorder",
    parentKey: over.parentKey,
    order,
    move: targetWorkspace
      ? { to: "workspace", workspaceId: targetWorkspace, repoPath, index: at }
      : { to: "account", repoPath },
  };
}

/**
 * 계산한 결과를 워크스페이스 스토어에 쓴다. 스토어가 거부하면(계정을 아직 모름 등)
 * 아무것도 바꾸지 않고 그 이유를 돌려준다.
 */
export function applyDrop(plan: DropPlan): WorkspaceResult {
  const store = useWorkspaceStore.getState();
  switch (plan.type) {
    case "blocked":
      return { ok: false, reason: "account-mismatch" };
    case "into":
      return store.addRepoToWorkspace(plan.workspaceId, plan.repoPath);
    case "reorder": {
      if (plan.move?.to === "workspace") {
        const result = store.addRepoToWorkspace(
          plan.move.workspaceId,
          plan.move.repoPath,
          plan.move.index,
        );
        if (!result.ok) return result;
      } else if (plan.move?.to === "account") {
        store.removeRepoFromWorkspace(plan.move.repoPath);
      }
      useWorkspaceStore.getState().setChildOrder(plan.parentKey, plan.order);
      return { ok: true };
    }
  }
}

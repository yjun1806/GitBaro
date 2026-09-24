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
 *   순서를 저장하면 그 계정의 정렬은 「사용자 지정」이 된다(`setChildOrder`). 그래서 이름순 등으로
 *   보고 있었다면 같은 계정의 다른 부모(계정 바로 아래, 다른 워크스페이스)도 지금 보이는 순서를
 *   함께 저장해, 건드리지 않은 목록이 예전에 저장한 순서로 돌아가지 않게 한다.
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
      /**
       * 같은 계정의 다른 부모마다 지금 보이는 순서. 계정 정렬이 「사용자 지정」이 아닐 때만 있다.
       * 정렬이 바뀌어도 이 목록들이 보이던 그대로 남게 한다.
       */
      keepOrders?: Record<string, string[]>;
      move?:
        | {
            to: "workspace";
            workspaceId: string;
            repoPath: string;
            index: number;
          }
        | { to: "account"; repoPath: string };
    }
  /**
   * 놓을 수 없다: 다른 계정의 행 위(`reason` 없음)거나, 계정을 아직 모르는 임시 그룹
   * (`reason: "account-pending"`, `AccountHeader`가 정렬 메뉴를 숨기는 그 그룹) 안이다.
   */
  | { type: "blocked"; reason?: "account-pending" };

/** 계정 아래 형제: 워크스페이스와 저장소, 그 뒤에 「조용한 저장소」 줄의 저장소. */
function accountSiblings(account: AccountNode): string[] {
  return [...account.children.map((c) => c.key), ...account.quietRepos.map((r) => r.key)];
}

/**
 * 계정 안 모든 부모(계정 바로 아래와 각 워크스페이스)의 지금 보이는 순서.
 * 옮기는 노드(`exclude`)와 `skipParent`는 뺀다.
 */
function visibleOrders(
  account: AccountNode,
  exclude: string,
  skipParent: string,
): Record<string, string[]> {
  const parents: [string, string[]][] = [
    [account.key, accountSiblings(account)],
    ...account.children
      .filter((c): c is WorkspaceNode => c.kind === "workspace")
      .map((w): [string, string[]] => [w.key, w.repos.map((r) => r.key)]),
  ];
  return Object.fromEntries(
    parents
      .filter(([key]) => key !== skipParent)
      .map(([key, keys]) => [key, keys.filter((k) => k !== exclude)]),
  );
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
 * - 저장소를 워크스페이스 행에: 위 1/4은 앞, 아래 1/4은 뒤, 나머지는 안으로.
 *   펼친 워크스페이스의 「뒤」는 그 안의 저장소들 다음이다(표시선도 거기에 그린다).
 * - 그 밖: 위 절반은 앞, 아래 절반은 뒤.
 */
export function zoneFor(activeKind: DragKind, overKind: DragKind, ratio: number): DropZone {
  if (activeKind === "repo" && overKind === "workspace") {
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "into";
  }
  return ratio < 0.5 ? "before" : "after";
}

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * 저장소 노드가 계정 바로 아래에서 어느 무리(활성/조용함)에 있는지. 워크스페이스 노드나
 * 없는 키는 null(무리 구분이 없어 다른 검사에 걸리지 않는다).
 */
function repoGroup(tree: AccountNode[], key: string): "active" | "quiet" | null {
  for (const account of tree) {
    if (account.quietRepos.some((r) => r.key === key)) return "quiet";
    for (const child of account.children) {
      if (child.kind === "repo" && child.key === key) return "active";
    }
  }
  return null;
}

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

  const activeAccount = tree.find((a) => a.accountKey === active.accountKey);
  if (activeAccount?.pending) return { type: "blocked", reason: "account-pending" };

  // 「조용한 저장소」 무리는 활동으로 자동 정해진다(끌어서 옮기지 않는다). 활성 저장소를
  // 조용한 저장소 줄 안에 놓거나 그 반대로 놓으면, 놓아도 그 자리로 가지 않아 표시선이
  // 거짓말을 하게 되므로 아예 표시선을 보이지 않는다(`indicatorOf`가 null plan은 그린다).
  if (zone !== "into") {
    const activeGroup = repoGroup(tree, active.key);
    const overGroup = repoGroup(tree, over.key);
    if (activeGroup && overGroup && activeGroup !== overGroup) return null;
  }

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

  const account = tree.find((a) => a.accountKey === over.accountKey);
  const keepOrders =
    account && account.sortMode !== "custom"
      ? { keepOrders: visibleOrders(account, active.key, over.parentKey) }
      : {};

  if (over.parentKey === active.parentKey) {
    return sameOrder(order, active.siblings)
      ? null
      : { type: "reorder", parentKey: over.parentKey, order, ...keepOrders };
  }

  const repoPath = active.repoPath!;
  const targetWorkspace = over.parentKey.startsWith("ws:")
    ? over.parentKey.slice("ws:".length)
    : null;
  return {
    type: "reorder",
    parentKey: over.parentKey,
    order,
    ...keepOrders,
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
      return { ok: false, reason: plan.reason ?? "account-mismatch" };
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
      const { setChildOrder } = useWorkspaceStore.getState();
      Object.entries(plan.keepOrders ?? {}).forEach(([parentKey, order]) =>
        setChildOrder(parentKey, order),
      );
      setChildOrder(plan.parentKey, plan.order);
      return { ok: true };
    }
  }
}

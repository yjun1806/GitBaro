import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import {
  SORT_MODES,
  accountKeysByPath,
  accountNodeKey,
  repoNodeKey,
  workspaceNodeKey,
  type SortMode,
  type Workspace,
} from "@/lib/repo-tree";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";

/**
 * 사이드바 트리의 앱 전용 상태: 워크스페이스, 형제 순서, 계정별 정렬, 접힘, 닫은 제안.
 *
 * 규칙(액션에서 강제한다):
 * - 워크스페이스는 한 계정 안에만 있다. 다른 계정의 저장소는 넣을 수 없다.
 * - 저장소는 워크스페이스 하나에만 속한다. 다른 워크스페이스에 넣으면 옮겨 간다.
 *
 * 노드 키 형식: `acct:<계정>`, `ws:<id>`, `repo:<경로>` (`@/lib/repo-tree`).
 */

export const WORKSPACES_STORAGE_KEY = "gitbaro-workspaces";
export const WORKSPACES_STORAGE_VERSION = 1;
/** 접힘 상태를 처음 한 번 가져오는 옛 저장 키(`src/stores/repository.ts`). */
export const LEGACY_REPOS_STORAGE_KEY = "gitbaro-repos";

export type WorkspaceError =
  | "unknown-workspace"
  | "unknown-repo"
  | "account-mismatch"
  | "empty-name";

export type WorkspaceResult = { ok: true } | { ok: false; reason: WorkspaceError };
export type CreateWorkspaceResult =
  | { ok: true; id: string }
  | { ok: false; reason: WorkspaceError };

export interface WorkspacePersistedState {
  workspaces: Workspace[];
  orderByParent: Record<string, string[]>;
  sortModeByAccount: Record<string, SortMode>;
  collapsed: string[];
  dismissedSuggestions: string[];
}

interface WorkspaceActions {
  /** 워크스페이스를 만든다. 저장소는 모두 `accountKey` 계정이어야 한다. */
  createWorkspace: (name: string, accountKey: string, repoPaths?: string[]) => CreateWorkspaceResult;
  renameWorkspace: (id: string, name: string) => WorkspaceResult;
  /** 워크스페이스만 지운다. 저장소는 계정 바로 아래, 워크스페이스가 있던 자리로 돌아간다. */
  deleteWorkspace: (id: string) => WorkspaceResult;
  /** 저장소를 워크스페이스에 넣는다. 다른 워크스페이스에 있었다면 옮긴다. */
  addRepoToWorkspace: (id: string, repoPath: string, index?: number) => WorkspaceResult;
  /** 저장소를 워크스페이스에서 빼서 계정 바로 아래로 되돌린다. */
  removeRepoFromWorkspace: (repoPath: string) => void;
  /** 형제 순서를 저장하고, 그 계정의 정렬을 「사용자 지정」으로 바꾼다. */
  setChildOrder: (parentKey: string, childKeys: string[]) => void;
  setSortMode: (accountKey: string, mode: SortMode) => void;
  toggleCollapsed: (key: string) => void;
  /** 접힌 노드 목록을 통째로 바꾼다(모두 접기·모두 펼치기). */
  setCollapsed: (keys: string[]) => void;
  dismissSuggestion: (key: string) => void;
  /** 저장소 목록에서 지운 저장소를 워크스페이스·순서·접힘에서 뺀다. */
  forgetRepos: (repoPaths: string[]) => void;
}

export type WorkspaceState = WorkspacePersistedState & WorkspaceActions;

const EMPTY_STATE: WorkspacePersistedState = {
  workspaces: [],
  orderByParent: {},
  sortModeByAccount: {},
  collapsed: [],
  dismissedSuggestions: [],
};

// ───────────────────────── 저장값 검증

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function sanitizeWorkspaces(v: unknown): Workspace[] {
  if (!Array.isArray(v)) return [];
  const seenRepos = new Set<string>();
  return v.flatMap((w): Workspace[] => {
    if (!isRecord(w)) return [];
    const { id, name, accountKey, repoPaths } = w;
    if (typeof id !== "string" || typeof name !== "string" || typeof accountKey !== "string") {
      return [];
    }
    // 저장값이 깨져 한 저장소가 두 곳에 있으면 처음 것만 남긴다.
    const paths = (isStringArray(repoPaths) ? repoPaths : []).filter((p) => {
      if (seenRepos.has(p)) return false;
      seenRepos.add(p);
      return true;
    });
    return [{ id, name, accountKey, repoPaths: paths }];
  });
}

function sanitizeOrder(v: unknown): Record<string, string[]> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter((entry): entry is [string, string[]] => isStringArray(entry[1])),
  );
}

function sanitizeSortModes(v: unknown): Record<string, SortMode> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter((entry): entry is [string, SortMode] =>
      SORT_MODES.includes(entry[1] as SortMode),
    ),
  );
}

/** 저장소에서 읽은 값을 믿지 않고 모양을 확인해 옳은 부분만 남긴다. */
export function sanitizeWorkspaceState(v: unknown): WorkspacePersistedState {
  if (!isRecord(v)) return EMPTY_STATE;
  return {
    workspaces: sanitizeWorkspaces(v.workspaces),
    orderByParent: sanitizeOrder(v.orderByParent),
    sortModeByAccount: sanitizeSortModes(v.sortModeByAccount),
    collapsed: isStringArray(v.collapsed) ? v.collapsed : [],
    dismissedSuggestions: isStringArray(v.dismissedSuggestions) ? v.dismissedSuggestions : [],
  };
}

// ───────────────────────── 옛 접힘 상태 가져오기

/**
 * `gitbaro-repos`의 `collapsedGroups`(계정 이름)를 `acct:<이름>` 접힘으로 바꾼다.
 * 옛 값이 없거나 읽을 수 없으면 null.
 */
export function seedFromLegacyRepos(legacyRaw: string | null): WorkspacePersistedState | null {
  if (legacyRaw === null) return null;
  try {
    const parsed: unknown = JSON.parse(legacyRaw);
    const groups = isRecord(parsed) && isRecord(parsed.state) ? parsed.state.collapsedGroups : null;
    if (!isStringArray(groups) || groups.length === 0) return null;
    return { ...EMPTY_STATE, collapsed: groups.map(accountNodeKey) };
  } catch {
    return null;
  }
}

/**
 * zustand persist는 같은 키에 저장값이 있고 버전이 다를 때만 `migrate`를 부른다.
 * 다른 키의 값을 옮기려면 「새 키에 저장값이 없을 때」 읽는 쪽에서 채워야 한다.
 * 옛 키는 지우지 않는다(`RepoListView`가 계속 쓴다).
 */
export function withLegacySeed(backing: StateStorage): StateStorage {
  return {
    ...backing,
    getItem: (name) => {
      const raw = backing.getItem(name);
      if (raw !== null) return raw;
      const legacy = backing.getItem(LEGACY_REPOS_STORAGE_KEY);
      if (typeof legacy !== "string" && legacy !== null) return null;
      const seed = seedFromLegacyRepos(legacy);
      return seed ? JSON.stringify({ state: seed, version: WORKSPACES_STORAGE_VERSION }) : null;
    },
  };
}

// ───────────────────────── 순서 도우미

const without = (list: string[], key: string) => list.filter((k) => k !== key);

const insertAt = (list: string[], key: string, index: number | undefined) => {
  const rest = without(list, key);
  const at = index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
};

/** 저장소를 모든 워크스페이스와 그 순서에서 뺀다. */
function detachRepo(
  state: WorkspacePersistedState,
  repoPath: string,
): Pick<WorkspacePersistedState, "workspaces" | "orderByParent"> {
  const key = repoNodeKey(repoPath);
  const owner = state.workspaces.find((w) => w.repoPaths.includes(repoPath));
  if (!owner) return { workspaces: state.workspaces, orderByParent: state.orderByParent };
  const wsKey = workspaceNodeKey(owner.id);
  const wsOrder = state.orderByParent[wsKey];
  return {
    workspaces: state.workspaces.map((w) =>
      w.id === owner.id ? { ...w, repoPaths: without(w.repoPaths, repoPath) } : w,
    ),
    orderByParent: wsOrder
      ? { ...state.orderByParent, [wsKey]: without(wsOrder, key) }
      : state.orderByParent,
  };
}

/** 지금 저장소 목록과 계정 목록으로 저장소의 계정 키를 구한다. */
function currentAccountKeys(): Map<string, string> {
  return accountKeysByPath(
    useRepositoryStore.getState().repos,
    useAccountStore.getState().accounts,
  );
}

function newWorkspaceId(): string {
  return crypto.randomUUID();
}

// ───────────────────────── 스토어

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...EMPTY_STATE,

      createWorkspace: (name, accountKey, repoPaths = []) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, reason: "empty-name" };
        const keys = currentAccountKeys();
        for (const path of repoPaths) {
          const repoAccount = keys.get(path);
          if (repoAccount === undefined) return { ok: false, reason: "unknown-repo" };
          if (repoAccount !== accountKey) return { ok: false, reason: "account-mismatch" };
        }
        const id = newWorkspaceId();
        const members = [...new Set(repoPaths)];
        const detached = members.reduce<WorkspacePersistedState>(
          (acc, path) => ({ ...acc, ...detachRepo(acc, path) }),
          get(),
        );
        const acctKey = accountNodeKey(accountKey);
        const acctOrder = detached.orderByParent[acctKey];
        set({
          workspaces: [...detached.workspaces, { id, name: trimmed, accountKey, repoPaths: members }],
          orderByParent: acctOrder
            ? {
                ...detached.orderByParent,
                [acctKey]: acctOrder.filter(
                  (k) => !members.some((p) => repoNodeKey(p) === k),
                ),
              }
            : detached.orderByParent,
        });
        return { ok: true, id };
      },

      renameWorkspace: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, reason: "empty-name" };
        if (!get().workspaces.some((w) => w.id === id)) {
          return { ok: false, reason: "unknown-workspace" };
        }
        set((state) => ({
          workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
        }));
        return { ok: true };
      },

      deleteWorkspace: (id) => {
        const ws = get().workspaces.find((w) => w.id === id);
        if (!ws) return { ok: false, reason: "unknown-workspace" };
        set((state) => {
          const wsKey = workspaceNodeKey(id);
          const acctKey = accountNodeKey(ws.accountKey);
          const repoKeys = (state.orderByParent[wsKey] ?? []).filter((k) =>
            ws.repoPaths.some((p) => repoNodeKey(p) === k),
          );
          const orderedRepoKeys = [
            ...repoKeys,
            ...ws.repoPaths.map(repoNodeKey).filter((k) => !repoKeys.includes(k)),
          ];
          const { [wsKey]: _removed, ...orderByParent } = state.orderByParent;
          const acctOrder = orderByParent[acctKey];
          // 저장소가 워크스페이스가 있던 자리에 그대로 펼쳐지게 한다.
          const nextAcctOrder = acctOrder
            ? acctOrder.flatMap((k) => (k === wsKey ? orderedRepoKeys : [k]))
            : undefined;
          return {
            workspaces: state.workspaces.filter((w) => w.id !== id),
            orderByParent: nextAcctOrder
              ? { ...orderByParent, [acctKey]: nextAcctOrder }
              : orderByParent,
            collapsed: without(state.collapsed, wsKey),
          };
        });
        return { ok: true };
      },

      addRepoToWorkspace: (id, repoPath, index) => {
        const ws = get().workspaces.find((w) => w.id === id);
        if (!ws) return { ok: false, reason: "unknown-workspace" };
        const repoAccount = currentAccountKeys().get(repoPath);
        if (repoAccount === undefined) return { ok: false, reason: "unknown-repo" };
        if (repoAccount !== ws.accountKey) return { ok: false, reason: "account-mismatch" };
        set((state) => {
          const detached = { ...state, ...detachRepo(state, repoPath) };
          const wsKey = workspaceNodeKey(id);
          const acctKey = accountNodeKey(ws.accountKey);
          const key = repoNodeKey(repoPath);
          const target = detached.workspaces.find((w) => w.id === id)!;
          const baseOrder = detached.orderByParent[wsKey];
          const acctOrder = detached.orderByParent[acctKey];
          return {
            workspaces: detached.workspaces.map((w) =>
              w.id === id ? { ...w, repoPaths: insertAt(target.repoPaths, repoPath, index) } : w,
            ),
            orderByParent: {
              ...detached.orderByParent,
              ...(baseOrder || index !== undefined
                ? { [wsKey]: insertAt(baseOrder ?? target.repoPaths.map(repoNodeKey), key, index) }
                : {}),
              ...(acctOrder ? { [acctKey]: without(acctOrder, key) } : {}),
            },
          };
        });
        return { ok: true };
      },

      removeRepoFromWorkspace: (repoPath) =>
        set((state) => detachRepo(state, repoPath)),

      setChildOrder: (parentKey, childKeys) =>
        set((state) => {
          const accountKey = accountKeyOfNode(parentKey, state.workspaces);
          return {
            orderByParent: { ...state.orderByParent, [parentKey]: [...new Set(childKeys)] },
            sortModeByAccount:
              accountKey === null
                ? state.sortModeByAccount
                : { ...state.sortModeByAccount, [accountKey]: "custom" },
          };
        }),

      setSortMode: (accountKey, mode) =>
        set((state) => ({
          sortModeByAccount: { ...state.sortModeByAccount, [accountKey]: mode },
        })),

      toggleCollapsed: (key) =>
        set((state) => ({
          collapsed: state.collapsed.includes(key)
            ? without(state.collapsed, key)
            : [...state.collapsed, key],
        })),

      setCollapsed: (keys) => set({ collapsed: [...new Set(keys)] }),

      dismissSuggestion: (key) =>
        set((state) =>
          state.dismissedSuggestions.includes(key)
            ? state
            : { dismissedSuggestions: [...state.dismissedSuggestions, key] },
        ),

      forgetRepos: (repoPaths) =>
        set((state) => {
          if (repoPaths.length === 0) return state;
          const gone = new Set(repoPaths);
          const goneKeys = new Set(repoPaths.map(repoNodeKey));
          const orderByParent = Object.fromEntries(
            Object.entries(state.orderByParent)
              .filter(([parent]) => !goneKeys.has(parent))
              .map(([parent, keys]) => [parent, keys.filter((k) => !goneKeys.has(k))]),
          );
          return {
            workspaces: state.workspaces.map((w) =>
              w.repoPaths.some((p) => gone.has(p))
                ? { ...w, repoPaths: w.repoPaths.filter((p) => !gone.has(p)) }
                : w,
            ),
            orderByParent,
            collapsed: state.collapsed.filter((k) => !goneKeys.has(k)),
          };
        }),
    }),
    {
      name: WORKSPACES_STORAGE_KEY,
      version: WORKSPACES_STORAGE_VERSION,
      storage: createJSONStorage(() => withLegacySeed(createSafeStorage())),
      partialize: (state): WorkspacePersistedState => ({
        workspaces: state.workspaces,
        orderByParent: state.orderByParent,
        sortModeByAccount: state.sortModeByAccount,
        collapsed: state.collapsed,
        dismissedSuggestions: state.dismissedSuggestions,
      }),
      // v1이 첫 버전이다. 모르는 버전(예: 더 새 앱이 쓴 값)은 모양만 확인해 살린다.
      migrate: (persisted) => sanitizeWorkspaceState(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeWorkspaceState(persisted) }),
    },
  ),
);

/** 노드 키가 속한 계정 키. 계정·워크스페이스 노드가 아니면 null. */
function accountKeyOfNode(nodeKey: string, workspaces: Workspace[]): string | null {
  if (nodeKey.startsWith("acct:")) return nodeKey.slice("acct:".length);
  if (nodeKey.startsWith("ws:")) {
    const id = nodeKey.slice("ws:".length);
    return workspaces.find((w) => w.id === id)?.accountKey ?? null;
  }
  return null;
}

/**
 * 저장소를 목록에서 지우면 워크스페이스에서도 뺀다. 그래야 같은 저장소를 다시
 * 추가했을 때 예전 워크스페이스로 돌아가지 않는다.
 *
 * 두 스토어가 모두 복원된 뒤에만 돈다. 복원 전의 빈 `repos`를 「모두 지워짐」으로
 * 읽으면 워크스페이스가 전부 비는 사고가 난다.
 */
useRepositoryStore.subscribe((next, prev) => {
  if (next.repos === prev.repos) return;
  if (!useRepositoryStore.persist.hasHydrated() || !useWorkspaceStore.persist.hasHydrated()) {
    return;
  }
  const nextPaths = new Set(next.repos.map((r) => r.path));
  const removed = prev.repos.map((r) => r.path).filter((p) => !nextPaths.has(p));
  if (removed.length > 0) useWorkspaceStore.getState().forgetRepos(removed);
});

// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import "@/i18n/config";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";
import { buildRepoTree, repoNodeKey, workspaceNodeKey } from "@/lib/repo-tree";
import { useAccountStore } from "@/stores/account";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useWorkspaceStore } from "@/stores/workspace";

vi.mock("@/api/commands", () => ({ getWorktrees: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), ask: vi.fn() }));

import { RepoTree } from "../RepoTree";
import type { SidebarTreeData } from "../useSidebarTreeData";

const api = makeRepo("api", "acme");
const web = makeRepo("web", "acme");
const solo = makeRepo("solo", "acme");
const extra = makeRepo("extra", "acme");
const mine = makeRepo("mine", "yjun");
const repos = [api, web, solo, extra, mine];

const ROW_H = 30;

/** jsdom에는 PointerEvent가 없어 dnd-kit 포인터 센서가 좌표를 읽을 수 없다. */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

/** 트리 행을 화면 위에서부터 30px 간격으로 늘어놓은 것처럼 잰다. */
function fakeRect(this: HTMLElement): DOMRect {
  const item = this.matches('[role="treeitem"]')
    ? this
    : this.querySelector(':scope > [role="treeitem"]');
  const index = item ? [...document.querySelectorAll('[role="treeitem"]')].indexOf(item) : -1;
  const top = index < 0 ? 0 : index * ROW_H;
  const height = index < 0 ? 0 : ROW_H;
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 240,
    bottom: top + height,
    width: index < 0 ? 0 : 240,
    height,
    toJSON: () => ({}),
  };
}

beforeAll(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
});

function data(): SidebarTreeData {
  const s = useWorkspaceStore.getState();
  return {
    tree: buildRepoTree({
      repos,
      accounts: [],
      workspaces: s.workspaces,
      orderByParent: s.orderByParent,
      sortModeByAccount: s.sortModeByAccount,
    }),
    signals: {},
    syncByPath: {},
    reviewByPath: {},
    reviewRepos: [],
    worktreesByRepo: {},
    lastChangedAt: {},
    watched: [],
    overflow: [],
    now: 0,
    branchOf: () => null,
    defaultBranchOf: () => undefined,
  };
}

function renderTree() {
  const client = new QueryClient();
  const onSelectRepo = vi.fn();
  const ui = () => (
    <QueryClientProvider client={client}>
      <RepoTree
        data={data()}
        fetchingPath={null}
        onSelectRepo={onSelectRepo}
        onRepoContextMenu={vi.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { onSelectRepo, rerender: () => view.rerender(ui()) };
}

const item = (name: string) => screen.getByRole("treeitem", { name });

function rowCenterY(name: string, ratio = 0.5): number {
  const index = screen.getAllByRole("treeitem").indexOf(item(name));
  return index * ROW_H + ROW_H * ratio;
}

/** `from` 행을 잡아 `to` 행의 `ratio` 높이(0 위 ~ 1 아래)에 놓는다. */
function dragRow(from: string, to: string, ratio: number) {
  const startY = rowCenterY(from);
  const endY = rowCenterY(to, ratio);
  act(() => {
    fireEvent.pointerDown(item(from), { clientX: 20, clientY: startY, button: 0, isPrimary: true });
  });
  act(() => {
    fireEvent.pointerMove(document, { clientX: 20, clientY: startY + 10 });
  });
  act(() => {
    fireEvent.pointerMove(document, { clientX: 20, clientY: endY });
  });
  act(() => {
    fireEvent.pointerUp(document, { clientX: 20, clientY: endY });
  });
}

let wsId = "";

beforeEach(() => {
  localStorage.clear();
  useAccountStore.setState({ accounts: [] });
  useActivityTargetsStore.setState({ extraByKey: {} });
  useToastStore.setState({ toasts: [] });
  useRepositoryStore.setState({
    repos,
    activeRepoPath: null,
    activeRepo: null,
    activeWorktrees: {},
    favoriteRepos: [],
  });
  useWorkspaceStore.setState({
    workspaces: [],
    orderByParent: {},
    sortModeByAccount: {},
    collapsed: [],
    dismissedSuggestions: [],
  });
  const created = useWorkspaceStore
    .getState()
    .createWorkspace("product", "acme", [api.path, web.path]);
  if (!created.ok) throw new Error(created.reason);
  wsId = created.id;
  // 워크스페이스·저장소 행을 이름순으로 본다.
  useWorkspaceStore.getState().setSortMode("acme", "name");
});

afterEach(cleanup);

describe("RepoTree — 끌어서 놓기", () => {
  it("저장소·워크스페이스 행에 손잡이가 있고, 검색하는 동안에는 없다", () => {
    renderTree();
    const handle = "Drag to reorder";
    const soloRow = item("solo").parentElement!;
    expect(within(soloRow).getByTitle(handle)).toBeInTheDocument();
    expect(within(item("product").parentElement!).getByTitle(handle)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "so" } });
    expect(screen.queryAllByTitle(handle)).toHaveLength(0);
  });

  it("저장소를 워크스페이스 행 가운데에 놓으면 그 워크스페이스에 들어간다", () => {
    const { onSelectRepo } = renderTree();

    dragRow("solo", "product", 0.5);

    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId)!;
    expect(ws.repoPaths).toEqual([api.path, web.path, solo.path]);
    // 끌기로 끝난 포인터 동작은 저장소를 열지 않는다.
    expect(onSelectRepo).not.toHaveBeenCalled();
  });

  it("행 사이에 놓으면 순서를 저장하고 정렬이 「사용자 지정」이 된다", () => {
    renderTree();
    // 이름순 화면: extra, product, solo  → solo를 extra 앞으로
    dragRow("solo", "extra", 0.2);

    const s = useWorkspaceStore.getState();
    expect(s.orderByParent["acct:acme"]).toEqual([
      repoNodeKey(solo.path),
      repoNodeKey(extra.path),
      workspaceNodeKey(wsId),
    ]);
    expect(s.sortModeByAccount.acme).toBe("custom");
    // 다른 부모(워크스페이스 안)도 보이던 순서가 함께 저장된다.
    expect(s.orderByParent[workspaceNodeKey(wsId)]).toEqual([
      repoNodeKey(api.path),
      repoNodeKey(web.path),
    ]);
  });

  it("펼친 워크스페이스 행 아래쪽에 끌면 표시선이 그 안 저장소들 다음에 보이고, 그 자리에 놓인다", () => {
    renderTree();
    // 이름순 화면: extra, product(api, web), solo
    const startY = rowCenterY("extra");
    const endY = rowCenterY("product", 0.9);
    act(() => {
      fireEvent.pointerDown(item("extra"), { clientX: 20, clientY: startY, button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 20, clientY: startY + 10 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 20, clientY: endY });
    });

    const productRow = item("product").parentElement!;
    expect(productRow).toHaveAttribute("data-drop", "after");
    // 워크스페이스 행 바로 밑에는 선을 그리지 않는다.
    expect(productRow.querySelector(".bg-primary")).toBeNull();
    const line = document.querySelector(`[data-drop-after="${workspaceNodeKey(wsId)}"]`)!;
    expect(line).not.toBeNull();
    expect(
      item("web").compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      line.compareDocumentPosition(item("solo")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      fireEvent.pointerUp(document, { clientX: 20, clientY: endY });
    });
    expect(useWorkspaceStore.getState().orderByParent["acct:acme"]).toEqual([
      workspaceNodeKey(wsId),
      repoNodeKey(extra.path),
      repoNodeKey(solo.path),
    ]);
  });

  it("다른 계정의 워크스페이스 위에서는 놓을 수 없다고 알리고 아무것도 바꾸지 않는다", () => {
    renderTree();
    const startY = rowCenterY("mine");
    const endY = rowCenterY("product");
    act(() => {
      fireEvent.pointerDown(item("mine"), { clientX: 20, clientY: startY, button: 0 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 20, clientY: startY - 10 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 20, clientY: endY });
    });

    expect(item("product").parentElement).toHaveAttribute("data-drop", "blocked");
    expect(screen.getByText("Can't move to another account")).toBeInTheDocument();

    act(() => {
      fireEvent.pointerUp(document, { clientX: 20, clientY: endY });
    });
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId)!;
    expect(ws.repoPaths).toEqual([api.path, web.path]);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      "Can't move to another account",
    ]);
  });
});

import {
  createContext,
  useContext,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Announcements,
} from "@dnd-kit/core";
import { Ban, Folder, GitBranch, GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccountNode } from "@/lib/repo-tree";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";
import type { WorkspaceError } from "@/stores/workspace";
import { INDENT_PX } from "./TreeRowFrame";
import {
  applyDrop,
  planDrop,
  zoneFor,
  type DragKind,
  type DropPlan,
  type DropZone,
} from "./tree-dnd";

/** 끄는 행과 놓을 행이 dnd-kit에 싣는 값. */
interface RowDragData {
  kind: DragKind;
  label: string;
  /** 저장소 행의 아바타 색을 정하는 경로. */
  path?: string;
  /** 미리보기에 보일 브랜치 줄(저장소 행). */
  branch?: string | null;
  /** 미리보기 오른쪽에 보일 표시(합계 배지). */
  badges?: ReactNode;
}

interface DropIndicator {
  overKey: string;
  zone: DropZone;
  plan: DropPlan;
}

interface TreeDndState {
  activeKey: string | null;
  indicator: DropIndicator | null;
}

const TreeDndContext = createContext<TreeDndState>({
  activeKey: null,
  indicator: null,
});

/** 클릭으로 끝나는 포인터 이동이 드래그였으면, 그 뒤 잠깐 오는 클릭을 무시한다. */
const CLICK_SUPPRESS_MS = 150;

function pointerY(event: DragMoveEvent | DragEndEvent): number | null {
  const start = event.activatorEvent as { clientY?: unknown } | null;
  return typeof start?.clientY === "number" ? start.clientY + event.delta.y : null;
}

function indicatorOf(
  tree: AccountNode[],
  event: DragMoveEvent | DragEndEvent,
): DropIndicator | null {
  const { active, over } = event;
  const activeData = active.data.current as RowDragData | undefined;
  const overData = over?.data.current as RowDragData | undefined;
  if (!over || !activeData || !overData) return null;
  const y = pointerY(event);
  const ratio = y === null || over.rect.height <= 0 ? 0.5 : (y - over.rect.top) / over.rect.height;
  const zone = zoneFor(activeData.kind, overData.kind, ratio);
  const overKey = String(over.id);
  const plan = planDrop(tree, String(active.id), overKey, zone);
  return plan ? { overKey, zone, plan } : null;
}

const sameIndicator = (a: DropIndicator | null, b: DropIndicator | null) =>
  a?.overKey === b?.overKey && a?.zone === b?.zone && a?.plan.type === b?.plan.type;

interface TreeDndProviderProps {
  /** 검색으로 거르지 않은 전체 트리. 순서는 이 트리의 형제 순서에서 계산한다. */
  tree: AccountNode[];
  children: ReactNode;
}

/**
 * 사이드바 트리의 끌어서 놓기(`@dnd-kit/core`). 포인터 이벤트 기반이라 Tauri 창의 파일 드롭
 * 처리(HTML5 드래그)와 부딪치지 않는다. 행에 마우스를 올리면 손잡이가 보이고, 4px 넘게 끌면
 * 드래그가 시작된다(그보다 짧으면 평소처럼 클릭).
 */
export function TreeDndProvider({ tree, children }: TreeDndProviderProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [active, setActive] = useState<{
    key: string;
    data: RowDragData;
  } | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  const suppressClickUntil = useRef(0);

  const reset = () => {
    setActive(null);
    setIndicator(null);
    suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as RowDragData | undefined;
    if (data) setActive({ key: String(event.active.id), data });
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const next = indicatorOf(tree, event);
    setIndicator((prev) => (sameIndicator(prev, next) ? prev : next));
  };

  const failureMessage = (reason: WorkspaceError) =>
    reason === "account-mismatch"
      ? t("sidebarDnd.otherAccount")
      : reason === "account-pending"
        ? t("sidebarDnd.accountPending")
        : t("sidebarDnd.failed");

  const handleDragEnd = (event: DragEndEvent) => {
    const final = indicatorOf(tree, event);
    reset();
    if (!final) return;
    const result = applyDrop(final.plan);
    if (!result.ok) addToast(failureMessage(result.reason), "warning");
  };

  const handleClickCapture = (e: MouseEvent) => {
    if (Date.now() < suppressClickUntil.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const blocked = indicator?.plan.type === "blocked";

  // 화면 읽기 프로그램 안내(dnd-kit 기본 문구는 영어뿐이라 번역한다).
  const labelOf = (data: unknown) => (data as RowDragData | undefined)?.label ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active: a }) =>
      t("sidebarDnd.announce.start", { name: labelOf(a.data.current) }),
    onDragOver: ({ active: a, over }) =>
      over
        ? t("sidebarDnd.announce.over", {
            name: labelOf(a.data.current),
            target: labelOf(over.data.current),
          })
        : undefined,
    onDragEnd: ({ active: a }) => t("sidebarDnd.announce.end", { name: labelOf(a.data.current) }),
    onDragCancel: ({ active: a }) =>
      t("sidebarDnd.announce.cancel", { name: labelOf(a.data.current) }),
  };

  return (
    <TreeDndContext.Provider value={{ activeKey: active?.key ?? null, indicator }}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={reset}
      >
        <div role="none" className="contents" onClickCapture={handleClickCapture}>
          {children}
        </div>
        <DragOverlay dropAnimation={null}>
          {active && <DragPreview data={active.data} blocked={blocked} />}
        </DragOverlay>
      </DndContext>
    </TreeDndContext.Provider>
  );
}

/** 끄는 동안 포인터를 따라다니는 행 미리보기(시안 `gen_d.py`의 `drag_demo`). */
function DragPreview({ data, blocked }: { data: RowDragData; blocked: boolean }) {
  const { t } = useTranslation();
  const color = data.path ? avatarColor(data.path) : null;
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 px-2 py-1.5 rounded-[var(--radius-item)] bg-card -rotate-[1.5deg]",
        "shadow-[0_10px_24px_rgba(0,0,0,0.16)]",
        blocked && "cursor-not-allowed",
      )}
    >
      <span className="flex items-center gap-[var(--item)] min-w-0 w-full">
        {color ? (
          <span
            aria-hidden="true"
            className="w-5 h-5 shrink-0 rounded-[var(--radius-chip)] flex items-center justify-center text-[10px] font-extrabold"
            style={{
              backgroundColor: color.background,
              color: color.foreground,
            }}
          >
            {avatarInitial(data.label)}
          </span>
        ) : (
          <span className="w-5 h-5 shrink-0 rounded-[var(--radius-chip)] bg-muted flex items-center justify-center">
            <Folder className="w-[13px] h-[13px] text-[var(--fg2)]" aria-hidden="true" />
          </span>
        )}
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          <span className="text-[12.5px] font-bold text-foreground truncate">{data.label}</span>
          {data.branch && (
            <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground min-w-0">
              <GitBranch className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{data.branch}</span>
            </span>
          )}
        </span>
        {data.badges}
      </span>
      {blocked && (
        <span role="status" className="flex items-center gap-1 text-[10.5px] text-destructive">
          <Ban className="w-3 h-3 shrink-0" aria-hidden="true" />
          {t("sidebarDnd.otherAccount")}
        </span>
      )}
    </div>
  );
}

interface DraggableRowProps {
  /** 트리 노드 키(`repo:<경로>`, `ws:<id>`) */
  id: string;
  kind: DragKind;
  label: string;
  /** 들여쓰기 단계. 손잡이와 표시선 위치에 쓴다. */
  depth: number;
  /**
   * 이 행에 딸린 행(펼친 워크스페이스의 저장소, 펼친 저장소의 워크트리)이 바로 아래에 보이는지.
   * 그러면 「뒤」 표시선은 이 행 밑이 아니라 딸린 행들 다음(`DropAfterLine`)에 그린다.
   */
  groupBelow?: boolean;
  /** 저장소 행이면 그 경로(미리보기 아바타 색) */
  path?: string;
  /** 미리보기에 보일 브랜치 줄 */
  branch?: string | null;
  /** 미리보기에 보일 합계 배지 */
  badges?: ReactNode;
  /** 검색 중처럼 끌 수 없을 때 */
  disabled?: boolean;
  children: ReactNode;
}

/**
 * 트리 행 하나를 끌 수 있고 놓을 수 있게 감싼다. 마우스를 올리면 왼쪽에 손잡이가 보이고,
 * 이 행 위로 끌고 오면 앞·뒤 표시선이나 「안으로」 테두리, 놓을 수 없음 테두리를 그린다.
 */
export function DraggableRow({
  id,
  kind,
  label,
  depth,
  groupBelow = false,
  path,
  branch,
  badges,
  disabled = false,
  children,
}: DraggableRowProps) {
  const { t } = useTranslation();
  const data: RowDragData = { kind, label, path, branch, badges };
  const drag = useDraggable({ id, data, disabled });
  const drop = useDroppable({ id, data, disabled });
  const { activeKey, indicator } = useContext(TreeDndContext);
  const mine = indicator?.overKey === id ? indicator : null;
  const blocked = mine?.plan.type === "blocked";
  const showLine =
    mine && !blocked && (mine.zone === "before" || (mine.zone === "after" && !groupBelow));

  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      role="none"
      data-drop={mine ? (blocked ? "blocked" : mine.zone) : undefined}
      className={cn("group/drag relative", activeKey === id && "opacity-40")}
      {...(disabled ? {} : drag.listeners)}
    >
      {!disabled && (
        <span
          title={t("sidebarDnd.handle")}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 z-10 flex text-[var(--faint)] cursor-grab",
            "opacity-0 group-hover/drag:opacity-100",
            activeKey !== null && "hidden",
          )}
          style={{ left: depth * INDENT_PX - 4 }}
        >
          <GripVertical className="w-2.5 h-3" aria-hidden="true" />
        </span>
      )}
      {children}
      {showLine && <DropLine depth={depth} edge={mine.zone === "before" ? "top" : "bottom"} />}
      {mine && !blocked && mine.zone === "into" && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-[var(--radius-item)] ring-2 ring-foreground/30 pointer-events-none"
        />
      )}
      {blocked && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-[var(--radius-item)] border-2 border-dashed border-destructive/60 pointer-events-none"
        />
      )}
    </div>
  );
}

/** 놓일 자리를 알리는 2px 표시선. */
function DropLine({ depth, edge }: { depth: number; edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute right-2 h-0.5 rounded-full bg-(--fg2) pointer-events-none z-10",
        edge === "top" ? "-top-px" : "-bottom-px",
      )}
      style={{ left: 8 + depth * INDENT_PX }}
    />
  );
}

interface DropAfterLineProps {
  /** 딸린 행을 가진 행의 트리 노드 키 */
  id: string;
  depth: number;
}

/**
 * 딸린 행이 보이는 행(`groupBelow`)의 「뒤」 표시선. 딸린 행들 바로 다음에 두어, 실제로
 * 놓이는 자리(그 무리 다음)에 선이 보이게 한다.
 */
export function DropAfterLine({ id, depth }: DropAfterLineProps) {
  const { indicator } = useContext(TreeDndContext);
  if (indicator?.overKey !== id || indicator.zone !== "after") return null;
  if (indicator.plan.type === "blocked") return null;
  return (
    <div role="none" data-drop-after={id} className="relative h-0">
      <DropLine depth={depth} edge="top" />
    </div>
  );
}

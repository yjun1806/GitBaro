import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { RepoWorkSwitcher } from "@/components/commit/WorkSwitcher";
import { TAURI_EVENTS } from "@/api/events";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import {
  fetchFileDiff,
  useFileDiff,
  useStashMutations,
  useUnpushedFileTouches,
  useWipFiles,
  useWorktrees,
} from "@/api/queries";
import { stageFiles } from "@/api/commands";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useFollowStore, type FollowMode } from "@/stores/follow";
import { FOLLOW_KEY, useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { diffDelta, type DiffDelta } from "@/lib/diff-delta";
import { useJustChanged, type JustChanged } from "./useJustChanged";
import { FollowLine } from "./FollowLine";
import { followNote } from "./follow-note";
import { FocusFlash } from "@/components/ui/FocusFlash";
import { cn, formatRelativeTime, getErrorMessage, trimTrailingSlash } from "@/lib/utils";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import {
  OverlapBanner,
  OverlapMark,
  useWorktreeOverlap,
  type WorktreeOverlap,
} from "@/components/worktree/OverlapBadge";
import { SideBySideDiff } from "@/components/worktree/SideBySideDiff";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import type { MaximizedFiles, MaximizedOrigin } from "@/components/layout/maximized-files";
import type { DiffOutput, StatusEntry, WipFile } from "@/types";
import { useWorkingFileMenu } from "@/components/commit/useWorkingFileMenu";
import { useFileMenu } from "@/components/commit/useFileMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { useOpenFileInEditor } from "@/hooks/useOpenFileInEditor";
import { LoadingState } from "@/components/ui/LoadingState";
import { useNow } from "@/hooks/useNow";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { Segmented } from "@/components/ui/Segmented";
import { Dot, FileStatusLetter, RefLabel, StatusChip, LineDelta } from "@/components/ui/marks";
import { FLOATING_SURFACE } from "@/components/ui/layers";

/** `registerWatchPaths`에 쓰는 이 화면의 key. 감시 대상 목록에서 맨 앞에 온다. */
export const FOLLOW_WATCH_KEY = FOLLOW_KEY;
/**
 * 감시에 들어가지 못해 `repo:activity`가 오지 않는 경로만(상한 초과 또는 감시 실패)
 * 이 주기로 파일 목록과 diff를 다시 읽는다.
 */
export const OVERFLOW_POLL_MS = 5_000;
/** 따라가기를 시작할 때 비교 기준으로 내용을 기억해 두는 파일 수의 상한(최근 수정 순). */
const BASELINE_LIMIT = 30;
/** 「방금 N행 추가」 안내를 띄워 두는 시간. 줄 강조는 다음 변경까지 남는다. */
const TOAST_MS = 8_000;

function samePath(a: string, b: string): boolean {
  return trimTrailingSlash(a) === trimTrailingSlash(b);
}

/** 「따라가는 중」·「따라가기 멈춤」 상태 칩(D2). WIP 행과 파일 목록 머리에 붙는다. */
export function FollowBadge({ mode }: { mode: FollowMode }) {
  const { t } = useTranslation();
  const following = mode === "following";
  return (
    <span data-testid="follow-badge">
      <StatusChip tone={following ? "live" : "neutral"} icon={<Dot on={following} breathe={following} />}>
        {following ? t("live.following") : t("live.paused")}
      </StatusChip>
    </span>
  );
}

/** 따라가는 경로의 파일 목록과 diff를 모두 다시 읽게 한다. */
function refreshFollowed(queryClient: QueryClient, path: string): void {
  void queryClient.invalidateQueries({ queryKey: ["wipFiles", path] });
  void queryClient.invalidateQueries({ queryKey: ["fileDiff", path] });
}

/**
 * 따라가는 경로의 `repo:activity`를 받아 파일 목록과 diff를 다시 읽는다. 활동 감시는
 * 가장 깊은 감시 경로에만 기록하므로(W1-T3) 워크트리 경로와 같은 이벤트만 본다.
 * 활성 저장소가 아니어도 된다 — 따라가는 경로를 감시 대상에 직접 넣는다(맨 앞 순위).
 * 그래도 감시에 들어가지 못하면(`polled`) 목록과 diff를 함께 주기적으로 다시 읽는다.
 */
function useFollowRefresh(path: string, polled: boolean): void {
  const queryClient = useQueryClient();
  const registerWatchPaths = useActivityTargetsStore((s) => s.registerWatchPaths);
  const unregisterWatchPaths = useActivityTargetsStore((s) => s.unregisterWatchPaths);

  useEffect(() => {
    registerWatchPaths(FOLLOW_WATCH_KEY, [path]);
    return () => unregisterWatchPaths(FOLLOW_WATCH_KEY);
  }, [path, registerWatchPaths, unregisterWatchPaths]);

  useTauriEvent(TAURI_EVENTS.repoActivity, (activity) => {
    if (samePath(activity.path, path)) refreshFollowed(queryClient, path);
  });

  useEffect(() => {
    if (!polled) return;
    const id = setInterval(() => refreshFollowed(queryClient, path), OVERFLOW_POLL_MS);
    return () => clearInterval(id);
  }, [polled, path, queryClient]);
}

/** 스냅숏·diff를 가리키는 키: 경로 + 스테이징 쪽. */
function sideKey(path: string, staged: boolean): string {
  return `${path}\u0000${staged}`;
}

/** 목록 행 하나를 처음 보여 줄 때의 스테이징 쪽. 스테이징만 하고 작업 트리는 그대로인 파일만 스테이징 쪽이다. */
function defaultStaged(f: WipFile): boolean {
  return f.staged && !f.unstaged;
}

interface FreshChange {
  /** 어느 파일(경로 + 스테이징 쪽)의 변경인지. */
  key: string;
  delta: DiffDelta;
  at: number;
}

/**
 * 같은 파일을 다시 읽을 때마다 직전 내용과 비교해 새로 생긴 줄을 찾는다. 비교 기준:
 * - 이미 본 적 있는 파일: 마지막으로 본 내용.
 * - 따라가기를 시작할 때 이미 바뀌어 있던 파일: 시작할 때 미리 읽어 둔 내용(최근 순 `BASELINE_LIMIT`개).
 * - 따라가는 동안 목록에 새로 나타난 파일(방금까지 깨끗했던 파일): HEAD·인덱스 쪽 내용(`oldContent`).
 */
function useFreshLines(
  path: string,
  files: WipFile[] | undefined,
  key: string | null,
  diff: DiffOutput | undefined,
) {
  const queryClient = useQueryClient();
  // 파일마다 마지막으로 본 내용. 화면 상태가 아니라 비교용 기억이라 ref에 둔다.
  const snapshots = useRef<ReadonlyMap<string, string>>(new Map());
  // 경로 → 첫 목록부터 있었는지(initial), 따라가는 동안 새로 나타났는지(appeared).
  const origins = useRef<ReadonlyMap<string, "initial" | "appeared">>(new Map());
  const listLoaded = useRef(false);
  const [fresh, setFresh] = useState<FreshChange | null>(null);

  useEffect(() => {
    if (!files) return;
    const first = !listLoaded.current;
    listLoaded.current = true;
    const listed = new Set(files.map((f) => f.path));
    origins.current = new Map(
      files.map((f) => [f.path, origins.current.get(f.path) ?? (first ? "initial" : "appeared")] as const),
    );
    // 목록에서 빠진 파일(커밋됨·되돌림)은 기억도 지운다. 다시 나타나면 새 파일처럼 본다.
    snapshots.current = new Map([...snapshots.current].filter(([k]) => listed.has(k.split("\u0000")[0])));
  }, [files]);

  // 시작할 때 이미 바뀌어 있던 파일의 지금 내용을 기억해 둔다. 그래야 그 파일이 나중에
  // 다시 바뀌어 화면에 올라올 때 처음부터 새 줄을 가려낼 수 있다(시안 D4의 첫 장면).
  const baselineTaken = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!files || baselineTaken.current) return;
    baselineTaken.current = true;
    for (const f of files.slice(0, BASELINE_LIMIT)) {
      if (f.status === "deleted") continue;
      const staged = defaultStaged(f);
      const k = sideKey(f.path, staged);
      fetchFileDiff(queryClient, path, f.path, staged)
        .then((d) => {
          if (!alive.current || d.binary || d.filePath !== f.path || snapshots.current.has(k)) return;
          if (origins.current.get(f.path) !== "initial") return;
          snapshots.current = new Map(snapshots.current).set(k, d.newContent);
        })
        .catch(() => {
          /* 기준을 못 읽은 파일은 다음 변경부터 강조한다 */
        });
    }
  }, [files, path, queryClient]);

  useEffect(() => {
    if (!key || !diff || diff.binary) return;
    const filePath = key.split("\u0000")[0];
    if (diff.filePath !== filePath) return;
    const prev =
      snapshots.current.get(key) ??
      (origins.current.get(filePath) === "appeared" ? diff.oldContent : undefined);
    snapshots.current = new Map(snapshots.current).set(key, diff.newContent);
    if (prev === undefined || prev === diff.newContent) return;
    const delta = diffDelta(prev, diff.newContent);
    if (delta.added.length === 0 && delta.removedCount === 0) return;
    setFresh({ key, delta, at: Date.now() });
  }, [key, diff]);

  return fresh !== null && fresh.key === key ? fresh : null;
}

/**
 * 따라가기 목록의 행을 스테이징 목록의 행(`StatusEntry`)으로 본다. 메뉴의 스테이지·되돌리기는
 * 스테이지 안 된 쪽이 있으면 그쪽을, 스테이징만 한 파일이면 스테이징된 쪽을 다룬다.
 */
export function wipEntry(f: WipFile): StatusEntry {
  return { path: f.path, origPath: f.origPath, status: f.status, staged: !f.unstaged };
}

/** diff 머리의 「4초 전 수정」(시안 D4). 1분 안이면 작업 중 색으로 초 단위를 센다. */
function ModifiedAgo({ at }: { at: number }) {
  const { t } = useTranslation();
  const now = useNow(1_000);
  const seconds = Math.max(0, Math.floor(now / 1000 - at));
  return seconds < 60 ? (
    <span className="text-[11.5px] font-semibold text-(--live)">{t("live.modifiedSecondsAgo", { count: seconds })}</span>
  ) : (
    <span className="text-[11.5px] text-muted-foreground">{t("live.modifiedAt", { when: formatRelativeTime(at) })}</span>
  );
}

/** 일부만 스테이징한 파일에서 스테이지 안 된 쪽과 스테이지된 쪽 중 무엇을 볼지 고른다. */
function StagedSideToggle({ staged, onChange }: { staged: boolean; onChange: (staged: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      size="sm"
      ariaLabel={t("live.stagedSideToggle")}
      value={staged ? "staged" : "unstaged"}
      onChange={(v) => onChange(v === "staged")}
      options={[
        { value: "unstaged", label: t("live.showUnstaged") },
        { value: "staged", label: t("live.showStaged") },
      ]}
    />
  );
}

function FollowFileList({
  files,
  selected,
  overlap,
  justChanged,
  onPick,
  onDoubleClick,
  onContextMenu,
}: {
  files: WipFile[];
  selected: string | null;
  /** 다른 워크트리도 고치는 파일(⧉, 시안 D5). */
  overlap: WorktreeOverlap;
  /** 방금 바뀐 파일들(한 번 비출 것). 목록이 비었다 다시 채워져도 기억이 이어지게 `FollowPanel`에서 받는다. */
  justChanged: JustChanged | null;
  onPick: (path: string) => void;
  onDoubleClick: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const now = useNow(1_000);
  const selectedIndex = selected === null ? -1 : files.findIndex((f) => f.path === selected);
  // 위아래 화살표로 파일을 옮겨 고른다(고르면 따라가기가 멈춘다).
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: files,
    onSelect: (f) => onPick(f.path),
    selectedIndex,
  });
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" role="list" aria-label={t("live.uncommitted")} {...containerProps}>
      {files.map((f, index) => {
        const seconds = f.modifiedAt === null ? null : Math.max(0, Math.floor(now / 1000 - f.modifiedAt));
        const recent = seconds !== null && seconds < 60;
        const slash = f.path.lastIndexOf("/");
        const name = slash >= 0 ? f.path.slice(slash + 1) : f.path;
        const dir = slash >= 0 ? f.path.slice(0, slash) : "";
        return (
          <button
            key={f.path}
            ref={itemRef(index)}
            type="button"
            role="listitem"
            title={f.path}
            aria-current={f.path === selected || undefined}
            onClick={() => onPick(f.path)}
            onDoubleClick={() => onDoubleClick(f.path)}
            onContextMenu={(e) => onContextMenu(f.path, e)}
            className={cn(
              "relative isolate w-full flex items-center gap-2 min-h-(--row) px-3 text-left select-none border-b border-(--line) transition-colors",
              f.path === selected
                ? "bg-(--acc-sel)"
                : activeIndex === index
                  ? "bg-accent ring-1 ring-inset ring-primary/30"
                  : "hover:bg-accent",
            )}
          >
            {justChanged?.paths.has(f.path) && <FocusFlash key={justChanged.at} testId="file-flash" />}
            <FileStatusLetter status={f.status} />
            <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">
              <span>{name}</span>
              {dir && <span className="ml-1.5 text-[11.5px] text-muted-foreground">{dir}</span>}
            </span>
            <OverlapMark siblings={overlap.of(f)} />
            {f.staged && (
              <span className="shrink-0 text-[10.5px] text-muted-foreground">
                {f.unstaged ? t("live.partlyStaged") : t("live.staged")}
              </span>
            )}
            {seconds !== null && (
              <span
                className={cn(
                  "shrink-0 text-[10.5px]",
                  recent && index === 0 ? "font-bold text-(--live)" : "text-muted-foreground",
                )}
              >
                {recent ? t("live.secondsAgo", { count: seconds }) : formatRelativeTime(f.modifiedAt!)}
              </span>
            )}
            <LineDelta additions={f.insertions} deletions={f.deletions} className="text-[11.5px]" />
          </button>
        );
      })}
    </div>
  );
}

function freshMessage(t: ReturnType<typeof useTranslation>["t"], delta: DiffDelta): string {
  const first = delta.ranges[0];
  if (!first) return t("live.removed", { count: delta.removedCount });
  const lines = first.start === first.end ? `${first.start}` : `${first.start}–${first.end}`;
  return delta.ranges.length === 1
    ? t("live.added", { lines })
    : t("live.addedMore", { lines, count: delta.ranges.length - 1 });
}

export interface FollowPanelProps {
  /** 따라가는 워크트리 경로(활성 저장소가 아니어도 된다). */
  path: string;
  /** "cards": 저장소 화면처럼 파일 목록과 diff를 카드 두 장으로. "inline": 한 카드 안에 나란히. */
  variant: "cards" | "inline";
  /** 목록 머리 아래에 둘 것(저장소 표시 등). */
  header?: ReactNode;
  /**
   * 목록 맨 위의 [작업 중인 변경 | 커밋] 전환. 빼면 저장소 화면(`cards`)은 지금 연 저장소의 전환
   * (`RepoWorkSwitcher`)을 쓰고, 한 카드 판(`inline`)은 두지 않는다.
   */
  switcher?: ReactNode;
  /** 목록 아래에 둘 것(스테이징·커밋으로 가는 버튼 등). */
  footer?: ReactNode;
}

/**
 * 실시간 따라가기(D4). 워크트리의 커밋하지 않은 파일을 수정 시각 순으로 보여 주고,
 * 따라가는 중에는 가장 최근 파일을 자동으로 골라 방금 생긴 줄로 스크롤한 뒤 그 줄을 한 번 비추고
 * (`FocusFlash`), 다음 변경까지 남는 표시(조용한 바탕·주황 줄 번호)를 둔다. 방금 바뀐 파일의 목록 행도
 * 같은 막으로 한 번 비춘다. 사용자가 파일을 고르거나 diff를 스크롤하면 멈춘다.
 */
export function FollowPanel({ path, variant, header, footer, switcher }: FollowPanelProps) {
  const { t } = useTranslation();
  const target = useFollowStore((s) => s.target);
  const mode = useFollowStore((s) => s.mode);
  const pickedFile = useFollowStore((s) => s.file);
  const start = useFollowStore((s) => s.start);
  const pause = useFollowStore((s) => s.pause);
  const pickFileInStore = useFollowStore((s) => s.pickFile);
  const resume = useFollowStore((s) => s.resume);
  // diff를 닫았는가(닫기 버튼·Esc). 닫은 뒤에는 새 변경이 와도 diff를 다시 열지 않는다 — 파일을 다시
  // 고르거나 다시 따라가면 풀린다.
  const [diffClosed, setDiffClosed] = useState(false);
  const pickFile = (filePath: string) => {
    setDiffClosed(false);
    pickFileInStore(filePath);
  };

  const isTarget = target !== null && samePath(target, path);
  const following = isTarget && mode === "following";

  // 감시에 들어가지 못한 경로(상한 초과·감시 실패)는 이벤트가 없으니 목록과 diff를 주기적으로 읽는다.
  const polled = useLiveChangesStore((s) => s.overflow.some((p) => samePath(p, path)));
  useFollowRefresh(path, polled);
  const { data: files, isLoading, isError } = useWipFiles(path);
  const list = useMemo(() => files ?? [], [files]);
  // 크게 보기 머리 줄에 둘 브랜치 이름(워크트리 목록은 이미 다른 화면이 읽어 둬 대개 캐시에서 온다).
  const { data: worktreeList = [] } = useWorktrees(path);
  const branch = worktreeList.find((w) => samePath(w.path, path))?.branch ?? null;
  // 방금 바뀐 파일의 행을 한 번 비춘다(diff의 새 줄과 같은 막). 「N초 전」 글자는 계속 세지만 비추기는
  // 한 번뿐이다. 목록이 비어도(작업 트리가 깨끗해져도) `FollowPanel`은 그대로 떠 있으니, 여기서
  // 기억해야 비었다가 파일이 다시 나타났을 때도 그 파일이 비춘다 — 목록이 빌 때 사라지는
  // `FollowFileList` 안에 두면 다시 나타날 때 기억이 없어 비추지 못한다. `files`(로딩 중엔
  // undefined)를 그대로 넘겨, 자리표시자 빈 배열을 「첫 목록」으로 착각하지 않게 한다.
  const justChanged = useJustChanged(files);

  // 멈춘 동안 보던 파일이 목록에서 빠지면(커밋·되돌림) 다른 파일로 넘어가지 않는다 —
  // 넘어가면 「멈춤」인데도 가장 최근 파일을 따라가는 것과 같아진다.
  const pausedOn = isTarget && mode === "paused" ? pickedFile : null;
  const pausedGone = pausedOn !== null && files !== undefined && !list.some((f) => f.path === pausedOn);
  const wanted = following ? list[0]?.path : pausedOn;
  const shown = pausedGone || diffClosed ? null : (list.find((f) => f.path === wanted) ?? list[0] ?? null);

  // 일부만 스테이징한 파일은 diff 머리에서 어느 쪽을 볼지 고른다(기본은 스테이지 안 된 쪽).
  const [sidePick, setSidePick] = useState<{ path: string; staged: boolean } | null>(null);
  const partlyStaged = shown !== null && shown.staged && shown.unstaged;
  const staged =
    shown === null
      ? false
      : partlyStaged
        ? sidePick !== null && sidePick.path === shown.path && sidePick.staged
        : defaultStaged(shown);
  const { data: diff, isLoading: diffLoading, isError: diffError } = useFileDiff(
    path,
    shown?.path ?? null,
    staged,
  );
  const diffKey = shown ? sideKey(shown.path, staged) : null;
  const fresh = useFreshLines(path, files, diffKey, diff);
  const freshLines = useMemo(() => (fresh ? new Set(fresh.delta.added) : undefined), [fresh]);

  // 안내는 변경이 들어오면 바로 띄우고, 일정 시간이 지나면 그 변경의 안내만 닫는다.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!fresh) return;
    const at = fresh.at;
    const id = setTimeout(() => setClosedAt(at), TOAST_MS);
    return () => clearTimeout(id);
  }, [fresh]);
  const toastOpen = fresh !== null && closedAt !== fresh.at;

  // 같은 저장소의 다른 워크트리도 고치는 파일(D5 ⧉). 보고 있는 파일이면 diff 위에 경고를 띄운다.
  const overlap = useWorktreeOverlap(path, list);
  const shownSiblings = shown ? overlap.of(shown) : [];
  // 이름을 바꾼 파일은 다른 워크트리에 이 워크트리의 새 경로가 없을 수 있다 — 겹침이 옛 경로로
  // 맞았다면 그쪽 diff는 옛 경로로 읽어야 한다(OverlapBadge.tsx의 matchedPathOf).
  const siblingFilePath = shown ? (overlap.matchedPathOf(shown) ?? shown.path) : null;
  const [sideBySideOf, setSideBySideOf] = useState<string | null>(null);
  const sideBySideOpen = shown !== null && sideBySideOf === shown.path && shownSiblings.length > 0;

  // 따라가기 줄의 「눈여겨볼 것」(D49). 파일별 보기와 같은 조회(`useUnpushedFileTouches`)에서
  // 지금 보는 파일의 원격에 없는 커밋을 찾는다. repoPath는 캐시 키일 뿐 이 조회에 쓰이지 않으니
  // 워크트리 경로를 그대로 넣는다.
  const touchTargets = useMemo(() => [{ repoPath: path, path, branch: null }], [path]);
  const [touchesResult] = useUnpushedFileTouches(touchTargets);
  const shownTouches =
    shown && touchesResult?.status === "success"
      ? touchesResult.data.files.find((f) => f.path === shown.path)
      : undefined;
  const followLineNote = shown ? followNote(t, shown, shownTouches?.commits ?? []) : null;

  const handlePause = () => pause(shown?.path ?? pausedOn);
  const handleResume = () => {
    setDiffClosed(false);
    if (isTarget) resume();
    else start(path);
  };

  // 사용자가 diff를 직접 움직이면(휠, 스크롤바·본문 누르기, 키) 따라가기를 멈춘다.
  // 따라가기가 줄을 옮기는 스크롤은 이 이벤트를 내지 않는다. 안내 상자 안의 누름과 diff 머리
  // (모드 전환·찾기·크게 보기 버튼)는 뺀다 — 그건 diff를 옮기는 게 아니라 보는 방식을 바꾸는 것이다.
  const handleIntervention = (e: SyntheticEvent) => {
    if (!following) return;
    if (e.target instanceof Element && e.target.closest("[data-follow-toast], [data-diff-header]")) return;
    handlePause();
  };

  // 파일 우클릭: 그 파일을 고르고(따라가기가 멈춘다) 파일 메뉴를 연다. 저장소 화면(`cards`)은 스테이징 목록과
  // 같은 메뉴(스테이지·되돌리기 포함), 워크스페이스 화면(`inline`)은 읽기 전용 메뉴다 — 거기서는 스테이징하지 않는다.
  const workingMenu = useWorkingFileMenu(path);
  const readOnlyMenu = useFileMenu();
  const fileMenu = variant === "cards" ? workingMenu : readOnlyMenu;
  const openFileMenu = (filePath: string, e: React.MouseEvent) => {
    e.preventDefault();
    const file = list.find((f) => f.path === filePath);
    if (!file) return;
    pickFile(filePath);
    const point = contextMenuPoint(e);
    if (variant === "cards") workingMenu.openMenu(wipEntry(file), point);
    else readOnlyMenu.open({ repoPath: path, filePath, exists: file.status !== "deleted" }, point);
  };

  // 파일 더블클릭: 편집기에서 연다(스테이징 여부와 무관하게 워크트리 경로 기준).
  const openFileInEditor = useOpenFileInEditor();
  const handleFileDoubleClick = (filePath: string) => {
    const file = list.find((f) => f.path === filePath);
    openFileInEditor(path, filePath, file?.status !== "deleted");
  };

  // 크게 보기 머리 줄. 파일마다 다른 diff 머리의 ModifiedAgo와 달리, 목록 전체(정렬 시각 순 맨 위)의
  // 최근 수정 시각을 한 번만 보인다.
  const origin: MaximizedOrigin = {
    kind: "follow",
    label: (
      <>
        <span className="italic text-(--fg2) shrink-0">{t("live.uncommitted")}</span>
        {branch && <RefLabel name={branch} kind="local" className="max-w-[200px]" />}
        {following && <FollowBadge mode="following" />}
      </>
    ),
    meta: [t("live.fileCount", { count: list.length }), list[0]?.modifiedAt != null ? formatRelativeTime(list[0].modifiedAt) : null]
      .filter(Boolean)
      .join(" · "),
  };

  // 크게 보는 diff 옆 파일 목록. 같은 목록·선택을 쓴다(고르면 따라가기가 멈추는 것도 같다).
  const maximizedFiles: MaximizedFiles = {
    items: list.map((f) => ({
      key: f.path,
      path: f.path,
      status: f.status,
      additions: f.insertions,
      deletions: f.deletions,
    })),
    selectedKey: shown?.path ?? null,
    onSelect: pickFile,
    onContextMenu: openFileMenu,
    onDoubleClick: handleFileDoubleClick,
  };

  const listPane = (
    <>
      {switcher === undefined ? variant === "cards" ? <RepoWorkSwitcher mode="working" /> : null : switcher}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 shrink-0">
        <strong className="text-[12.5px] font-bold text-foreground">{t("live.uncommitted")}</strong>
        <span className="text-[11.5px] text-muted-foreground">{t("live.fileCount", { count: list.length })}</span>
        <span className="flex-1" />
        <FollowBadge mode={following ? "following" : "paused"} />
      </div>
      {header}
      <SectionLabel
        title={t("live.sortedByTime")}
        trailing={
          following ? (
            <Button variant="ghost" size="sm" onClick={handlePause}>
              {t("live.pause")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleResume}>
              {t("live.resume")}
            </Button>
          )
        }
      />
      {isError ? (
        <div className="px-3 py-2">
          <Notice tone="danger">{t("live.loadFailed")}</Notice>
        </div>
      ) : isLoading ? (
        <LoadingState layout="row" label={t("diff.loadingDiff")} />
      ) : list.length === 0 ? (
        <EmptyState layout="row" title={t("live.noChanges")} />
      ) : (
        <FollowFileList
          files={list}
          selected={shown?.path ?? null}
          overlap={overlap}
          justChanged={justChanged}
          onPick={pickFile}
          onDoubleClick={handleFileDoubleClick}
          onContextMenu={openFileMenu}
        />
      )}
      {footer && (
        <div className="mt-auto flex flex-col gap-2 px-3 py-2.5 shrink-0 border-t border-(--line)">{footer}</div>
      )}
    </>
  );

  const diffPane = (
    <div
      className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
      data-testid="follow-diff"
      onWheelCapture={handleIntervention}
      onPointerDownCapture={handleIntervention}
      onKeyDownCapture={handleIntervention}
    >
      {shown === null ? (
        pausedGone ? (
          <EmptyState
            icon={FileText}
            title={t("live.pickedGone", { file: pausedOn })}
            action={
              <Button size="sm" variant="secondary" onClick={handleResume}>
                {t("live.resume")}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={FileText} title={t("live.waiting")} />
        )
      ) : diffError ? (
        <div className="flex-1 flex items-center justify-center p-3">
          <Notice tone="danger">{t("diff.failedToLoad")}</Notice>
        </div>
      ) : diffLoading && !diff ? (
        <LoadingState label={t("diff.loadingDiff")} />
      ) : (
        <>
          {isTarget && (
            <FollowLine mode={mode} pinnedFile={pausedOn} onResume={handleResume} note={followLineNote} />
          )}
          {shownSiblings.length > 0 && siblingFilePath && (
            <OverlapBanner
              filePath={siblingFilePath}
              mine={diff}
              siblings={shownSiblings}
              onSideBySide={() => {
                // 나란히 보기를 여는 것도 사용자 개입이다 — 멈춰야 보는 동안 파일이 바뀌지 않는다.
                if (following) handlePause();
                setSideBySideOf(shown.path);
              }}
            />
          )}
          <DiffViewer
            diff={diff ?? null}
            status={shown.status}
            staged={staged}
            freshLines={freshLines}
            freshAt={fresh?.at ?? null}
            maximizable
            repoPath={path}
            // 따라가는 중에만 새 줄로 옮긴다. 멈춘 동안은 사용자가 보던 자리를 지키고 줄 표시만 바뀐다.
            revealLine={following && fresh ? (fresh.delta.ranges[0]?.start ?? null) : null}
            headerExtra={
              <>
                {partlyStaged && (
                  <StagedSideToggle
                    staged={staged}
                    onChange={(next) => {
                      // 볼 쪽을 고르는 것도 사용자가 화면을 잡는 것이다 — 그 파일에 머문다.
                      if (following) handlePause();
                      setSidePick({ path: shown.path, staged: next });
                    }}
                  />
                )}
                {shown.modifiedAt !== null && <ModifiedAgo at={shown.modifiedAt} />}
              </>
            }
          />
        </>
      )}
      {toastOpen && fresh && (
        <div
          data-follow-toast
          role="status"
          className={cn(
            FLOATING_SURFACE,
            "absolute right-4 top-12 z-10 flex items-center gap-2.5 py-2 pl-3 pr-2 rounded-(--radius-item) text-[12.5px] text-foreground animate-pop-in",
          )}
        >
          <Dot on live />
          {freshMessage(t, fresh.delta)}
          <Button size="sm" variant="secondary" onClick={following ? handlePause : handleResume}>
            {following ? t("live.pause") : t("live.resume")}
          </Button>
        </div>
      )}
    </div>
  );

  const sideBySide =
    sideBySideOpen && shown ? (
      <SideBySideDiff
        filePath={shown.path}
        theirFilePath={siblingFilePath ?? shown.path}
        mine={{ path, branch: null, staged }}
        siblings={shownSiblings}
        onClose={() => setSideBySideOf(null)}
      />
    ) : null;

  if (variant === "cards") {
    return (
      <ListDiffSplit
        variant="cards"
        data-testid="follow-panel"
        list={listPane}
        listOverlay={<SwitchingOverlay />}
        files={maximizedFiles}
        origin={origin}
        onCloseFile={() => setDiffClosed(true)}
        detail={diffPane}
        detailOverlay={<SwitchingOverlay />}
      >
        {sideBySide}
        {fileMenu.element}
      </ListDiffSplit>
    );
  }
  return (
    <ListDiffSplit
      variant="inline"
      data-testid="follow-panel"
      list={listPane}
      detail={diffPane}
      files={maximizedFiles}
      origin={origin}
      onCloseFile={() => setDiffClosed(true)}
    >
      {sideBySide}
      {fileMenu.element}
    </ListDiffSplit>
  );
}

/** 「모두 스테이지」가 넘길 경로: 스테이지 안 된 변경이 있는 파일(충돌 파일은 하나씩 해결하므로 뺀다). */
export function stageAllPaths(files: WipFile[]): string[] {
  const paths = new Set<string>();
  for (const f of files) {
    if (!f.unstaged || f.status === "conflicted") continue;
    paths.add(f.path);
    if (f.status === "renamed" && f.origPath) paths.add(f.origPath);
  }
  return [...paths];
}

/**
 * 저장소 화면의 따라가기 칸 아래(시안 D4). 지금 연 워크트리면 「모두 스테이지 / 커밋… / Stash」를
 * 바로 쓴다. 「커밋…」은 따라가기를 끝내 커밋 입력이 있는 스테이징 목록을 보여 준다.
 * 다른 워크트리면 그 워크트리를 연다(열리면 활성 경로가 바뀌어 따라가기가 끝나고
 * 그 워크트리의 스테이징 목록이 보인다).
 */
export function FollowRepoFooter({ path }: { path: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const stop = useFollowStore((s) => s.stop);
  const { data: worktreeList = [] } = useWorktrees(activeRepoPath);
  const openWorktree = useOpenWorktree(activeRepoPath, worktreeList);
  const { data: files = [] } = useWipFiles(path);
  const stashMutations = useStashMutations(activeRepoPath);
  const [busy, setBusy] = useState(false);
  const isCurrent = activeRepoPath !== null && samePath(activeRepoPath, path);
  const toStage = stageAllPaths(files);

  const handleStageAll = async () => {
    if (toStage.length === 0) return;
    setBusy(true);
    try {
      await stageFiles(path, toStage);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
        queryClient.invalidateQueries({ queryKey: ["wipFiles", path] }),
      ]);
    } catch (err) {
      addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
    } finally {
      setBusy(false);
    }
  };

  // 툴바의 Stash와 같은 결과를 낸다(메시지 없이 전부 넣는다).
  const handleStash = async () => {
    setBusy(true);
    try {
      const oid = await stashMutations.push.mutateAsync(undefined);
      if (oid === null) {
        addToast(t("stash.nothingToSave"), "info");
        return;
      }
      useSelectionStore.getState().clearFileSelection();
      await queryClient.invalidateQueries({ queryKey: ["wipFiles", path] });
      addToast(t("stash.saved"), "success");
    } catch (err) {
      addToast(t("stash.failedToSave", { error: getErrorMessage(err) }), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="text-[11.5px] text-muted-foreground">{t("live.footerHint")}</span>
      <div className="flex flex-wrap gap-1.5">
        {isCurrent ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={toStage.length === 0}
              busy={busy}
              onClick={() => void handleStageAll()}
            >
              {t("live.stageAll")}
            </Button>
            <Button variant="secondary" size="sm" onClick={stop}>
              {t("live.commit")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={files.length === 0}
              busy={busy}
              onClick={() => void handleStash()}
            >
              {t("live.stash")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void openWorktree(path)}>
            {t("live.openWorktree")}
          </Button>
        )}
      </div>
    </>
  );
}

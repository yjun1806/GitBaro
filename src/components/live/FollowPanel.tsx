import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { RepoWorkSwitcher } from "@/components/commit/WorkSwitcher";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { fetchFileDiff, useFileDiff, useStashMutations, useWipFiles, useWorktrees } from "@/api/queries";
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
import { FileStatusBadge } from "@/lib/file-status";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { normalizePath } from "@/components/graph/graph-model";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import {
  OverlapBanner,
  OverlapMark,
  useWorktreeOverlap,
  type WorktreeOverlap,
} from "@/components/worktree/OverlapBadge";
import { SideBySideDiff } from "@/components/worktree/SideBySideDiff";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import type { MaximizedFiles } from "@/components/layout/maximized-files";
import type { ActivityEvent, DiffOutput, StatusEntry, WipFile } from "@/types";
import { useWorkingFileMenu } from "@/components/commit/useWorkingFileMenu";
import { useFileMenu } from "@/components/commit/useFileMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";

/** `registerWatchPaths`에 쓰는 이 화면의 key. 감시 대상 목록에서 맨 앞에 온다. */
export const FOLLOW_WATCH_KEY = FOLLOW_KEY;
/**
 * 감시에 들어가지 못해 `repo:activity`가 오지 않는 경로만(상한 초과 또는 감시 실패)
 * 이 주기로 파일 목록과 diff를 다시 읽는다.
 */
export const OVERFLOW_POLL_MS = 5_000;
/** 따라가기를 시작할 때 비교 기준으로 내용을 기억해 두는 파일 수의 상한(최근 수정 순). */
const BASELINE_LIMIT = 30;
/** 「방금 N행이 추가됐어요」 안내를 띄워 두는 시간. 줄 강조는 다음 변경까지 남는다. */
const TOAST_MS = 8_000;

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** 「따라가는 중」·「따라가기 멈춤」 알약. WIP 행과 파일 목록 머리에 붙는다. */
export function FollowBadge({ mode }: { mode: FollowMode }) {
  const { t } = useTranslation();
  const following = mode === "following";
  return (
    <span
      data-testid="follow-badge"
      className={cn(
        "inline-flex items-center gap-[5px] shrink-0 h-5 px-2 rounded-full text-[11px] font-bold",
        following ? "bg-(--live-soft) text-(--live)" : "bg-(--chip) text-muted-foreground",
      )}
    >
      <span
        className={cn("w-1.5 h-1.5 rounded-full", following ? "bg-(--live)" : "bg-(--faint)")}
        aria-hidden="true"
      />
      {following ? t("live.following") : t("live.paused")}
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

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    listen<ActivityEvent>("repo:activity", (event) => {
      if (!mounted || !samePath(event.payload.path, path)) return;
      refreshFollowed(queryClient, path);
    })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 이벤트를 못 받으면 다음에 고를 때 다시 읽는다 */
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [path, queryClient]);

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

/** 초 단위 표시가 흐르도록 1초마다 다시 그린다. 파일 목록만 다시 그리게 이 안에서만 쓴다. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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
  const options = [
    { value: false, label: t("live.showUnstaged") },
    { value: true, label: t("live.showStaged") },
  ];
  return (
    <div role="group" className="flex p-0.5 rounded-[7px] bg-(--chip)">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={staged === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-[20px] px-2 rounded-[5px] text-[11px] transition-colors",
            staged === o.value ? "bg-card font-semibold text-foreground shadow-(--shadow-sm)" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FollowFileList({
  files,
  selected,
  overlap,
  onPick,
  onContextMenu,
}: {
  files: WipFile[];
  selected: string | null;
  /** 다른 워크트리도 고치는 파일(⧉, 시안 D5). */
  overlap: WorktreeOverlap;
  onPick: (path: string) => void;
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
            onContextMenu={(e) => onContextMenu(f.path, e)}
            className={cn(
              "w-full flex items-center gap-2 min-h-(--row) px-3 text-left border-b border-(--line) transition-colors",
              f.path === selected
                ? "bg-(--acc-sel)"
                : activeIndex === index
                  ? "bg-accent ring-1 ring-inset ring-primary/30"
                  : "hover:bg-accent",
            )}
          >
            <FileStatusBadge status={f.status} />
            <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">
              <span>{name}</span>
              {dir && <span className="ml-1.5 text-[11px] text-(--faint)">{dir}</span>}
            </span>
            <OverlapMark siblings={overlap.of(f)} />
            {f.staged && (
              <span className="shrink-0 text-[10.5px] text-(--faint)">
                {f.unstaged ? t("live.partlyStaged") : t("live.staged")}
              </span>
            )}
            {seconds !== null && (
              <span
                className={cn(
                  "shrink-0 text-[10.5px]",
                  recent && index === 0 ? "font-bold text-(--live)" : "text-(--faint)",
                )}
              >
                {recent ? t("live.secondsAgo", { count: seconds }) : formatRelativeTime(f.modifiedAt!)}
              </span>
            )}
            {f.insertions !== null && (
              <span className="shrink-0 font-mono text-[11px] text-success">+{f.insertions}</span>
            )}
            {f.deletions ? <span className="shrink-0 font-mono text-[11px] text-danger">−{f.deletions}</span> : null}
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
 * 따라가는 중에는 가장 최근 파일을 자동으로 골라 방금 생긴 줄을 강조한다.
 * 사용자가 파일을 고르거나 diff를 스크롤하면 멈춘다.
 */
export function FollowPanel({ path, variant, header, footer, switcher }: FollowPanelProps) {
  const { t } = useTranslation();
  const target = useFollowStore((s) => s.target);
  const mode = useFollowStore((s) => s.mode);
  const pickedFile = useFollowStore((s) => s.file);
  const start = useFollowStore((s) => s.start);
  const pause = useFollowStore((s) => s.pause);
  const pickFile = useFollowStore((s) => s.pickFile);
  const resume = useFollowStore((s) => s.resume);

  const isTarget = target !== null && samePath(target, path);
  const following = isTarget && mode === "following";

  // 감시에 들어가지 못한 경로(상한 초과·감시 실패)는 이벤트가 없으니 목록과 diff를 주기적으로 읽는다.
  const polled = useLiveChangesStore((s) => s.overflow.some((p) => samePath(p, path)));
  useFollowRefresh(path, polled);
  const { data: files, isLoading, isError } = useWipFiles(path);
  const list = useMemo(() => files ?? [], [files]);

  // 멈춘 동안 보던 파일이 목록에서 빠지면(커밋·되돌림) 다른 파일로 넘어가지 않는다 —
  // 넘어가면 「멈춤」인데도 가장 최근 파일을 따라가는 것과 같아진다.
  const pausedOn = isTarget && mode === "paused" ? pickedFile : null;
  const pausedGone = pausedOn !== null && files !== undefined && !list.some((f) => f.path === pausedOn);
  const wanted = following ? list[0]?.path : pausedOn;
  const shown = pausedGone ? null : (list.find((f) => f.path === wanted) ?? list[0] ?? null);

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

  const handlePause = () => pause(shown?.path ?? pausedOn);
  const handleResume = () => (isTarget ? resume() : start(path));

  // 사용자가 diff를 직접 움직이면(휠, 스크롤바·본문 누르기, 키) 따라가기를 멈춘다.
  // 따라가기가 줄을 옮기는 스크롤은 이 이벤트를 내지 않는다. 안내 상자 안의 누름은 뺀다.
  const handleIntervention = (e: SyntheticEvent) => {
    if (!following) return;
    if (e.target instanceof Element && e.target.closest("[data-follow-toast]")) return;
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
      <div className="flex items-center gap-2 px-3 py-1 shrink-0 text-[11px] font-semibold text-(--faint)">
        <span className="flex-1">{t("live.sortedByTime")}</span>
        {following ? (
          <button
            type="button"
            onClick={handlePause}
            className="h-5 px-1.5 rounded-(--radius-chip) text-(--fg2) hover:bg-accent transition-colors"
          >
            {t("live.pause")}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleResume}
            className="h-5 px-1.5 rounded-(--radius-chip) text-(--live) hover:bg-accent transition-colors"
          >
            {t("live.resume")}
          </button>
        )}
      </div>
      {isError ? (
        <p className="px-3 py-2 text-xs text-danger">{t("live.loadFailed")}</p>
      ) : isLoading ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("diff.loadingDiff")}</p>
      ) : list.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("live.noChanges")}</p>
      ) : (
        <FollowFileList
          files={list}
          selected={shown?.path ?? null}
          overlap={overlap}
          onPick={pickFile}
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
        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <FileText className="w-8 h-8" aria-hidden="true" />
          {pausedGone ? (
            <>
              <p className="text-sm">{t("live.pickedGone", { file: pausedOn })}</p>
              <button
                type="button"
                onClick={handleResume}
                className="h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--live) hover:bg-accent transition-colors"
              >
                {t("live.resume")}
              </button>
            </>
          ) : (
            <p className="text-sm">{t("live.waiting")}</p>
          )}
        </div>
      ) : diffError ? (
        <div className="flex-1 flex items-center justify-center text-sm text-danger">{t("diff.failedToLoad")}</div>
      ) : diffLoading && !diff ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t("diff.loadingDiff")}
        </div>
      ) : (
        <>
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
            maximizable
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
          className="absolute right-4 top-12 z-10 flex items-center gap-2.5 py-2 pl-3 pr-2 rounded-(--radius-item) bg-foreground text-background text-[12px] shadow-(--shadow)"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-(--live)" aria-hidden="true" />
          {freshMessage(t, fresh.delta)}
          <button
            type="button"
            onClick={following ? handlePause : handleResume}
            className="h-[22px] px-2 rounded-[6px] bg-background/15 text-[11.5px] hover:bg-background/25 transition-colors"
          >
            {following ? t("live.pause") : t("live.resume")}
          </button>
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
        detail={diffPane}
        detailOverlay={<SwitchingOverlay />}
      >
        {sideBySide}
        {fileMenu.element}
      </ListDiffSplit>
    );
  }
  return (
    <ListDiffSplit variant="inline" data-testid="follow-panel" list={listPane} detail={diffPane} files={maximizedFiles}>
      {sideBySide}
      {fileMenu.element}
    </ListDiffSplit>
  );
}

const FOOTER_BUTTON =
  "h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none";

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
            <button
              type="button"
              disabled={busy || toStage.length === 0}
              onClick={() => void handleStageAll()}
              className={FOOTER_BUTTON}
            >
              {t("live.stageAll")}
            </button>
            <button type="button" onClick={stop} className={FOOTER_BUTTON}>
              {t("live.commit")}
            </button>
            <button
              type="button"
              disabled={busy || files.length === 0}
              onClick={() => void handleStash()}
              className={FOOTER_BUTTON}
            >
              {t("live.stash")}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void openWorktree(path)} className={FOOTER_BUTTON}>
            {t("live.openWorktree")}
          </button>
        )}
      </div>
    </>
  );
}

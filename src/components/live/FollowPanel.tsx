import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useFileDiff, useWipFiles, useWorktrees } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useFollowStore, type FollowMode } from "@/stores/follow";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { diffDelta, type DiffDelta } from "@/lib/diff-delta";
import { FileStatusBadge } from "@/lib/file-status";
import { cn, formatRelativeTime } from "@/lib/utils";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import type { ActivityEvent, DiffOutput, WipFile } from "@/types";

/** `registerWatchPaths`에 쓰는 이 화면의 key. */
export const FOLLOW_WATCH_KEY = "follow";
/** 감시 상한(40곳)을 넘겨 `repo:activity`가 오지 않는 경로만 이 주기로 다시 읽는다. */
const OVERFLOW_POLL_MS = 5_000;
/** 「방금 N행이 추가됐어요」 안내를 띄워 두는 시간. 줄 강조는 다음 변경까지 남는다. */
const TOAST_MS = 8_000;

function samePath(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
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

/**
 * 따라가는 경로의 `repo:activity`를 받아 파일 목록과 diff를 다시 읽는다. 활동 감시는
 * 가장 깊은 감시 경로에만 기록하므로(W1-T3) 워크트리 경로와 같은 이벤트만 본다.
 * 활성 저장소가 아니어도 된다 — 따라가는 경로를 감시 대상에 직접 넣는다.
 */
function useFollowRefresh(path: string): void {
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
      void queryClient.invalidateQueries({ queryKey: ["wipFiles", path] });
      void queryClient.invalidateQueries({ queryKey: ["fileDiff", path] });
    })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 이벤트를 못 받으면 감시 상한 때와 같은 주기 읽기도 없다 — 다음에 고를 때 다시 읽는다 */
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [path, queryClient]);
}

interface FreshChange {
  /** 어느 파일(경로 + 스테이징 쪽)의 변경인지. */
  key: string;
  delta: DiffDelta;
  at: number;
}

/**
 * 같은 파일을 다시 읽을 때마다 직전 내용과 비교해 새로 생긴 줄을 찾는다.
 * 목록에 처음 나타난 파일(방금까지 깨끗했던 파일)은 비교 기준이 HEAD·인덱스 쪽 내용(`oldContent`)이다.
 */
function useFreshLines(files: WipFile[] | undefined, key: string | null, diff: DiffOutput | undefined) {
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

  useEffect(() => {
    if (!key || !diff || diff.binary) return;
    const path = key.split("\u0000")[0];
    if (diff.filePath !== path) return;
    const prev =
      snapshots.current.get(key) ??
      (origins.current.get(path) === "appeared" ? diff.oldContent : undefined);
    snapshots.current = new Map(snapshots.current).set(key, diff.newContent);
    if (prev === undefined || prev === diff.newContent) return;
    const delta = diffDelta(prev, diff.newContent);
    if (delta.added.length === 0 && delta.removedCount === 0) return;
    setFresh({ key, delta, at: Date.now() });
  }, [key, diff]);

  return fresh !== null && fresh.key === key ? fresh : null;
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

function FollowFileList({
  files,
  selected,
  onPick,
}: {
  files: WipFile[];
  selected: string | null;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const now = useNow(1_000);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" role="list">
      {files.map((f, index) => {
        const seconds = f.modifiedAt === null ? null : Math.max(0, Math.floor(now / 1000 - f.modifiedAt));
        const recent = seconds !== null && seconds < 60;
        const slash = f.path.lastIndexOf("/");
        const name = slash >= 0 ? f.path.slice(slash + 1) : f.path;
        const dir = slash >= 0 ? f.path.slice(0, slash) : "";
        return (
          <button
            key={f.path}
            type="button"
            role="listitem"
            title={f.path}
            aria-current={f.path === selected || undefined}
            onClick={() => onPick(f.path)}
            className={cn(
              "w-full flex items-center gap-2 min-h-(--row) px-3 text-left border-b border-(--line) transition-colors",
              f.path === selected ? "bg-(--acc-sel)" : "hover:bg-accent",
            )}
          >
            <FileStatusBadge status={f.status} />
            <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">
              <span>{name}</span>
              {dir && <span className="ml-1.5 text-[11px] text-(--faint)">{dir}</span>}
            </span>
            {f.staged && !f.unstaged && (
              <span className="shrink-0 text-[10.5px] text-(--faint)">{t("live.staged")}</span>
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
  /** 목록 아래에 둘 것(스테이징·커밋으로 가는 버튼 등). */
  footer?: ReactNode;
}

/**
 * 실시간 따라가기(D4). 워크트리의 커밋하지 않은 파일을 수정 시각 순으로 보여 주고,
 * 따라가는 중에는 가장 최근 파일을 자동으로 골라 방금 생긴 줄을 강조한다.
 * 사용자가 파일을 고르거나 diff를 스크롤하면 멈춘다.
 */
export function FollowPanel({ path, variant, header, footer }: FollowPanelProps) {
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

  useFollowRefresh(path);
  const watched = useLiveChangesStore((s) => !s.overflow.includes(path));
  const { data: files, isLoading, isError } = useWipFiles(path, watched ? false : OVERFLOW_POLL_MS);
  const list = useMemo(() => files ?? [], [files]);

  const wanted = following ? list[0]?.path : isTarget ? pickedFile : null;
  const shown = list.find((f) => f.path === wanted) ?? list[0] ?? null;
  // 스테이징만 하고 작업 트리는 그대로인 파일은 스테이징 쪽을 보여 준다.
  const staged = shown !== null && shown.staged && !shown.unstaged;
  const { data: diff, isLoading: diffLoading, isError: diffError } = useFileDiff(
    path,
    shown?.path ?? null,
    staged,
  );
  const diffKey = shown ? `${shown.path}\u0000${staged}` : null;
  const fresh = useFreshLines(files, diffKey, diff);
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

  const handlePause = () => pause(shown?.path ?? null);
  const handleResume = () => (isTarget ? resume() : start(path));

  // 사용자가 diff를 직접 움직이면(휠, 스크롤바·본문 누르기, 키) 따라가기를 멈춘다.
  // 따라가기가 줄을 옮기는 스크롤은 이 이벤트를 내지 않는다. 안내 상자 안의 누름은 뺀다.
  const handleIntervention = (e: SyntheticEvent) => {
    if (!following) return;
    if (e.target instanceof Element && e.target.closest("[data-follow-toast]")) return;
    handlePause();
  };

  const listPane = (
    <>
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
        <FollowFileList files={list} selected={shown?.path ?? null} onPick={pickFile} />
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
          <p className="text-sm">{t("live.waiting")}</p>
        </div>
      ) : diffError ? (
        <div className="flex-1 flex items-center justify-center text-sm text-danger">{t("diff.failedToLoad")}</div>
      ) : diffLoading && !diff ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t("diff.loadingDiff")}
        </div>
      ) : (
        <DiffViewer
          diff={diff ?? null}
          status={shown.status}
          staged={staged}
          freshLines={freshLines}
          revealLine={following && fresh ? (fresh.delta.ranges[0]?.start ?? null) : null}
        />
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

  if (variant === "cards") {
    return (
      <div className="flex flex-1 min-h-0 gap-(--g)" data-testid="follow-panel">
        <section className="relative flex flex-col w-[320px] shrink-0 min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden">
          {listPane}
          <SwitchingOverlay />
        </section>
        <section className="relative flex flex-col flex-1 min-w-0 min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden">
          {diffPane}
          <SwitchingOverlay />
        </section>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0" data-testid="follow-panel">
      <div className="w-[300px] shrink-0 flex flex-col min-h-0 border-r border-(--line)">{listPane}</div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{diffPane}</div>
    </div>
  );
}

/**
 * 저장소 화면의 따라가기 칸 아래 버튼. 지금 연 워크트리면 따라가기를 끝내 스테이징 목록으로
 * 돌아가고, 다른 워크트리면 그 워크트리를 연다(열리면 활성 경로가 바뀌어 따라가기가 끝나고
 * 그 워크트리의 스테이징 목록이 보인다).
 */
export function FollowRepoFooter({ path }: { path: string }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const stop = useFollowStore((s) => s.stop);
  const { data: worktreeList = [] } = useWorktrees(activeRepoPath);
  const openWorktree = useOpenWorktree(activeRepoPath, worktreeList);
  const isCurrent = activeRepoPath !== null && samePath(activeRepoPath, path);
  return (
    <>
      <span className="text-[11.5px] text-muted-foreground">{t("live.footerHint")}</span>
      <button
        type="button"
        onClick={() => (isCurrent ? stop() : void openWorktree(path))}
        className="self-start h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
      >
        {isCurrent ? t("live.openStaging") : t("live.openWorktree")}
      </button>
    </>
  );
}

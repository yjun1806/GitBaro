import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { cn } from "@/lib/utils";
import { useRepositoryStore } from "@/stores/repository";
import { isLivePath } from "./tree-model";
import { useWorktreeBases } from "./useWorktreeBases";
import type { SidebarTreeData } from "./useSidebarTreeData";

/** 마우스를 올린 뒤 카드가 뜨기까지(ms). 지나가는 마우스에는 뜨지 않는다. */
export const HOVER_CARD_DELAY_MS = 400;
/** 카드와 사이드바 오른쪽 끝 사이 틈(px) */
const CARD_GAP_PX = 8;
const CARD_WIDTH_PX = 260;

/** 자세한 정보 카드가 설명하는 대상. */
export type HoverSubject =
  | { kind: "repo"; repoPath: string; paths: string[] }
  | { kind: "worktree"; repoPath: string; path: string; isPrimary: boolean }
  | { kind: "branch"; repoPath: string; branch: string };

interface HoverCardApi {
  show: (subject: HoverSubject, anchor: HTMLElement) => void;
  hide: () => void;
}

const NOOP: HoverCardApi = { show: () => {}, hide: () => {} };
const HoverCardContext = createContext<HoverCardApi>(NOOP);

export function useSidebarHoverCard(): HoverCardApi {
  return useContext(HoverCardContext);
}

interface Placement {
  subject: HoverSubject;
  /** 카드가 가리키는 줄. 이 줄이 화면에서 빠지면(접기·목록 갱신) 카드를 닫는다. */
  anchor: HTMLElement;
  top: number;
  left: number;
}

/**
 * 사이드바 행의 자세한 정보 카드(층 3). 한 줄 행에 들어가지 않는 내용(폴더 경로, 기본 폴더인지,
 * 갈라진 브랜치, 커밋 안 한 파일과 바뀐 시각, 올릴·받을 커밋)을 사이드바 오른쪽에 띄운다.
 * 마우스를 400ms 올려 두거나 키보드 초점을 받으면 뜨고, 떠나면 바로 사라진다.
 * 누르기를 가로채지 않도록 포인터 이벤트를 받지 않는다.
 */
export function SidebarHoverCardProvider({ data, children }: { data: SidebarTreeData; children: ReactNode }) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const hide = useCallback(() => {
    clearTimer();
    setPlacement(null);
  }, []);

  const show = useCallback((subject: HoverSubject, anchor: HTMLElement) => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      // 기다리는 사이 줄이 사라졌으면 띄우지 않는다(떨어진 요소는 크기가 0이라 왼쪽 위 구석에 뜬다).
      if (!anchor.isConnected) return;
      const row = anchor.getBoundingClientRect();
      const edge = anchor.closest("[data-sidebar-panel]")?.getBoundingClientRect().right ?? row.right;
      const maxTop = Math.max(8, window.innerHeight - 180);
      setPlacement({ subject, anchor, top: Math.min(Math.max(8, row.top - 4), maxTop), left: edge + CARD_GAP_PX });
    }, HOVER_CARD_DELAY_MS);
  }, []);

  useEffect(() => clearTimer, []);

  // 목록이 스크롤되면 카드가 가리키던 줄에서 떨어지므로 닫는다.
  useEffect(() => {
    if (!placement) return;
    document.addEventListener("scroll", hide, true);
    return () => document.removeEventListener("scroll", hide, true);
  }, [placement, hide]);

  // 카드가 떠 있는 동안 가리키던 줄이 사라지면(행이 unmount되면 mouseleave·blur가 오지 않는다) 닫는다.
  useEffect(() => {
    if (!placement || typeof MutationObserver === "undefined") return;
    const { anchor } = placement;
    const observer = new MutationObserver(() => {
      if (!anchor.isConnected) hide();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [placement, hide]);

  const api = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <HoverCardContext.Provider value={api}>
      {children}
      {placement &&
        createPortal(
          <div
            role="tooltip"
            data-testid="sidebar-hover-card"
            className={cn(
              "fixed z-[90] pointer-events-none rounded-(--radius-item) px-3 py-2.5 flex flex-col gap-1 text-[12.5px] animate-fade-in",
              FLOATING_SURFACE,
            )}
            style={{ top: placement.top, left: placement.left, width: CARD_WIDTH_PX }}
          >
            <HoverCardBody subject={placement.subject} data={data} />
          </div>,
          document.body,
        )}
    </HoverCardContext.Provider>
  );
}

/** 「방금 바뀜」·「N분 전 바뀜」·「N시간 전 바뀜」 */
export function changedAgoText(t: TFunction, now: number, at: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t("sidebarTree.card.changedJustNow");
  if (minutes < 60) return t("sidebarTree.card.changedMinutesAgo", { count: minutes });
  return t("sidebarTree.card.changedHoursAgo", { count: Math.floor(minutes / 60) });
}

function Line({ children, muted = false, mono = false }: { children: ReactNode; muted?: boolean; mono?: boolean }) {
  return (
    <p
      className={cn(
        "leading-[17px] break-words",
        muted ? "text-muted-foreground" : "text-(--fg2)",
        mono && "font-mono text-[11.5px] break-all",
      )}
    >
      {children}
    </p>
  );
}

function HoverCardBody({ subject, data }: { subject: HoverSubject; data: SidebarTreeData }) {
  switch (subject.kind) {
    case "worktree":
      return <WorktreeDetails subject={subject} data={data} />;
    case "branch":
      return <BranchDetails subject={subject} />;
    case "repo":
      return <RepoDetails subject={subject} data={data} />;
  }
}

/** 작업 폴더(기본 폴더 또는 링크된 워크트리) 하나의 자세한 상태. */
function WorktreeDetails({
  subject,
  data,
}: {
  subject: Extract<HoverSubject, { kind: "worktree" }>;
  data: SidebarTreeData;
}) {
  const { t } = useTranslation();
  const { path, isPrimary, repoPath } = subject;
  const bases = useWorktreeBases(isPrimary ? null : repoPath, isPrimary ? [] : [path]);
  const base = bases[path];
  const branch = data.branchOf(path);
  const head = data.reviewByPath[path]?.headOid ?? null;
  const sync = data.syncByPath[path];
  const signals = data.signals[path];
  const dirty = signals?.dirtyCount ?? 0;
  const ahead = signals?.ahead ?? 0;
  const behind = signals?.behind ?? 0;
  const changedAt = data.lastChangedAt[path] ?? sync?.dirtyLatestMtime ?? null;
  const live = isLivePath(path, data.lastChangedAt, data.now);
  const notPublished = sync !== undefined && !sync.hasUpstream && branch !== null;

  return (
    <>
      <p className="font-mono text-[12.5px] font-semibold text-foreground break-all">
        {branch ?? (head ? `${t("sidebarTree.card.detached")} · ${head.slice(0, 7)}` : t("sidebarTree.card.detached"))}
      </p>
      {isPrimary && (
        <Line>
          <span className="font-semibold text-foreground">{t("sidebarTree.card.primaryFolder")}</span>
          {" · "}
          {t("worktree.primaryFolderHint")}
        </Line>
      )}
      <Line muted mono>
        {path}
      </Line>
      {base && <Line>{t("sidebarTree.card.forkedFrom", { base: base.name })}</Line>}
      {dirty > 0 && (
        <Line>
          <span className="text-(--live) font-semibold">{t("sidebarTree.card.uncommitted", { count: dirty })}</span>
          {changedAt !== null && ` · ${changedAgoText(t, data.now, changedAt)}`}
        </Line>
      )}
      {dirty === 0 && live && changedAt !== null && <Line>{changedAgoText(t, data.now, changedAt)}</Line>}
      {ahead > 0 && <Line>{t("sidebarTree.card.toPush", { count: ahead })}</Line>}
      {notPublished && <Line>{t("sidebarTree.card.notPublished")}</Line>}
      {behind > 0 && <Line>{t("sidebarTree.badge.behind", { count: behind })}</Line>}
      {dirty === 0 && ahead === 0 && behind === 0 && !notPublished && !live && (
        <Line muted>{t("sidebarTree.card.clean")}</Line>
      )}
    </>
  );
}

/** 보기만 하는 기본 브랜치 줄. */
function BranchDetails({ subject }: { subject: Extract<HoverSubject, { kind: "branch" }> }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="font-mono text-[12.5px] font-semibold text-foreground break-all">{subject.branch}</p>
      <Line>{t("sidebarTree.card.viewOnly")}</Line>
    </>
  );
}

/** 저장소 머리 줄: 경로와 작업 폴더 전체의 합계. */
function RepoDetails({ subject, data }: { subject: Extract<HoverSubject, { kind: "repo" }>; data: SidebarTreeData }) {
  const { t } = useTranslation();
  const sum = (pick: (p: string) => number) => subject.paths.reduce((acc, p) => acc + pick(p), 0);
  const dirty = sum((p) => data.signals[p]?.dirtyCount ?? 0);
  const ahead = sum((p) => data.signals[p]?.ahead ?? 0);
  const behind = data.signals[subject.repoPath]?.behind ?? 0;
  const repo = useRepositoryStore((s) => s.repos.find((r) => r.path === subject.repoPath));
  const alias = useRepositoryStore((s) => s.repoPrefs[subject.repoPath]?.alias);
  return (
    <>
      {repo && (
        <p className="text-[12.5px] font-semibold text-foreground break-words">{alias ?? repo.name}</p>
      )}
      {repo && alias && <Line muted>{t("sidebarTree.card.folderName", { name: repo.name })}</Line>}
      <Line muted mono>
        {subject.repoPath}
      </Line>
      <Line>{t("sidebarTree.card.folderCount", { count: subject.paths.length })}</Line>
      {dirty > 0 && (
        <Line>
          <span className="text-(--live) font-semibold">{t("sidebarTree.card.uncommitted", { count: dirty })}</span>
        </Line>
      )}
      {ahead > 0 && <Line>{t("sidebarTree.card.toPush", { count: ahead })}</Line>}
      {behind > 0 && <Line>{t("sidebarTree.badge.behind", { count: behind })}</Line>}
    </>
  );
}

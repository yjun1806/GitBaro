import { useTranslation } from "react-i18next";
import { FileDiff, GitCommitHorizontal } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useUIStore } from "@/stores/ui";
import { useStatus } from "@/api/queries";
import { cn } from "@/lib/utils";
import { useHistoryViewStore, viewTargetFor } from "@/stores/history-view";
import { useOpenWorkingChanges } from "./useOpenWorkingChanges";

/** 아래 칸이 지금 보여 주는 것: 작업 중인 변경(스테이징·커밋 입력) 또는 고른 커밋. */
export type WorkMode = "working" | "commit";

export interface WorkSwitcherProps {
  mode: WorkMode;
  /** 커밋 안 한 파일 수. 모르면 null. */
  workingCount: number | null;
  /** 작업 중인 변경으로 갈 수 없을 때 그 이유(예: 다른 브랜치를 보는 중). 있으면 첫 칸을 끈다. */
  workingDisabledReason?: string | null;
  /** 첫 칸을 껐을 때 보일 글. 빼면 「작업 중인 변경 · 체크아웃한 브랜치에서만」. */
  workingDisabledLabel?: string;
  /** 고른 커밋의 짧은 SHA. 고른 커밋이 없으면 null(둘째 칸을 끈다). */
  commitShortId: string | null;
  onWorking: () => void;
  onCommit: () => void;
}

const SEGMENT =
  "inline-flex items-center gap-1.5 min-w-0 h-[26px] px-2.5 rounded-[6px] text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed";

/**
 * 아래 왼쪽 칸 맨 위의 두 칸 전환: [작업 중인 변경 N] [커밋 <sha>]. 지금 무엇을 보는지 늘 보이고,
 * 누르면 그쪽으로 간다. 커밋을 고르면 둘째 칸으로 옮겨지고, 첫 칸을 누르면 스테이징 목록과 커밋
 * 입력으로 돌아간다(커밋 선택은 풀린다).
 */
export function WorkSwitcher({
  mode,
  workingCount,
  workingDisabledReason = null,
  workingDisabledLabel,
  commitShortId,
  onWorking,
  onCommit,
}: WorkSwitcherProps) {
  const { t } = useTranslation();
  const workingDisabled = workingDisabledReason !== null;
  const segmentClass = (active: boolean) =>
    active
      ? "bg-card text-foreground shadow-(--shadow-sm)"
      : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground disabled:opacity-60";
  return (
    <div
      role="group"
      aria-label={t("workSwitcher.label")}
      data-testid="work-switcher"
      data-mode={mode}
      className="flex items-center gap-0.5 mx-2.5 my-2 p-0.5 rounded-(--radius-item) bg-(--chip) shrink-0"
    >
      <button
        type="button"
        aria-pressed={mode === "working"}
        disabled={workingDisabled}
        title={workingDisabledReason ?? undefined}
        onClick={onWorking}
        className={cn(SEGMENT, "flex-1", segmentClass(mode === "working"))}
      >
        <FileDiff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {workingDisabled
            ? (workingDisabledLabel ?? t("workSwitcher.workingDisabled"))
            : t("workSwitcher.working", { count: workingCount ?? 0 })}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={mode === "commit"}
        disabled={commitShortId === null}
        onClick={onCommit}
        className={cn(SEGMENT, "flex-1", segmentClass(mode === "commit"))}
      >
        <GitCommitHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {commitShortId === null ? (
            t("workSwitcher.noCommit")
          ) : (
            <>
              {t("workSwitcher.commit")} <span className="font-mono">{commitShortId}</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * 저장소 화면의 전환. 커밋 안 한 파일 수는 지금 연 워크트리의 `status`, 고른 커밋은 선택 상태에서 읽는다.
 * 다른 브랜치를 보는 중이면 첫 칸을 끈다(작업 중인 변경은 체크아웃한 브랜치의 것이다).
 */
export function RepoWorkSwitcher({ mode }: { mode: WorkMode }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: status } = useStatus(activeRepoPath);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  // 브랜치 목록을 읽지 않으려고 보기 상태를 바로 읽는다. 체크아웃한 브랜치를 보는 보기는 그래프 쪽이 곧 지운다.
  const target = useHistoryViewStore((s) => viewTargetFor(s, activeRepoPath));
  const openWorking = useOpenWorkingChanges();
  const workingCount = status ? new Set(status.map((e) => e.path)).size : null;
  return (
    <WorkSwitcher
      mode={mode}
      workingCount={workingCount}
      workingDisabledReason={target !== null ? t("workSwitcher.workingDisabledHint") : null}
      commitShortId={selectedCommitId ? selectedCommitId.slice(0, 7) : null}
      onWorking={openWorking}
      onCommit={() => setActiveTab("history")}
    />
  );
}

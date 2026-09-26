import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, CircleCheck, CircleDashed, Clock, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, CircleMinus, XCircle } from "lucide-react";
import { cn, formatDate, formatRelativeTime } from "@/lib/utils";
import type { PrCheck, PrCiState, PrReviewDecision, PrReviewer, PullRequestSummary } from "@/types";
import { isoToSeconds } from "./pr-model";
import { Spinner } from "@/components/ui/Spinner";
import { StatusChip, type StatusTone } from "@/components/ui/marks";

/** GitHub 아바타. 못 불러오면 첫 글자로 둔다. */
export function PrAvatar({ login, url, size = 16 }: { login: string; url: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (url && !failed) {
    return <img src={url} alt="" style={style} className="rounded-full shrink-0" onError={() => setFailed(true)} />;
  }
  return (
    <span
      aria-hidden
      style={style}
      className="rounded-full shrink-0 bg-muted text-muted-foreground flex items-center justify-center text-[9px] font-semibold"
    >
      {login.charAt(0).toUpperCase()}
    </span>
  );
}

/** 「3시간 전」. 마우스를 올리면 정확한 시각. */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const seconds = isoToSeconds(iso);
  if (seconds === null) return null;
  return (
    <time dateTime={iso} title={formatDate(seconds)} className={className}>
      {formatRelativeTime(seconds)}
    </time>
  );
}

/** 열림·초안·병합·닫힘 아이콘. 목록 줄 맨 앞에 둔다. */
export function PrStateIcon({ pr, className }: { pr: Pick<PullRequestSummary, "state" | "isDraft">; className?: string }) {
  const { t } = useTranslation();
  const size = cn("w-4 h-4 shrink-0", className);
  if (pr.state === "merged") return <GitMerge aria-label={t("pr.state.merged")} className={cn(size, "text-info")} />;
  if (pr.state === "closed")
    return <GitPullRequestClosed aria-label={t("pr.state.closed")} className={cn(size, "text-danger")} />;
  if (pr.isDraft)
    return <GitPullRequestDraft aria-label={t("pr.state.draft")} className={cn(size, "text-muted-foreground")} />;
  return <GitPullRequest aria-label={t("pr.state.open")} className={cn(size, "text-success")} />;
}

/** 상세 머리의 상태 배지(글자 포함). */
export function PrStateBadge({ pr }: { pr: Pick<PullRequestSummary, "state" | "isDraft"> }) {
  const { t } = useTranslation();
  const key = pr.state === "open" && pr.isDraft ? "draft" : pr.state;
  const tone: StatusTone = key === "merged" ? "info" : key === "closed" ? "danger" : key === "draft" ? "neutral" : "success";
  return (
    <StatusChip tone={tone} icon={<PrStateIcon pr={pr} className="w-3 h-3 text-current" />}>
      {t(`pr.state.${key}`)}
    </StatusChip>
  );
}

export function DraftChip() {
  const { t } = useTranslation();
  return <StatusChip tone="neutral">{t("pr.state.draft")}</StatusChip>;
}

const REVIEW_TONE: Record<PrReviewDecision, StatusTone> = {
  approved: "success",
  changes_requested: "danger",
  review_required: "warning",
};

export function ReviewDecisionChip({ decision }: { decision: PrReviewDecision }) {
  const { t } = useTranslation();
  return <StatusChip tone={REVIEW_TONE[decision]}>{t(`pr.review.${decision}`)}</StatusChip>;
}

/** CI 종합 상태. 목록과 상세 머리에 둔다. */
export function CiChip({ state }: { state: PrCiState }) {
  const { t } = useTranslation();
  const failed = state === "failure" || state === "error";
  const passed = state === "success";
  const tone: StatusTone = passed ? "success" : failed ? "danger" : "warning";
  return (
    <StatusChip
      tone={tone}
      icon={
        passed ? (
          <CircleCheck className="w-3 h-3" aria-hidden />
        ) : failed ? (
          <XCircle className="w-3 h-3" aria-hidden />
        ) : (
          <CircleDashed className="w-3 h-3" aria-hidden />
        )
      }
    >
      {t(`pr.ci.${state}`)}
    </StatusChip>
  );
}

/** 체크 하나의 상태 아이콘. */
export function CheckIcon({ check }: { check: PrCheck }) {
  const size = "w-3.5 h-3.5 shrink-0";
  if (check.status === "in_progress") return <Spinner className="text-warning" />;
  if (check.status !== "completed") return <Clock className={cn(size, "text-warning")} />;
  switch (check.conclusion) {
    case "success":
      return <CircleCheck className={cn(size, "text-success")} />;
    case "neutral":
    case "skipped":
      return <CircleMinus className={cn(size, "text-muted-foreground")} />;
    case "cancelled":
    case "stale":
      return <Ban className={cn(size, "text-muted-foreground")} />;
    default:
      return <XCircle className={cn(size, "text-danger")} />;
  }
}

const REVIEWER_TONE: Record<PrReviewer["state"], string> = {
  approved: "text-success",
  changes_requested: "text-danger",
  commented: "text-muted-foreground",
  dismissed: "text-muted-foreground",
  pending: "text-muted-foreground",
  requested: "text-warning",
};

/** 리뷰어 한 명: 아바타, 이름, 판정. */
export function ReviewerRow({ reviewer }: { reviewer: PrReviewer }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-1.5 min-w-0 text-[11.5px]">
      {reviewer.isTeam ? (
        <span className="w-4 h-4 rounded shrink-0 bg-muted" aria-hidden />
      ) : (
        <PrAvatar login={reviewer.login} url={reviewer.avatarUrl} />
      )}
      <span className="truncate text-(--fg2) font-medium">{reviewer.login}</span>
      <span className={cn("shrink-0", REVIEWER_TONE[reviewer.state])}>{t(`pr.reviewer.${reviewer.state}`)}</span>
    </li>
  );
}

/** `head → base` 브랜치 표시. 포크면 head 앞에 저장소 주인을 붙인다. */
export function BranchPair({ pr, className }: { pr: PullRequestSummary; className?: string }) {
  const head = pr.isCrossRepository && pr.headRepo ? `${pr.headRepo.split("/")[0]}:${pr.headRef}` : pr.headRef;
  return (
    <span className={cn("inline-flex items-center gap-1 min-w-0 font-mono text-[11.5px] text-(--fg2)", className)}>
      <span className="truncate" title={head}>
        {head}
      </span>
      <span aria-hidden className="text-muted-foreground shrink-0">
        →
      </span>
      <span className="truncate shrink-0 max-w-[40%]" title={pr.baseRef}>
        {pr.baseRef}
      </span>
    </span>
  );
}

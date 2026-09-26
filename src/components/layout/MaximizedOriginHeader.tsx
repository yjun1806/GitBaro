import type { LucideIcon } from "lucide-react";
import { Archive, ArrowUp, FileDiff, FileText, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { MaximizedOrigin } from "./maximized-files";

const ORIGIN_ICON: Record<MaximizedOrigin["kind"], LucideIcon> = {
  working: FileDiff,
  follow: FileDiff,
  commit: GitCommitHorizontal,
  stash: Archive,
  range: ArrowUp,
  pr: GitPullRequest,
  fileTouches: FileText,
};

/** 종류마다 화면 읽기 프로그램에 알릴 이름(3.5 카드 머리와 같은 자리, 시안 결정 §3). */
const ORIGIN_A11Y_KEY: Record<MaximizedOrigin["kind"], string> = {
  working: "diff.originWorking",
  follow: "diff.originFollow",
  commit: "diff.originCommit",
  stash: "diff.originStash",
  range: "diff.originRange",
  pr: "diff.originPr",
  fileTouches: "diff.originFileTouches",
};

export interface MaximizedOriginHeaderProps {
  origin: MaximizedOrigin;
  onRestore: () => void;
}

/**
 * 크게 보는 동안 diff 카드 맨 위의 32px 머리 줄(시안 §3, 2026-09-26). 종류 아이콘 → 출처 표시
 * (`origin.label`) → 제목(있으면) → 보조 정보(있으면) → 오른쪽 끝 「원래 크기로」. `ListDiffSplit`이
 * `maximized && origin`일 때만 그리고, FLIP(200ms)이 끝난 뒤 120ms 늦게 흐려지며 나타난다
 * (`animate-maximize-origin-in`). 되돌아갈 때는 이 컴포넌트 자체가 조건부 렌더로 사라지므로 퇴장
 * 움직임이 없다(그대로 결정).
 */
export function MaximizedOriginHeader({ origin, onRestore }: MaximizedOriginHeaderProps) {
  const { t } = useTranslation();
  const Icon = ORIGIN_ICON[origin.kind];
  const restoreLabel = t("diff.restoreSizeAction");
  return (
    <div
      role="group"
      aria-label={t(ORIGIN_A11Y_KEY[origin.kind])}
      data-testid="maximized-origin-header"
      className="flex items-center gap-2 h-8 px-3 border-b border-(--line) shrink-0 min-w-0 animate-maximize-origin-in"
    >
      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {origin.label}
      {origin.title && <span className="min-w-0 truncate text-[12.5px] font-bold text-foreground">{origin.title}</span>}
      {origin.meta && <span className="shrink-0 text-[11.5px] text-muted-foreground">{origin.meta}</span>}
      <span className="flex-1" />
      <Button size="sm" variant="secondary" onClick={onRestore} title={`${restoreLabel} (Esc)`}>
        {restoreLabel}
      </Button>
    </div>
  );
}

import type { LucideIcon } from "lucide-react";
import { Archive, ArrowUp, ChevronRight, FileDiff, FileText, GitCommitHorizontal, GitPullRequest } from "lucide-react";
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
  /**
   * 지금 연 파일의 이름(경로 없이). 있으면 머리 줄 끝에 「› 파일 이름」을 덧붙인다(5.4 "저장소 ›
   * 브랜치 › 커밋 › 파일" 경로의 마지막 칸). 좁아져도 줄지 않는다 — 커밋 요약(`origin.title`)이
   * 먼저 준다.
   */
  fileName?: string;
}

/**
 * 크게 보는 동안 diff 카드 맨 위의 32px 머리 줄(시안 §3, D41 → 5.4에서 경로 줄로 발전). 종류 아이콘 →
 * 출처 표시(`origin.label`, 저장소·브랜치·워크트리를 담는다) → 커밋 요약(`origin.title`, 좁아지면
 * 가장 먼저 줄어든다) → 보조 정보(`origin.meta`) → 「› 파일 이름」(끝까지 남는다, `layout-explore.html`
 * `.ctx .cur{flex:0 0 auto;max-width:45%}`) → 오른쪽 끝 「원래 크기로」. 목록 접기·펼치기는
 * `DiffHeader`의 버튼이 맡는다(되돌리는 자리 하나 원칙, D41). `ListDiffSplit`이 `maximized &&
 * origin`일 때만 그리고, FLIP(200ms)이 끝난 뒤 120ms 늦게 흐려지며 나타난다
 * (`animate-maximize-origin-in`). 되돌아갈 때는 이 컴포넌트 자체가 조건부 렌더로 사라지므로 퇴장
 * 움직임이 없다(그대로 결정).
 */
export function MaximizedOriginHeader({ origin, onRestore, fileName }: MaximizedOriginHeaderProps) {
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
      {fileName && (
        <>
          <ChevronRight className="w-3 h-3 shrink-0 text-(--ln)" aria-hidden="true" />
          <span className="shrink-0 max-w-[45%] truncate text-[12.5px] font-bold text-foreground">{fileName}</span>
        </>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="secondary" onClick={onRestore} title={`${restoreLabel} (Esc)`}>
        {restoreLabel}
      </Button>
    </div>
  );
}

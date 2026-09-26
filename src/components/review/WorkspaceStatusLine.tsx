import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { StatusActivity } from "./StatusActivity";
import { STATUS_BAR_ROW_CLASS, TONE_CLASS } from "./GitStatusLine";
import { workspaceStatusText } from "./workspace-status-line";

export interface WorkspaceStatusLineProps {
  /** 워크스페이스에 지금 드는 저장소 경로(`useActiveScope`의 `paths`). */
  paths: readonly string[];
}

/**
 * 워크스페이스를 고른 상태의 창 맨 아래 상태 줄. 저장소 화면의 `GitStatusLineView`와 같은 자리·모양
 * (`STATUS_BAR_ROW_CLASS`)이지만 늘 보통 톤이다 — 워크스페이스에는 체크아웃·보는 중 개념이 없다.
 * 숨긴 저장소를 포함해(`showAll: true`) 변경·올릴 커밋이 있는 저장소 수만 말한다.
 */
export function WorkspaceStatusLine({ paths }: WorkspaceStatusLineProps) {
  const { t } = useTranslation();
  const { repos } = useWorkspaceReview(paths, true);
  return (
    <div role="status" data-tone="normal" className={cn(STATUS_BAR_ROW_CLASS, TONE_CLASS.normal)}>
      <Layers className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate min-w-0">{workspaceStatusText(repos, t)}</span>
      <span className="flex-1" />
      <StatusActivity />
    </div>
  );
}

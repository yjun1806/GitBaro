import { cn } from "@/lib/utils";
import { useActiveScope } from "@/hooks/useActiveScope";
import { GitStatusLine, STATUS_BAR_ROW_CLASS, TONE_CLASS } from "@/components/review/GitStatusLine";
import { WorkspaceStatusLine } from "@/components/review/WorkspaceStatusLine";
import { StatusActivity } from "@/components/review/StatusActivity";

/**
 * 창 맨 아래 28px 상태 막대. 예전에는 카드 머리에 있던 git 상태 줄(저장소 화면)과 작업 기록 버튼
 * (저장소·워크스페이스 화면 둘 다)이 여기로 옮겨 왔다 — 두 화면에서 같은 자리, 같은 모양이다.
 * 고른 것에 따라 안쪽 문장만 갈린다: 저장소를 골랐으면 `GitStatusLine`(체크아웃·upstream), 워크스페이스면
 * `WorkspaceStatusLine`(변경·올릴 커밋이 있는 저장소 수). 아무것도 안 골랐으면 문장 없이 막대만 둔다.
 */
export function StatusBar() {
  const scope = useActiveScope();
  if (scope?.kind === "repo") return <GitStatusLine />;
  if (scope?.kind === "workspace") return <WorkspaceStatusLine paths={scope.paths} />;
  return (
    <div role="status" data-tone="normal" className={cn(STATUS_BAR_ROW_CLASS, TONE_CLASS.normal)}>
      <span className="flex-1" />
      <StatusActivity />
    </div>
  );
}

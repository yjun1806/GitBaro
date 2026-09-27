import { cn } from "@/lib/utils";
import { useScope } from "@/components/scope/useScope";
import { GitStatusLine, STATUS_BAR_ROW_CLASS, TONE_CLASS } from "@/components/review/GitStatusLine";
import { WorkspaceStatusLine } from "@/components/review/WorkspaceStatusLine";
import { RepoScopeStatusLine } from "@/components/review/RepoScopeStatusLine";
import { StatusActivity } from "@/components/review/StatusActivity";

/**
 * 창 맨 아래 28px 상태 막대. 예전에는 카드 머리에 있던 git 상태 줄(저장소 화면)과 작업 기록 버튼이
 * 여기로 옮겨 왔다 — 워크스페이스 · 저장소 · 브랜치, 세 단계가 같은 자리·모양을 쓰고 안쪽 문장만
 * 단계에 맞게 갈린다(5.3): 워크스페이스는 `WorkspaceStatusLine`, 저장소(모든 워크트리를 통틀어 봄)는
 * `RepoScopeStatusLine`, 브랜치는 `GitStatusLine`(체크아웃·upstream, 체크아웃 안 했으면 보는 중 띠).
 * 아무것도 안 골랐으면 문장 없이 막대만 둔다.
 */
export function StatusBar() {
  const scope = useScope();
  if (scope?.kind === "workspace") return <WorkspaceStatusLine workspaceId={scope.workspaceId} />;
  if (scope?.kind === "repo") return <RepoScopeStatusLine />;
  if (scope?.kind === "branch") return <GitStatusLine />;
  return (
    <div role="status" data-tone="normal" className={cn(STATUS_BAR_ROW_CLASS, TONE_CLASS.normal)}>
      <span className="flex-1" />
      <StatusActivity />
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { GitBranch, SquareTerminal } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { openInTerminal } from "@/api/commands";
import { getErrorMessage } from "@/lib/utils";
import { SyncZone } from "./SyncZone";
import { ActionButton, ActionGroup } from "./ActionButton";
import { TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import { BranchPanelButton } from "./BranchZone";

/**
 * 콜백은 받지 않는다. 여러 저장소 Fetch·Pull·Push는 `SyncZone.tsx`(W5-T2)가, 브랜치 패널은
 * `BranchZone.tsx`(W5-T3)가 각자 파일 안에서 연결한다.
 */
type GitActionZoneProps =
  | { mode: "repo" }
  | {
      mode: "workspace";
      /** 워크스페이스에 든 저장소 경로. Push·Pull 배지 합계에 쓴다. */
      paths: string[];
    };

/**
 * 툴바 오른쪽 git 작업 묶음. [Fetch · Pull · Push(↑)] [브랜치] [터미널]을 둔다.
 * Merge는 브랜치 패널·우클릭 메뉴·비교 범위 머리에서, Stash는 스태시 탭과 우클릭 메뉴에서 한다.
 * 워크스페이스 모드에서는 저장소 하나에만 뜻이 있는 브랜치와 터미널을 꺼 둔다.
 */
export function GitActionZone(props: GitActionZoneProps) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {props.mode === "workspace" ? (
        <>
          <SyncZone mode="workspace" paths={props.paths} />
          <WorkspaceRepoActions />
        </>
      ) : (
        <>
          <SyncZone mode="repo" />
          <RepoActions />
        </>
      )}
    </div>
  );
}

/** 터미널 버튼. 다른 묶음과 같은 흰 카드에 혼자 담는다. */
function TerminalGroup({ onClick, hint }: { onClick?: () => void; hint?: string }) {
  const { t } = useTranslation();
  const label = t("gitActions.terminal");
  return (
    <ActionGroup label={label}>
      <span title={hint ?? label} className="inline-flex">
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          aria-label={hint ? `${label} — ${hint}` : label}
          data-action="terminal"
          className={toolbarButtonClass({ iconOnly: true, disabled: !onClick })}
        >
          <SquareTerminal className={TOOLBAR_ICON} aria-hidden="true" />
        </button>
      </span>
    </ActionGroup>
  );
}

/** 워크스페이스 모드: 브랜치·터미널은 저장소를 골라야 쓸 수 있다. */
function WorkspaceRepoActions() {
  const { t } = useTranslation();
  const hint = t("activeScope.pickRepo");
  return (
    <>
      <ActionGroup label={t("gitActions.branchGroup")}>
        <ActionButton action="branch" icon={GitBranch} label={t("gitActions.branch")} disabled caret hint={hint} />
      </ActionGroup>
      <TerminalGroup hint={hint} />
    </>
  );
}

function RepoActions() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);

  const handleOpenTerminal = async () => {
    if (!activeRepoPath) return;
    try {
      await openInTerminal(activeRepoPath);
    } catch (err) {
      addToast(t("gitActions.terminalFailed", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <>
      <ActionGroup label={t("gitActions.branchGroup")}>
        <BranchPanelButton />
      </ActionGroup>
      <TerminalGroup onClick={activeRepoPath ? handleOpenTerminal : undefined} />
    </>
  );
}

import { useTranslation } from "react-i18next";
import { Code, FolderOpen, GitBranch, Globe, SquareTerminal, type LucideIcon } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useMenuActions } from "@/hooks/useMenuActions";
import { gitHubRepoUrl } from "@/lib/utils";
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
 * 툴바 오른쪽 묶음. [Fetch · Pull · Push(↑)] [브랜치] [편집기 · 터미널 · Finder · GitHub]을 둔다.
 * Merge는 브랜치 패널·우클릭 메뉴·비교 범위 머리에서, Stash는 스태시 탭과 우클릭 메뉴에서 한다.
 * 워크스페이스 모드에서는 저장소 하나에만 뜻이 있는 브랜치와 여는 동작을 꺼 둔다.
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

/** 저장소 밖에서 여는 동작 하나. 꺼진 버튼은 마우스 이벤트를 받지 않으므로 감싼 span에 안내를 단다. */
function OpenButton({
  action,
  icon: Icon,
  label,
  onClick,
  hint,
}: {
  action: string;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  hint?: string;
}) {
  return (
    <span title={hint ?? label} className="inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-label={hint ? `${label} — ${hint}` : label}
        data-action={action}
        className={toolbarButtonClass({ iconOnly: true, disabled: !onClick })}
      >
        <Icon className={TOOLBAR_ICON} aria-hidden="true" />
      </button>
    </span>
  );
}

interface RepoOpenHandlers {
  editor?: () => void;
  terminal?: () => void;
  finder?: () => void;
  github?: () => void;
}

/**
 * 저장소를 앱 밖에서 여는 묶음: [편집기 · 터미널 · Finder · GitHub].
 * git 작업(동기화·브랜치)과 성격이 달라 따로 한 카드에 담는다.
 */
function RepoOpenGroup({ handlers, hint }: { handlers: RepoOpenHandlers; hint?: string }) {
  const { t } = useTranslation();
  return (
    <ActionGroup label={t("gitActions.openGroup")}>
      <OpenButton action="editor" icon={Code} label={t("menu.openInEditor")} onClick={handlers.editor} hint={hint} />
      <OpenButton action="terminal" icon={SquareTerminal} label={t("gitActions.terminal")} onClick={handlers.terminal} hint={hint} />
      <OpenButton action="finder" icon={FolderOpen} label={t("menu.revealInFinder")} onClick={handlers.finder} hint={hint} />
      <OpenButton action="github" icon={Globe} label={t("menu.viewOnGitHub")} onClick={handlers.github} hint={hint} />
    </ActionGroup>
  );
}

/** 워크스페이스 모드: 브랜치와 여는 동작은 저장소를 골라야 쓸 수 있다. */
function WorkspaceRepoActions() {
  const { t } = useTranslation();
  const hint = t("activeScope.pickRepo");
  return (
    <>
      <ActionGroup label={t("gitActions.branchGroup")}>
        <ActionButton action="branch" icon={GitBranch} label={t("gitActions.branch")} disabled caret hint={hint} />
      </ActionGroup>
      <RepoOpenGroup handlers={{}} hint={hint} />
    </>
  );
}

function RepoActions() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  // 워크트리를 보는 중이어도 원격 주소는 소유 저장소에 있다.
  const ownerRemotes = useRepositoryStore((s) => s.activeRepo?.remotes);
  const actions = useMenuActions();
  const gitHubUrl = ownerRemotes ? gitHubRepoUrl(ownerRemotes) : null;

  const handlers: RepoOpenHandlers = activeRepoPath
    ? {
        editor: () => actions.openFolderInEditor(activeRepoPath),
        terminal: () => actions.openTerminal(activeRepoPath),
        finder: () => actions.reveal(activeRepoPath),
        github: gitHubUrl ? () => actions.openInBrowser(gitHubUrl) : undefined,
      }
    : {};

  return (
    <>
      <ActionGroup label={t("gitActions.branchGroup")}>
        <BranchPanelButton />
      </ActionGroup>
      <RepoOpenGroup handlers={handlers} hint={activeRepoPath ? undefined : t("activeScope.pickRepo")} />
    </>
  );
}

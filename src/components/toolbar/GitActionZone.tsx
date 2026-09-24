import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, GitBranch, GitMerge, SquareTerminal } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import { useBranches, useHeadDetached, useStashList, useStashMutations, useStatus } from "@/api/queries";
import { openInTerminal } from "@/api/commands";
import { getErrorMessage } from "@/lib/utils";
import { StashSaveDialog } from "@/components/stash/StashSaveDialog";
import { SyncZone } from "./SyncZone";
import { ActionButton, ActionGroup, ToolbarDivider } from "./ActionButton";
import { TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import { MergeDialog } from "./MergeDialog";
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
 * 툴바 오른쪽 git 작업 묶음. 시안 `toolbar()`(`gen_d.py:111-116`) 순서대로
 * [Fetch · Pull · Push(↑)] [브랜치 · Merge · Stash(개수)] [터미널]을 둔다.
 * 워크스페이스 모드에서는 저장소 하나에만 뜻이 있는 두 번째 묶음과 터미널을 꺼 둔다.
 */
export function GitActionZone(props: GitActionZoneProps) {
  return (
    <div className="flex items-center gap-1 px-1 shrink-0">
      {props.mode === "workspace" ? (
        <>
          <SyncZone mode="workspace" paths={props.paths} />
          <ToolbarDivider />
          <WorkspaceRepoActions />
        </>
      ) : (
        <>
          <SyncZone mode="repo" />
          <ToolbarDivider />
          <RepoActions />
        </>
      )}
    </div>
  );
}

function TerminalButton({ onClick, hint }: { onClick?: () => void; hint?: string }) {
  const { t } = useTranslation();
  const label = t("gitActions.terminal");
  return (
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
  );
}

/** 워크스페이스 모드: 브랜치·Merge·Stash·터미널은 저장소를 골라야 쓸 수 있다. */
function WorkspaceRepoActions() {
  const { t } = useTranslation();
  const hint = t("activeScope.pickRepo");
  return (
    <>
      <ActionGroup label={t("gitActions.branchGroup")}>
        <ActionButton action="branch" icon={GitBranch} label={t("gitActions.branch")} disabled caret hint={hint} />
        <ActionButton action="merge" icon={GitMerge} label={t("gitActions.merge")} disabled hint={hint} />
        <ActionButton action="stash" icon={Archive} label={t("gitActions.stash")} disabled hint={hint} />
      </ActionGroup>
      <ToolbarDivider />
      <TerminalButton hint={hint} />
    </>
  );
}

function RepoActions() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
  const { data: branches = [], isLoading: branchesLoading } = useBranches(activeRepoPath);
  const { data: isDetached = false } = useHeadDetached(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: stashes = [] } = useStashList(activeRepoPath);
  const stashMutations = useStashMutations(activeRepoPath);
  const [showMerge, setShowMerge] = useState(false);
  const [showStash, setShowStash] = useState(false);

  const currentBranch = branches.find((b) => b.isHead && !b.isRemote)?.name ?? null;
  const isDirty = statusFiles.length > 0;
  // 합칠 대상이 되는 지금 브랜치가 있어야 한다. 분리된 HEAD나 첫 커밋 전 저장소에는 없다.
  const mergeDisabled = !activeRepoPath || isDetached || currentBranch === null;
  // 브랜치 목록을 받는 중에는 꺼진 이유를 아직 모르므로 안내를 달지 않는다.
  const mergeHint =
    !mergeDisabled || !activeRepoPath || (!isDetached && branchesLoading)
      ? undefined
      : isDetached
        ? t("sync.detachedHeadError")
        : t("gitActions.mergeNoBranch");

  const handleStashSave = async (message?: string, paths?: string[]) => {
    try {
      const oid = paths
        ? await stashMutations.pushPartial.mutateAsync({ paths, message })
        : await stashMutations.push.mutateAsync(message);
      setShowStash(false);
      if (oid === null) {
        addToast(t("stash.nothingToSave"), "info");
        return;
      }
      useSelectionStore.getState().clearFileSelection();
      addToast(t("stash.saved"), "success");
    } catch (err) {
      addToast(t("stash.failedToSave", { error: getErrorMessage(err) }), "error");
    }
  };

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
        <ActionButton
          action="merge"
          icon={GitMerge}
          label={t("gitActions.merge")}
          disabled={mergeDisabled}
          hint={mergeHint}
          onClick={() => setShowMerge(true)}
        />
        <ActionButton
          action="stash"
          icon={Archive}
          label={t("gitActions.stash")}
          disabled={!activeRepoPath}
          badge={stashes.length}
          onClick={() => setShowStash(true)}
        />
      </ActionGroup>
      <ToolbarDivider />
      <TerminalButton onClick={activeRepoPath ? handleOpenTerminal : undefined} />

      {showMerge && activeRepoPath && currentBranch && (
        <MergeDialog
          repoPath={activeRepoPath}
          currentBranch={currentBranch}
          branches={branches}
          isDirty={isDirty}
          onClose={() => setShowMerge(false)}
        />
      )}
      {showStash && (
        <StashSaveDialog onSave={handleStashSave} onClose={() => setShowStash(false)} />
      )}
    </>
  );
}

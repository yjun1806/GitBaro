import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, GitBranch, GitMerge, SquareTerminal } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import { useBranches, useHeadDetached, useStashList, useStashMutations, useStatus } from "@/api/queries";
import { openInTerminal } from "@/api/commands";
import { cn, getErrorMessage } from "@/lib/utils";
import type { RemoteOp } from "@/types";
import { StashSaveDialog } from "@/components/stash/StashSaveDialog";
import { SyncZone } from "./SyncZone";
import { ActionButton, ActionGroup } from "./ActionButton";
import { MergeDialog } from "./MergeDialog";

type GitActionZoneProps =
  | {
      mode: "repo";
      /** 브랜치 패널을 연다(W5-T3가 연결). */
      onOpenBranchPanel: () => void;
    }
  | {
      mode: "workspace";
      /** 여러 저장소 Fetch·Pull·Push. 연결 전(undefined)에는 세 버튼을 꺼 둔다(W5-T2가 연결). */
      onMultiRepo?: (op: RemoteOp) => void;
    };

/**
 * 툴바 오른쪽 git 작업 묶음. 시안 `toolbar()`(`gen_d.py:111-116`) 순서대로
 * [Fetch · Pull · Push(↑)] [브랜치 · Merge · Stash(개수)] [터미널]을 둔다.
 * 워크스페이스 모드에서는 저장소 하나에만 뜻이 있는 두 번째 묶음과 터미널을 꺼 둔다.
 */
export function GitActionZone(props: GitActionZoneProps) {
  return (
    <div className="flex items-center gap-2.5 px-2 shrink-0">
      {props.mode === "workspace" ? (
        <>
          <SyncZone mode="workspace" onMultiRepo={props.onMultiRepo} />
          <WorkspaceRepoActions />
        </>
      ) : (
        <>
          <SyncZone mode="repo" />
          <RepoActions onOpenBranchPanel={props.onOpenBranchPanel} />
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
        className={cn(
          "w-9 h-9 flex items-center justify-center rounded-[11px] bg-card shadow-(--shadow-sm) text-(--fg2) transition-colors",
          onClick ? "hover:bg-accent" : "opacity-50 cursor-not-allowed",
        )}
      >
        <SquareTerminal className="w-[15px] h-[15px]" aria-hidden="true" />
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
        <ActionButton action="branch" icon={GitBranch} label={t("gitActions.branch")} disabled hint={hint} />
        <ActionButton action="merge" icon={GitMerge} label={t("gitActions.merge")} disabled hint={hint} />
        <ActionButton action="stash" icon={Archive} label={t("gitActions.stash")} disabled hint={hint} />
      </ActionGroup>
      <TerminalButton hint={hint} />
    </>
  );
}

function RepoActions({ onOpenBranchPanel }: { onOpenBranchPanel: () => void }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: isDetached = false } = useHeadDetached(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: stashes = [] } = useStashList(activeRepoPath);
  const stashMutations = useStashMutations(activeRepoPath);
  const [showMerge, setShowMerge] = useState(false);
  const [showStash, setShowStash] = useState(false);

  const currentBranch = branches.find((b) => b.isHead && !b.isRemote)?.name ?? null;
  const isDirty = statusFiles.length > 0;
  // 분리된 HEAD에는 가져와 합칠 브랜치가 없다.
  const mergeDisabled = !activeRepoPath || isDetached || currentBranch === null;
  const mergeHint = mergeDisabled && activeRepoPath ? t("sync.detachedHeadError") : undefined;

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
        <ActionButton
          action="branch"
          icon={GitBranch}
          label={t("gitActions.branch")}
          disabled={!activeRepoPath}
          onClick={onOpenBranchPanel}
        />
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

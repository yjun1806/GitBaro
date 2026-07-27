import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useSymbolIndexMutations, useSymbolIndexStatus } from "@/api/queries";
import type { SymbolIndexStatus, VerifyIndexProgressEvent } from "@/types";

/** Phases after which nothing more arrives for this build. */
const TERMINAL_PHASES: VerifyIndexProgressEvent["phase"][] = ["done", "cancelled"];

export interface SymbolIndexHandle {
  /** `undefined` until the first status read resolves. */
  status: SymbolIndexStatus | undefined;
  /** Live build progress, or `null` when no build is running. */
  progress: VerifyIndexProgressEvent | null;
  isBuilding: boolean;
  /** True while a build/cancel request is in flight (not while indexing). */
  isPending: boolean;
  build: () => void;
  cancel: () => void;
}

/**
 * The symbol index for one repository: current status, live build progress, and
 * the two user actions.
 *
 * **Nothing here starts a build.** Indexing is opt-in (§7-④): a large repository
 * can take minutes on its first pass, and an app that silently pins a core on
 * launch looks broken. `build()` is only ever called from a click.
 *
 * Progress arrives on the `verify:index-progress` Tauri event, the same way the
 * FS watcher pushes `fs:change` — see `useRepoWatcher`.
 */
export function useSymbolIndex(repoPath: string | null): SymbolIndexHandle {
  const queryClient = useQueryClient();
  const { data: status } = useSymbolIndexStatus(repoPath);
  const { build, cancel } = useSymbolIndexMutations(repoPath);
  const [progress, setProgress] = useState<VerifyIndexProgressEvent | null>(null);

  // A build belongs to one repository; switching repos drops a stale bar.
  useEffect(() => {
    setProgress(null);
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<VerifyIndexProgressEvent>("verify:index-progress", (event) => {
      if (!mounted || event.payload.repoPath !== repoPath) return;

      const terminal = TERMINAL_PHASES.includes(event.payload.phase);
      setProgress(terminal ? null : event.payload);
      if (terminal) {
        queryClient.invalidateQueries({ queryKey: ["symbolIndexStatus", repoPath] });
      }
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [repoPath, queryClient]);

  const handleBuild = useCallback(() => build.mutate(), [build]);
  const handleCancel = useCallback(() => cancel.mutate(), [cancel]);

  return {
    status,
    progress,
    isBuilding: status?.state === "building" || progress !== null,
    isPending: build.isPending || cancel.isPending,
    build: handleBuild,
    cancel: handleCancel,
  };
}

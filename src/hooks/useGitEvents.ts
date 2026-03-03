import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useActivityStore } from "@/stores/activity";
import type { GitCommandEntry } from "@/types";

interface GitCommandStartPayload {
  id: string;
  command: string;
  operation: string;
  repoPath: string;
  startedAt: number;
}

interface GitCommandCompletePayload {
  id: string;
  operation: string;
  success: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  resultSummary?: GitCommandEntry["resultSummary"];
}

interface GitCommandProgressPayload {
  id: string;
  operation: string;
  message: string;
  percent?: number;
}

export function useGitEvents() {
  const addStart = useActivityStore((s) => s.addStart);
  const addComplete = useActivityStore((s) => s.addComplete);
  const updateProgress = useActivityStore((s) => s.updateProgress);

  useEffect(() => {
    let mounted = true;
    const cleanups: (() => void)[] = [];

    async function setup() {
      const unlistenStart = await listen<GitCommandStartPayload>(
        "git:command-start",
        (event) => {
          if (!mounted) return;
          const p = event.payload;
          addStart({
            id: p.id,
            command: p.command,
            operation: p.operation as GitCommandEntry["operation"],
            repoPath: p.repoPath,
            startedAt: p.startedAt,
          });
        },
      );
      cleanups.push(unlistenStart);

      const unlistenComplete = await listen<GitCommandCompletePayload>(
        "git:command-complete",
        (event) => {
          if (!mounted) return;
          const p = event.payload;
          addComplete(p.id, {
            completedAt: Date.now(),
            durationMs: p.durationMs,
            success: p.success,
            stdout: p.stdout,
            stderr: p.stderr,
            exitCode: p.exitCode,
            resultSummary: p.resultSummary,
          });
        },
      );
      cleanups.push(unlistenComplete);

      const unlistenProgress = await listen<GitCommandProgressPayload>(
        "git:command-progress",
        (event) => {
          if (!mounted) return;
          const p = event.payload;
          updateProgress(p.id, p.message, p.percent);
        },
      );
      cleanups.push(unlistenProgress);
    }

    setup();

    return () => {
      mounted = false;
      cleanups.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

import { TAURI_EVENTS } from "@/api/events";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useActivityStore } from "@/stores/activity";
import type { GitCommandEntry } from "@/types";

/** git 명령의 시작·진행·끝을 활동 기록에 옮긴다. 구독 해제는 `useTauriEvent`가 맡는다. */
export function useGitEvents() {
  const addStart = useActivityStore((s) => s.addStart);
  const addComplete = useActivityStore((s) => s.addComplete);
  const updateProgress = useActivityStore((s) => s.updateProgress);

  useTauriEvent(TAURI_EVENTS.gitCommandStart, (p) => {
    addStart({
      id: p.id,
      command: p.command,
      operation: p.operation as GitCommandEntry["operation"],
      repoPath: p.repoPath,
      startedAt: p.startedAt,
      automatic: p.automatic,
    });
  });

  useTauriEvent(TAURI_EVENTS.gitCommandComplete, (p) => {
    addComplete(p.id, {
      completedAt: Date.now(),
      durationMs: p.durationMs,
      success: p.success,
      stdout: p.stdout,
      stderr: p.stderr,
      exitCode: p.exitCode,
      resultSummary: p.resultSummary,
    });
  });

  useTauriEvent(TAURI_EVENTS.gitCommandProgress, (p) => {
    updateProgress(p.id, p.message, p.percent);
  });
}

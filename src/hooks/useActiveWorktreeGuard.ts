import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStatus } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useVerifyWorktree } from "./useVerifyWorktree";

/** 파일 이벤트가 몰려 올 때(폴더를 통째로 지우면 수백 건) 한 번만 확인하려고 기다리는 시간(ms). */
export const WORKTREE_CHECK_DEBOUNCE_MS = 500;

interface FsChangePayload {
  repoPath: string;
}

/**
 * 지금 연 워크트리가 앱 밖에서 지워졌는지(`git worktree remove`, 폴더 삭제) 지켜본다. 지워졌으면
 * `useVerifyWorktree`가 저장소의 기본 폴더로 돌아가고 알림을 띄운다. 확인하지 않으면 없는 폴더를
 * 연 채로 모든 파일이 삭제된 것처럼 보인다.
 *
 * 확인하는 때: 그 워크트리의 파일·git 폴더 이벤트, 상태 조회 실패, 창이 다시 포커스를 받을 때.
 * 기본 폴더를 연 동안에는 아무것도 하지 않는다.
 */
export function useActiveWorktreeGuard(): void {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerPath = useRepositoryStore((s) => s.activeRepo?.path ?? null);
  const verifyWorktree = useVerifyWorktree();
  const linked = activeRepoPath !== null && ownerPath !== null && activeRepoPath !== ownerPath;
  const { isError: statusFailed, errorUpdatedAt } = useStatus(linked ? activeRepoPath : null);

  const check = useRef<() => void>(() => {});
  useEffect(() => {
    check.current = () => {
      if (linked && ownerPath && activeRepoPath) verifyWorktree(ownerPath, activeRepoPath);
    };
  });

  // 상태 조회가 실패하면(폴더가 없으면 git이 저장소를 못 연다) 바로 확인한다.
  useEffect(() => {
    if (linked && statusFailed) check.current();
  }, [linked, statusFailed, errorUpdatedAt]);

  useEffect(() => {
    if (!linked || !activeRepoPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => check.current(), WORKTREE_CHECK_DEBOUNCE_MS);
    };
    const onFocus = () => schedule();
    window.addEventListener("focus", onFocus);

    let mounted = true;
    const unlisteners: (() => void)[] = [];
    for (const event of ["fs:change", "fs:git-dir-change"]) {
      listen<FsChangePayload>(event, (e) => {
        if (e.payload.repoPath === activeRepoPath) schedule();
      })
        .then((fn) => (mounted ? unlisteners.push(fn) : fn()))
        .catch(() => {
          // 이벤트를 못 받아도 포커스와 상태 조회 실패로 확인한다.
        });
    }
    return () => {
      mounted = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      unlisteners.forEach((fn) => fn());
    };
  }, [linked, activeRepoPath]);
}

import { useCallback } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { repoAvatarColor, repoDisplayName } from "@/lib/repo-prefs";
import type { AvatarColor } from "@/lib/avatar-color";

/** 저장소 이름을 화면에 보일 이름(표시 이름이 있으면 그것)으로 바꾸는 함수. */
export function useRepoName(): (repo: { path: string; name: string }) => string {
  const prefs = useRepositoryStore((s) => s.repoPrefs);
  return useCallback((repo) => repoDisplayName(repo, prefs), [prefs]);
}

/** 저장소 경로로 아바타 색을 정하는 함수(저장소 설정에서 고른 색이 있으면 그것). */
export function useRepoAvatarColor(): (path: string) => AvatarColor {
  const prefs = useRepositoryStore((s) => s.repoPrefs);
  return useCallback((path) => repoAvatarColor(path, prefs), [prefs]);
}

/** 지금 연 저장소(워크트리면 소유 저장소)의 표시 이름. 없으면 빈 문자열. */
export function useActiveRepoName(): string {
  return useRepositoryStore((s) => (s.activeRepo ? repoDisplayName(s.activeRepo, s.repoPrefs) : ""));
}

/** 이 저장소의 표시 이름. 저장소 목록 밖에서(알림·토스트) 쓴다. */
export function repoNameNow(repo: { path: string; name: string }): string {
  return repoDisplayName(repo, useRepositoryStore.getState().repoPrefs);
}

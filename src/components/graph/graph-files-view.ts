import { createContext, type ReactNode } from "react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { usePrViewStore } from "@/components/pr/pr-view";
import { activeRange, useBranchRangeStore } from "@/components/branch/branch-range";

/**
 * 그래프 탭이 「파일별」 보기인지(5.1, D44). 브랜치 비교 중에는 비교 그래프를 그대로 둔다.
 * 메인 칸(`MainColumn`)도 이 값으로 옆 칸을 열지 않는다 — 파일별 보기는 그래프 칸 안에 파일 목록과
 * diff를 함께 그린다(5.4 「첫 칸이 파일 목록」).
 */
export function useGraphFilesView(): boolean {
  const activeTab = useUIStore((s) => s.activeTab);
  const view = useUIStore((s) => s.reviewFileView);
  const prOpen = usePrViewStore((s) => s.open);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const branchRange = useBranchRangeStore((s) => s.range);
  return (
    view === "files" && !prOpen && activeTab !== "stash" && activeTab !== "actions" && activeRange(branchRange, activeRepoPath) === null
  );
}


/**
 * 파일별 보기에서 그래프 칸의 머리(탭 줄·필터 막대)를 목록 카드 맨 위로 넘기는 길. 파일별 보기는
 * 그래프 칸 자리에 파일 목록과 diff를 카드 두 장으로 그린다(5.4) — 그래프 칸이 카드를 두르면 카드 안에
 * 카드가 되므로, 칸은 카드를 두르지 않고 머리만 이 컨텍스트로 `FileTouchesView`의 목록 카드에 맡긴다.
 */
export const FilesViewTopContext = createContext<ReactNode>(null);

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


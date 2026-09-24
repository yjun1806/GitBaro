import { fuzzyFilter } from "@/lib/fuzzy-search";
import type { WorktreeInfo } from "@/types";

/** 워크트리 패널(W-Top-T1, 브랜치 패널 D6과 같은 구조) 세 칸. */
export type WorktreePanelSection = "main" | "linked" | "prunable";

export interface WorktreePanelRow {
  worktree: WorktreeInfo;
  section: WorktreePanelSection;
}

export interface WorktreePanelSections {
  /** 메인 작업 트리. 있으면 항상 하나. */
  main: WorktreePanelRow[];
  /** 링크된 워크트리(메인이 아니고, 폴더가 남아 있는 것). */
  linked: WorktreePanelRow[];
  /** 정리 필요: 폴더가 사라진(prunable) 워크트리. */
  prunable: WorktreePanelRow[];
}

const byPath = (a: WorktreePanelRow, b: WorktreePanelRow) => a.worktree.path.localeCompare(b.worktree.path);

/**
 * 워크트리 목록을 「메인 / 링크된 워크트리 / 정리 필요」 세 칸으로 나눈다(브랜치 패널의
 * classifyBranches와 같은 자리). bare 워크트리는 탐색 대상이 아니라서 뺀다.
 * 검색어가 있으면 칸 안에서 일치도 순으로 둔다(브랜치·경로 이름 모두 대상).
 */
export function classifyWorktrees(worktrees: readonly WorktreeInfo[], query = ""): WorktreePanelSections {
  const main: WorktreePanelRow[] = [];
  const linked: WorktreePanelRow[] = [];
  const prunable: WorktreePanelRow[] = [];

  for (const worktree of worktrees) {
    if (worktree.isBare) continue;
    const row: WorktreePanelRow = { worktree, section: worktree.isMain ? "main" : worktree.isPrunable ? "prunable" : "linked" };
    (row.section === "main" ? main : row.section === "prunable" ? prunable : linked).push(row);
  }

  linked.sort(byPath);
  prunable.sort(byPath);

  const searchText = (r: WorktreePanelRow) => r.worktree.branch ?? r.worktree.path;
  const filter = (rows: WorktreePanelRow[]) => fuzzyFilter(rows, query.trim(), searchText);
  return { main: filter(main), linked: filter(linked), prunable: filter(prunable) };
}

/** 세 칸의 행을 화면 순서대로 한 줄로. */
export function flattenWorktreeSections(sections: WorktreePanelSections): WorktreePanelRow[] {
  return [...sections.main, ...sections.linked, ...sections.prunable];
}

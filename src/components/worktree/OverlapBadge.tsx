import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useReviewStatusQuery, useSiblingFileDiffs, useWipFilesMany } from "@/api/queries";
import { worktreeColor } from "@/components/graph/worktree-history";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { RefLabel } from "@/components/ui/marks";
import {
  compareLineRanges,
  findSameFileWorktrees,
  formatRanges,
  type LineOverlap,
  type OverlapWorktree,
  type SiblingWorktreeFiles,
} from "@/lib/worktree-overlap";
import type { DiffOutput, WipFile } from "@/types";
import { trimTrailingSlash } from "@/lib/utils";

/** 같은 파일을 함께 고치는 다른 워크트리와, 그쪽 diff를 볼 때 고를 스테이징 쪽. */
export interface OverlapSibling extends OverlapWorktree {
  staged: boolean;
}

export interface WorktreeOverlap {
  /** 이 워크트리의 파일(새 경로 또는 옛 경로) → 같은 파일을 고치는 다른 워크트리. */
  of: (file: Pick<WipFile, "path" | "origPath">) => readonly OverlapSibling[];
  /**
   * `of(file)`가 겹침을 찾을 때 실제로 맞춘 경로 — 새 경로 또는 옛 경로 중 다른 워크트리의
   * 파일 목록에도 있던 쪽. 이름을 바꾼 파일은 다른 워크트리에 새 경로가 없을 수 있으므로
   * (겹침이 옛 경로로만 맞았다면) 그쪽 diff를 읽을 때는 이 경로를 써야 한다.
   */
  matchedPathOf: (file: Pick<WipFile, "path" | "origPath">) => string | null;
}

const NO_SIBLINGS: readonly OverlapSibling[] = [];
const NO_PATHS: string[] = [];

/** 그쪽 diff를 처음 볼 때의 스테이징 쪽(따라가기와 같은 규칙: 스테이징만 한 파일만 스테이징 쪽). */
function stagedSideOf(f: WipFile | undefined): boolean {
  return f !== undefined && f.staged && !f.unstaged;
}

/**
 * `path` 워크트리의 커밋하지 않은 파일 중 같은 저장소의 다른 워크트리도 고치고 있는 파일(D5 ⧉).
 * 워크트리 목록은 사이드바·그래프와 같은 `review_status` 조회를 함께 쓰고, 다른 워크트리의
 * 파일 목록은 `get_wip_files`로 읽는다. 1차 판정은 파일 경로만 본다.
 */
export function useWorktreeOverlap(path: string, files: readonly WipFile[]): WorktreeOverlap {
  const repos = useRepositoryStore((s) => s.repos);
  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  const { data: scan } = useReviewStatusQuery(repoPaths);

  const key = trimTrailingSlash(path);
  const siblings = useMemo(() => {
    const repo = scan?.find((r) => r.worktrees.some((w) => trimTrailingSlash(w.path) === key));
    return repo ? repo.worktrees.filter((w) => trimTrailingSlash(w.path) !== key) : [];
  }, [scan, key]);
  const siblingPaths = useMemo(
    () => (siblings.length > 0 ? siblings.map((s) => s.path) : NO_PATHS),
    [siblings],
  );
  const results = useWipFilesMany(siblingPaths);
  const dataKey = results.map((r) => r.dataUpdatedAt).join(",");

  return useMemo(() => {
    const byWorktree = new Map<string, ReadonlyMap<string, WipFile>>();
    const inputs: SiblingWorktreeFiles[] = siblings.map((s, i) => {
      const list = results[i]?.data ?? [];
      const byFile = new Map<string, WipFile>();
      for (const f of list) {
        byFile.set(f.path, f);
        if (f.origPath) byFile.set(f.origPath, f);
      }
      byWorktree.set(s.path, byFile);
      return { path: s.path, branch: s.branch, files: [...byFile.keys()] };
    });
    const mine = files.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]));
    const overlap = findSameFileWorktrees(mine, inputs);
    const matchedNameOf = (file: Pick<WipFile, "path" | "origPath">): string | null => {
      if (overlap.has(file.path)) return file.path;
      if (file.origPath && overlap.has(file.origPath)) return file.origPath;
      return null;
    };
    const of = (file: Pick<WipFile, "path" | "origPath">): readonly OverlapSibling[] => {
      const name = matchedNameOf(file);
      const hit = name ? overlap.get(name) : undefined;
      if (!hit) return NO_SIBLINGS;
      return hit.map((w) => ({ ...w, staged: stagedSideOf(byWorktree.get(w.path)?.get(name!)) }));
    };
    const matchedPathOf = (file: Pick<WipFile, "path" | "origPath">): string | null => matchedNameOf(file);
    return { of, matchedPathOf };
    // dataKey가 다른 워크트리 파일 목록의 내용을 대신 비교한다(useQueries 결과 배열은 매번 새로 온다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblings, dataKey, files]);
}

export function overlapWorktreeName(w: Pick<OverlapWorktree, "branch" | "path">): string {
  return w.branch ?? w.path.split("/").pop() ?? w.path;
}

/** 파일 목록 행의 ⧉ 표시. */
export function OverlapMark({ siblings }: { siblings: readonly OverlapSibling[] }) {
  const { t } = useTranslation();
  if (siblings.length === 0) return null;
  const names = siblings.map(overlapWorktreeName).join(", ");
  return (
    <span
      data-testid="overlap-mark"
      title={t("overlap.markTitle", { names })}
      aria-label={t("overlap.markTitle", { names })}
      className="shrink-0 text-[10.5px] font-extrabold text-danger"
    >
      ⧉
    </span>
  );
}

/**
 * 워크트리 이름표(시안 D5의 워크트리 라벨). 테두리와 아이콘은 그 워크트리의 색이라
 * 그래프의 칩·WIP 행과 짝지어 볼 수 있다.
 */
export function WorktreeTag({ name, path }: { name: string; path: string }) {
  return <RefLabel name={name} kind="worktree" laneColor={worktreeColor(path)} className="max-w-[220px]" />;
}

export interface OverlapBannerProps {
  filePath: string;
  /** 이 워크트리 쪽 diff(이미 불러온 것). */
  mine: DiffOutput | null | undefined;
  siblings: readonly OverlapSibling[];
  onSideBySide: () => void;
}

/**
 * diff 위의 ⧉ 「같은 파일」 경고(시안 D5). 1차 판정(경로)으로 걸린 파일을 볼 때만 그 파일 하나의
 * 다른 워크트리 diff를 읽어 변경 구간을 견준다. 함께 고치는 줄이 있는 워크트리를 먼저 보여 준다.
 */
export function OverlapBanner({ filePath, mine, siblings, onSideBySide }: OverlapBannerProps) {
  const { t } = useTranslation();
  const results = useSiblingFileDiffs(siblings, filePath);
  const compared = siblings.map((s, i) => {
    const theirs = results[i]?.data;
    return { sibling: s, lines: compareLineRanges(mine, theirs?.filePath === filePath ? theirs : null) };
  });
  const pick = compared.find((c) => (c.lines?.shared.length ?? 0) > 0) ?? compared[0];
  if (!pick) return null;
  const first = pick.sibling;
  const lines: LineOverlap | null = pick.lines;
  const more = siblings.length - 1;

  let detail: string;
  if (!lines || lines.mine.length === 0 || lines.theirs.length === 0) {
    detail = t("overlap.bannerNoLines");
  } else if (lines.shared.length === 0) {
    detail = t("overlap.bannerDifferentLines", {
      mine: formatRanges(lines.mine),
      theirs: formatRanges(lines.theirs),
    });
  } else {
    detail = t("overlap.bannerSharedLines", {
      shared: formatRanges(lines.shared),
      mine: formatRanges(lines.mine),
      theirs: formatRanges(lines.theirs),
    });
  }

  return (
    <div data-testid="overlap-banner">
      <Notice
        tone="danger"
        banner
        role="status"
        actions={
          <Button size="sm" variant="secondary" onClick={onSideBySide}>
            {t("overlap.sideBySide")}
          </Button>
        }
      >
        <span className="flex flex-wrap items-center gap-1.5 min-w-0">
          <strong className="shrink-0">⧉ {t("overlap.sameFile")}</strong>
          <WorktreeTag name={overlapWorktreeName(first)} path={first.path} />
          {more > 0 && <span>{t("overlap.andMore", { count: more })}</span>}
          <span>{t("overlap.bannerAlsoEditing", { count: siblings.length })}</span>
          <span>{detail}</span>
        </span>
      </Notice>
    </div>
  );
}

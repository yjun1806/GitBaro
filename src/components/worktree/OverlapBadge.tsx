import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2 } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useCachedFileDiff, useReviewStatusQuery, useWipFilesMany } from "@/api/queries";
import { normalizePath } from "@/components/graph/graph-model";
import {
  compareLineRanges,
  findSameFileWorktrees,
  formatRanges,
  type OverlapWorktree,
  type SiblingWorktreeFiles,
} from "@/lib/worktree-overlap";
import type { DiffOutput, WipFile } from "@/types";

/** 같은 파일을 함께 고치는 다른 워크트리와, 그쪽 diff를 볼 때 고를 스테이징 쪽. */
export interface OverlapSibling extends OverlapWorktree {
  staged: boolean;
}

export interface WorktreeOverlap {
  /** 이 워크트리의 파일(새 경로 또는 옛 경로) → 같은 파일을 고치는 다른 워크트리. */
  of: (file: Pick<WipFile, "path" | "origPath">) => readonly OverlapSibling[];
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

  const key = normalizePath(path);
  const siblings = useMemo(() => {
    const repo = scan?.find((r) => r.worktrees.some((w) => normalizePath(w.path) === key));
    return repo ? repo.worktrees.filter((w) => normalizePath(w.path) !== key) : [];
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
    const of = (file: Pick<WipFile, "path" | "origPath">): readonly OverlapSibling[] => {
      const hit = overlap.get(file.path) ?? (file.origPath ? overlap.get(file.origPath) : undefined);
      if (!hit) return NO_SIBLINGS;
      const name = overlap.has(file.path) ? file.path : (file.origPath ?? file.path);
      return hit.map((w) => ({ ...w, staged: stagedSideOf(byWorktree.get(w.path)?.get(name)) }));
    };
    return { of };
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
      className="shrink-0 text-[11px] font-extrabold text-danger"
    >
      ⧉
    </span>
  );
}

/** 워크트리 이름표(시안 D5의 워크트리 라벨). */
export function WorktreeTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 shrink-0 max-w-[220px] px-[7px] py-px rounded-[6px] border border-(--line2) bg-card text-[10.5px] font-bold text-(--fg2)">
      <FolderGit2 className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate font-mono">{name}</span>
    </span>
  );
}

export interface OverlapBannerProps {
  filePath: string;
  /** 이 워크트리 쪽 diff(이미 불러온 것). */
  mine: DiffOutput | null | undefined;
  siblings: readonly OverlapSibling[];
  onSideBySide: () => void;
}

/**
 * diff 위의 ⧉ 「같은 파일」 경고(시안 D5). 줄 범위는 이미 불러온 두 diff로만 계산한다 —
 * 그쪽 diff를 아직 읽지 않았으면 범위 없이 경고만 띄우고, 나란히 보기를 열면 채워진다.
 */
export function OverlapBanner({ filePath, mine, siblings, onSideBySide }: OverlapBannerProps) {
  const { t } = useTranslation();
  const first = siblings[0];
  const { data: theirs } = useCachedFileDiff(first?.path ?? null, first ? filePath : null, first?.staged ?? false);
  if (!first) return null;
  const lines = compareLineRanges(mine, theirs?.filePath === filePath ? theirs : null);
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
    <div
      role="status"
      data-testid="overlap-banner"
      className="flex items-center gap-2.5 px-3 py-2 shrink-0 border-b border-danger/25 bg-danger/8 text-[12px] text-danger"
    >
      <strong className="shrink-0">⧉ {t("overlap.sameFile")}</strong>
      <span className="flex flex-wrap items-center gap-1.5 min-w-0">
        <WorktreeTag name={overlapWorktreeName(first)} />
        {more > 0 && <span>{t("overlap.andMore", { count: more })}</span>}
        <span>{t("overlap.bannerAlsoEditing", { count: siblings.length })}</span>
        <span>{detail}</span>
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onSideBySide}
        className="shrink-0 h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
      >
        {t("overlap.sideBySide")}
      </button>
    </div>
  );
}

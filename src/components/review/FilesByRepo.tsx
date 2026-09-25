import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TAURI_EVENTS } from "@/api/events";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Folder, GitBranch, Square, SquareCheck } from "lucide-react";
import { useBranches, useChangesVsDefaultMany, useFileDiffsVsDefault } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { EmptyState } from "@/components/layout/ContentArea";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import type { MaximizedFiles } from "@/components/layout/maximized-files";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { ContextMenu, contextMenuPoint } from "@/components/ui/ContextMenu";
import { useFileMenu } from "@/components/commit/useFileMenu";
import { useFolderMenu } from "@/components/ui/useFolderMenu";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import { statusTextColors } from "@/lib/file-status";
import { cn, getErrorMessage, trimTrailingSlash } from "@/lib/utils";
import type { BranchChangedFile, BranchChanges, ChangesScope, FileStatus } from "@/types";
import type { FilesGroupBy } from "./files-view";
import { useRepoName } from "@/hooks/useRepoDisplay";
import {
  changesSummary,
  comparisonBaseName,
  tabBaseName,
  useChangesScopes,
  useCompareBaseStore,
  useRepoDefaultBases,
} from "./compare-base";
import { BasePicker } from "./BasePicker";
import { ViewedCheckbox } from "@/components/ui/ViewedCheckbox";
import { ViewedProgress } from "./ViewedProgress";
import {
  DETACHED,
  isViewed,
  toReviewable,
  useFileReviewStore,
  type FileReviewScope,
} from "@/stores/file-review";

export interface FilesByRepoRepo {
  /** 비교할 저장소(또는 지금 연 워크트리) 경로. */
  path: string;
  name: string;
}

export interface FilesByRepoProps {
  repos: readonly FilesByRepoRepo[];
  /** 저장소 그룹 안을 폴더로 한 번 더 나눌지. */
  groupBy?: FilesGroupBy;
}

interface FileRef {
  repoPath: string;
  filePath: string;
}

const STATUS_LETTER: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "A",
  ignored: "I",
  conflicted: "U",
};

type SelectedFile = FileRef & { oldPath: string | null; status: FileStatus; scope: ChangesScope | null };

/** 내용이 같으면(원소가 모두 같은 참조면) 이전 배열을 돌려준다. `useQueries` 결과처럼 렌더마다 새로 생기는 배열용. */
function useShallowStable<T>(items: readonly T[]): readonly T[] {
  const [stable, setStable] = useState(items);
  if (stable !== items && (stable.length !== items.length || stable.some((item, i) => item !== items[i]))) {
    // 렌더 중 상태 갱신 — React가 이번 렌더를 버리고 새 값으로 곧바로 다시 돌린다.
    setStable(items);
    return items;
  }
  return stable;
}

function sameFile(a: FileRef | null, b: FileRef | null): boolean {
  return a !== null && b !== null && a.repoPath === b.repoPath && a.filePath === b.filePath;
}

function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf("/");
  return at === -1 ? { name: path, dir: "" } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}

function fileKey(repoPath: string, filePath: string): string {
  return `${repoPath}\u0000${filePath}`;
}

/** 「봤음」 표시의 범위: 이 목록이 보여 주는 브랜치와 비교 기준. */
function reviewScopeOf(changes: BranchChanges, scope: ChangesScope | null): FileReviewScope {
  return { branch: changes.branch ?? DETACHED, base: comparisonBaseName(changes, scope?.base ?? null) };
}

/** 저장소 하나의 파일마다 「봤음」인지. 목록을 아직 못 받았으면 비어 있다. */
interface RepoReview {
  scope: FileReviewScope;
  viewed: ReadonlySet<string>;
}

/**
 * main 대비 변경(D7, 예전 이름 「main 대비 변경」). 저장소마다 그 저장소의 main(또는 고른 기준 브랜치)과
 * 갈라진 지점 이후로 바뀐 파일(커밋 안 한 변경 포함)을 저장소별 그룹으로 보여 주고, 그룹 머리에 그 저장소의
 * 브랜치와 비교 기준 선택을 단다. 체크아웃하지 않고 다른 브랜치를 보는 중이면 그 브랜치를 기준과 비교한다
 * (커밋 안 한 변경은 빼고).
 */
export function FilesByRepo({ repos, groupBy = "repo" }: FilesByRepoProps) {
  const { t } = useTranslation();
  // 부모가 렌더마다 새 배열을 넘겨도(워크스페이스의 보이는 저장소 목록) 경로가 같으면 같은 배열을 쓴다.
  const paths = useShallowStable(repos.map((r) => r.path));
  const scopes = useChangesScopes(paths);
  const results = useChangesVsDefaultMany(paths, scopes);
  const setBase = useCompareBaseStore((s) => s.setBase);
  const repoDefaults = useRepoDefaultBases(paths);
  const repoName = useRepoName();
  const scopeOf = (repoPath: string): ChangesScope | null => scopes[paths.indexOf(repoPath)] ?? null;
  useChangesActivityRefresh(paths);

  const [selectedState, setSelected] = useState<SelectedFile | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // 고른 파일이 지금 보이는 저장소 것이 아니면(저장소를 바꿨거나 「조용한 저장소 숨기기」로 빠졌으면) 버린다.
  const shown = useMemo(() => new Set(paths), [paths]);
  // 비교 범위(기준·보는 브랜치)가 바뀌어도 고른 파일은 그대로 두고, diff만 새 범위로 다시 읽는다.
  const selectedInView = selectedState && shown.has(selectedState.repoPath) ? selectedState : null;
  const selectedScope = selectedInView ? scopeOf(selectedInView.repoPath) : null;
  const selected = useMemo(
    () => (selectedInView ? { ...selectedInView, scope: selectedScope } : null),
    [selectedInView, selectedScope],
  );

  // `useQueries` 결과는 렌더마다 새 배열이다. 받은 데이터(참조)가 바뀔 때만 아래 계산을 다시 한다.
  const changesData = useShallowStable(results.map((r) => r.data));
  const changesByPath = useMemo(() => {
    const out = new Map<string, BranchChanges>();
    changesData.forEach((data, i) => {
      if (data) out.set(paths[i], data);
    });
    return out;
  }, [changesData, paths]);

  // 파일별 「봤음」 표시. 저장소마다 지금 목록의 (브랜치, 기준) 범위에서 지금 내용 그대로 본 파일만 센다.
  const marksByRepo = useFileReviewStore((s) => s.marksByRepo);
  const collapseViewed = useFileReviewStore((s) => s.collapseViewed);
  const setCollapseViewed = useFileReviewStore((s) => s.setCollapseViewed);
  const markViewed = useFileReviewStore((s) => s.markViewed);
  const unmarkViewed = useFileReviewStore((s) => s.unmarkViewed);
  const reviews = useMemo(() => {
    const out = new Map<string, RepoReview>();
    paths.forEach((path, i) => {
      const changes = changesByPath.get(path);
      if (!changes) return;
      const scope = reviewScopeOf(changes, scopes[i] ?? null);
      const marks = marksByRepo[trimTrailingSlash(path)];
      const viewed = changes.files.filter((f) => isViewed(marks, scope, toReviewable(f))).map((f) => f.path);
      out.set(path, { scope, viewed: new Set(viewed) });
    });
    return out;
  }, [paths, changesByPath, scopes, marksByRepo]);
  const isFileViewed = (repoPath: string, filePath: string) => reviews.get(repoPath)?.viewed.has(filePath) ?? false;
  const toggleViewed = (repoPath: string, file: BranchChangedFile) => {
    const review = reviews.get(repoPath);
    if (!review) return;
    if (review.viewed.has(file.path)) unmarkViewed(repoPath, review.scope, [file.path]);
    else markViewed(repoPath, review.scope, [toReviewable(file)]);
  };
  const setAllViewed = (viewed: boolean) => {
    for (const [repoPath, review] of reviews) {
      const files = changesByPath.get(repoPath)?.files ?? [];
      if (viewed) markViewed(repoPath, review.scope, files.map(toReviewable));
      else unmarkViewed(repoPath, review.scope, files.map((f) => f.path));
    }
  };
  const fileTotal = [...reviews.keys()].reduce((sum, p) => sum + (changesByPath.get(p)?.files.length ?? 0), 0);
  const viewedTotal = [...reviews.values()].reduce((sum, r) => sum + r.viewed.size, 0);
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null);

  const toggleCollapsed = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleSelect = (repoPath: string, file: BranchChangedFile) => {
    setSelected({ repoPath, filePath: file.path, oldPath: file.oldPath, status: file.status, scope: null });
  };

  // 파일 우클릭: 그 파일을 고르고 파일 메뉴(편집기·Finder·경로 복사)를 연다.
  const fileMenu = useFileMenu();
  // 저장소 그룹 머리 우클릭: 그 저장소(워크트리) 폴더 메뉴.
  const folderMenu = useFolderMenu();
  const openFileMenu = (repoPath: string, file: BranchChangedFile, e: React.MouseEvent) => {
    e.preventDefault();
    handleSelect(repoPath, file);
    fileMenu.open(
      {
        repoPath,
        filePath: file.path,
        exists: file.status !== "deleted",
        review: reviews.has(repoPath)
          ? { viewed: isFileViewed(repoPath, file.path), onToggle: () => toggleViewed(repoPath, file) }
          : undefined,
      },
      contextMenuPoint(e),
    );
  };

  // 크게 보는 diff 옆 파일 목록. 이 목록과 같은 순서·같은 선택을 쓴다(저장소가 여럿이면 저장소별로 묶는다).
  const maximizedEntries = repos.flatMap((repo) =>
    groupFiles(changesByPath.get(repo.path)?.files ?? [], groupBy).flatMap((group) =>
      group.files.map((file) => ({ repo, file })),
    ),
  );
  const maximizedFiles: MaximizedFiles = {
    items: maximizedEntries.map(({ repo, file }) => ({
      key: fileKey(repo.path, file.path),
      path: file.path,
      status: file.status,
      additions: file.isBinary ? null : file.additions,
      deletions: file.isBinary ? null : file.deletions,
      group: repos.length > 1 ? repoName(repo) : undefined,
      viewed: isFileViewed(repo.path, file.path),
    })),
    selectedKey: selected ? fileKey(selected.repoPath, selected.filePath) : null,
    onSelect: (key) => {
      const hit = maximizedEntries.find(({ repo, file }) => fileKey(repo.path, file.path) === key);
      if (hit) handleSelect(hit.repo.path, hit.file);
    },
    onContextMenu: (key, e) => {
      const hit = maximizedEntries.find(({ repo, file }) => fileKey(repo.path, file.path) === key);
      if (hit) openFileMenu(hit.repo.path, hit.file, e);
    },
    onToggleViewed: (key) => {
      const hit = maximizedEntries.find(({ repo, file }) => fileKey(repo.path, file.path) === key);
      if (hit) toggleViewed(hit.repo.path, hit.file);
    },
  };


  const titleBase = tabBaseName(paths.map((p, i) => ({ changes: changesByPath.get(p), scope: scopes[i] })));
  const single = repos.length === 1;
  const singleChanges = single ? results[0]?.data : undefined;
  const list = (
    <div className="flex flex-col min-h-0 h-full" data-testid="files-by-repo">
      <div
        className="flex flex-col gap-1 px-3 py-2.5 border-b border-(--line) shrink-0"
        data-testid="files-list-header"
        onContextMenu={(e) => {
          if (fileTotal === 0) return;
          e.preventDefault();
          setListMenu(contextMenuPoint(e));
        }}
      >
        <strong className="text-[12.5px] text-foreground">
          {titleBase ? t("filesByRepo.tab", { base: titleBase }) : t("filesByRepo.tabDefault")}
        </strong>
        <span className="text-[11.5px] text-muted-foreground" data-testid="files-summary">
          {single
            ? singleChanges
              ? changesSummary(singleChanges, scopes[0] ?? null, t)
              : t("filesByRepo.subtitleSingle")
            : t("filesByRepo.subtitleMany", { count: repos.length })}
        </span>
        {fileTotal > 0 && (
          <ViewedProgress
            viewed={viewedTotal}
            total={fileTotal}
            collapsed={collapseViewed}
            onToggleCollapsed={() => setCollapseViewed(!collapseViewed)}
          />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {repos.map((repo, i) => {
          const result = results[i];
          const changes = result?.data;
          const isCollapsed = collapsed.has(repo.path);
          const viewedHere = reviews.get(repo.path)?.viewed ?? new Set<string>();
          const hiddenViewed = collapseViewed ? viewedHere.size : 0;
          const shownFiles =
            changes && hiddenViewed > 0 ? changes.files.filter((f) => !viewedHere.has(f.path)) : changes?.files ?? [];
          return (
            <section key={repo.path} aria-label={repoName(repo)} data-repo={repo.path}>
              {changes && <FileReviewUpkeep repoPath={repo.path} changes={changes} scope={scopes[i] ?? null} />}
              <RepoGroupHeader
                repo={repo}
                changes={changes}
                scope={scopes[i] ?? null}
                collapsed={isCollapsed}
                onToggle={() => toggleCollapsed(repo.path)}
                onBaseChange={(base) => setBase(repo.path, base, repoDefaults[paths.indexOf(repo.path)] !== null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  folderMenu.open({ path: repo.path, branch: changes?.branch ?? null }, contextMenuPoint(e));
                }}
              />
              {isCollapsed ? null : result?.isError ? (
                <div className="flex items-center gap-1.5 px-3 py-2 text-[11.5px] text-danger">
                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                  {t("filesByRepo.loadFailed", { error: getErrorMessage(result.error) })}
                </div>
              ) : !changes ? (
                <div className="px-3 py-2 text-[11.5px] text-muted-foreground">{t("filesByRepo.loading")}</div>
              ) : (
                <>
                  {!single && <GroupNote t={t} changes={changes} scope={scopes[i] ?? null} />}
                  {changes.files.length === 0 ? (
                    <div className="px-3 py-2 text-[11.5px] text-muted-foreground">{t("filesByRepo.noChanges")}</div>
                  ) : (
                    groupFiles(shownFiles, groupBy).map((group) => (
                      <div key={group.dir ?? ""} role={group.dir === null ? undefined : "group"} aria-label={group.dir ?? undefined}>
                        {group.dir !== null && <FolderHeader dir={group.dir} />}
                        {group.files.map((file) => (
                          <FileRow
                            key={`${file.status}:${file.path}`}
                            file={file}
                            showDir={group.dir === null}
                            selected={sameFile(selected, { repoPath: repo.path, filePath: file.path })}
                            viewed={viewedHere.has(file.path)}
                            onSelect={() => handleSelect(repo.path, file)}
                            onToggleViewed={() => toggleViewed(repo.path, file)}
                            onContextMenu={(e) => openFileMenu(repo.path, file, e)}
                          />
                        ))}
                      </div>
                    ))
                  )}
                  {hiddenViewed > 0 && (
                    <button
                      type="button"
                      onClick={() => setCollapseViewed(false)}
                      aria-expanded={false}
                      data-testid="viewed-group"
                      className="flex w-full items-center gap-1.5 min-h-7 px-3 border-b border-(--line) text-left text-[11.5px] text-muted-foreground hover:bg-accent/60"
                    >
                      <ChevronRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {t("fileReview.viewedGroup", { count: hiddenViewed })}
                    </button>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );

  const detail = selected ? (
    <SelectedFileDiff key={fileKey(selected.repoPath, selected.filePath)} file={selected} />
  ) : (
    <EmptyState icon={FileText} title={t("filesByRepo.selectTitle")} description={t("filesByRepo.selectHint")} />
  );

  return (
    <ListDiffSplit variant="cards" list={list} detail={detail} files={maximizedFiles}>
      {/* 다른 화면(ContentArea, FollowPanel)과 달리 이 탭에는 전환 덮개가 없었다(W7 리뷰) —
          브랜치 전환 중에도 목록·diff를 그대로 누를 수 있었다. */}
      <SwitchingOverlay />
      {fileMenu.element}
      {folderMenu.element}
      {listMenu && (
        <ContextMenu
          sections={[
            {
              items: [
                {
                  label: t("fileReview.markAllViewed"),
                  icon: <SquareCheck className="w-3.5 h-3.5" />,
                  onClick: () => setAllViewed(true),
                  disabled: viewedTotal === fileTotal,
                },
                {
                  label: t("fileReview.unmarkAll"),
                  icon: <Square className="w-3.5 h-3.5" />,
                  onClick: () => setAllViewed(false),
                  disabled: viewedTotal === 0,
                },
              ],
            },
          ]}
          position={listMenu}
          onClose={() => setListMenu(null)}
          ariaLabel={t("fileReview.listMenu")}
        />
      )}
    </ListDiffSplit>
  );
}

interface FileGroup {
  /** 폴더별일 때 그 폴더(맨 위는 ""), 저장소별일 때 null. */
  dir: string | null;
  files: BranchChangedFile[];
}

/** 저장소 그룹 안의 파일을 그대로 두거나(`repo`) 폴더별로 나눈다(`folder`, 폴더 이름순). */
function groupFiles(files: readonly BranchChangedFile[], groupBy: FilesGroupBy): FileGroup[] {
  if (groupBy === "repo") return [{ dir: null, files: [...files] }];
  const byDir = new Map<string, BranchChangedFile[]>();
  for (const file of files) {
    const { dir } = splitPath(file.path);
    byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, dirFiles]) => ({ dir, files: dirFiles }));
}

function FolderHeader({ dir }: { dir: string }) {
  return (
    <div className="flex items-center gap-1.5 h-6 pl-7 pr-3 border-b border-(--line) text-[11px] text-muted-foreground">
      <Folder className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{dir || "/"}</span>
    </div>
  );
}

/** 저장소 그룹 머리: 접기, 저장소 색·이름, 그 저장소의 지금(또는 보는) 브랜치, 파일 수, 비교 기준 선택. */
function RepoGroupHeader({
  repo,
  changes,
  scope,
  collapsed,
  onToggle,
  onBaseChange,
  onContextMenu,
}: {
  repo: FilesByRepoRepo;
  changes: BranchChanges | undefined;
  scope: ChangesScope | null;
  collapsed: boolean;
  onToggle: () => void;
  onBaseChange: (base: string | null) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const color = repoLaneColor(repo.path);
  const name = useRepoName()(repo);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="flex items-center gap-2 pr-3 bg-(--acc-faint) border-b border-(--line)" onContextMenu={onContextMenu}>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={repo.path}
      className="flex flex-1 min-w-0 items-center gap-2 pl-3 py-2 text-left hover:bg-accent transition-colors"
    >
      <Chevron className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span
        className="flex items-center justify-center w-4 h-4 shrink-0 rounded-[4px] text-[9px] font-bold"
        style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <strong className="text-[12px] text-foreground truncate">{name}</strong>
      {changes && (
        <span
          className="inline-flex items-center gap-1 min-w-0 font-mono text-[10.5px] text-muted-foreground"
          data-testid="group-branch"
        >
          <GitBranch className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{changes.branch ?? t("filesByRepo.detached")}</span>
        </span>
      )}
      <span className="flex-1" />
      {changes && (
        <span className="shrink-0 text-[11px] text-(--faint)">
          {t("filesByRepo.fileCount", { count: changes.files.length })}
        </span>
      )}
    </button>
      <BasePicker
        path={repo.path}
        value={scope?.base ?? null}
        defaultBranch={changes?.defaultBranch ?? null}
        exclude={changes?.branch ?? null}
        onChange={onBaseChange}
      />
    </div>
  );
}

/** 저장소가 여럿일 때 그룹마다 무엇과 비교했는지 한 줄로 알린다(하나면 목록 맨 위에 있다). */
function GroupNote({ t, changes, scope }: { t: TFunction; changes: BranchChanges; scope: ChangesScope | null }) {
  return (
    <div className="px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground" data-testid="group-note">
      {changesSummary(changes, scope, t)}
    </div>
  );
}

interface FileRowProps {
  file: BranchChangedFile;
  /** 파일 이름 옆에 폴더를 흐리게 붙일지(폴더별로 나눴으면 머리에 있으니 뺀다). */
  showDir: boolean;
  selected: boolean;
  /** 지금 내용 그대로 봤음으로 표시했는가. 흐리게 보인다. */
  viewed: boolean;
  onSelect: () => void;
  onToggleViewed: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function FileRow({ file, showDir, selected, viewed, onSelect, onToggleViewed, onContextMenu }: FileRowProps) {
  const { t } = useTranslation();
  const { name, dir } = splitPath(file.path);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      data-viewed={viewed || undefined}
      className={cn(
        "flex items-center gap-2 min-h-7 px-3 border-b border-(--line) cursor-pointer select-none hover:bg-accent/60",
        selected && "bg-(--acc-sel) hover:bg-(--acc-sel)",
      )}
    >
      <span className={cn("flex flex-1 min-w-0 items-center gap-2", viewed && "opacity-50")}>
        <span className={cn("w-2.5 shrink-0 font-mono text-[10.5px] font-bold", statusTextColors[file.status])}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">
          {name} {showDir && dir && <span className="text-[11px] text-(--faint)">{dir}</span>}
        </span>
        {file.isBinary ? (
          <span className="shrink-0 text-[10.5px] text-(--faint)">{t("filesByRepo.binary")}</span>
        ) : (
          <>
            {file.additions > 0 && (
              <span className="shrink-0 font-mono text-[11px] text-diff-add-fg">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="shrink-0 font-mono text-[11px] text-diff-del-fg">−{file.deletions}</span>
            )}
          </>
        )}
      </span>
      <ViewedCheckbox viewed={viewed} path={file.path} onToggle={onToggleViewed} />
    </div>
  );
}

/**
 * 저장소 하나의 「봤음」 표시 정리: 새 목록에서 빠졌거나 내용이 바뀐 파일의 표시와, 브랜치·기준이
 * 사라진 표시를 지운다. 화면에는 아무것도 그리지 않는다.
 */
function FileReviewUpkeep({
  repoPath,
  changes,
  scope,
}: {
  repoPath: string;
  changes: BranchChanges;
  scope: ChangesScope | null;
}) {
  const reconcile = useFileReviewStore((s) => s.reconcile);
  const pruneMissingRefs = useFileReviewStore((s) => s.pruneMissingRefs);
  const { data: branches } = useBranches(repoPath);
  useEffect(() => {
    reconcile(repoPath, reviewScopeOf(changes, scope), changes.files.map(toReviewable));
  }, [reconcile, repoPath, changes, scope]);
  useEffect(() => {
    if (branches) pruneMissingRefs(repoPath, new Set(branches.map((b) => b.name)));
  }, [pruneMissingRefs, repoPath, branches]);
  return null;
}

/** 고른 파일 하나를 그 저장소 기준과 갈라진 지점 → 작업 트리(보는 중이면 그 브랜치)로 비교한다. */
function SelectedFileDiff({ file }: { file: SelectedFile }) {
  const { t } = useTranslation();
  const targets = useMemo(() => [file], [file]);
  const [result] = useFileDiffsVsDefault(targets);
  if (result?.isError) {
    return <div className="flex-1 flex items-center justify-center text-sm text-danger">{t("diff.failedToLoad")}</div>;
  }
  if (!result?.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("filesByRepo.loading")}
      </div>
    );
  }
  return <DiffViewer diff={result.data} status={file.status} maximizable repoPath={file.repoPath} />;
}

/**
 * `repo:activity`를 받으면 그 저장소의 main 대비 변경과 파일 diff를 다시 읽는다.
 * 감시에 들지 않은 저장소는 `CHANGES_VS_DEFAULT_POLL_MS` 주기 갱신이 대신한다.
 */
function useChangesActivityRefresh(paths: readonly string[]): void {
  const queryClient = useQueryClient();
  const key = paths.map(trimTrailingSlash).join("\n");
  const watched = useMemo(() => new Set(key.split("\n").filter(Boolean)), [key]);
  useTauriEvent(TAURI_EVENTS.repoActivity, (activity) => {
    const path = trimTrailingSlash(activity.path);
    if (!watched.has(path)) return;
    void queryClient.invalidateQueries({
      predicate: (q) =>
        (q.queryKey[0] === "changesVsDefault" || q.queryKey[0] === "fileDiffVsDefault") &&
        typeof q.queryKey[1] === "string" &&
        trimTrailingSlash(q.queryKey[1]) === path,
    });
  });
}

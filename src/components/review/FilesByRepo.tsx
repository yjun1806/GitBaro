import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Folder, GitBranch, X } from "lucide-react";
import { useChangesVsDefaultMany, useFileDiffsVsDefault } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { EmptyState } from "@/components/layout/ContentArea";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import type { MaximizedFiles } from "@/components/layout/maximized-files";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { RepoLaneTag } from "@/components/graph/CommitGraph";
import { normalizePath } from "@/components/graph/graph-model";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import {
  fileKey,
  findLinkedChanges,
  isLinkableFile,
  splitByToken,
  type FileLink,
  type FileRef,
  type LinkSource,
} from "@/lib/linked-changes";
import { statusTextColors } from "@/lib/file-status";
import { cn, getErrorMessage } from "@/lib/utils";
import type { ActivityEvent, BranchChangedFile, BranchChanges, ChangesScope, DiffOutput, FileStatus } from "@/types";
import type { FilesGroupBy } from "./files-view";
import { changesSummary, tabBaseName, useChangesScopes, useCompareBaseStore } from "./compare-base";
import { BasePicker } from "./BasePicker";

/** 연결된 변경을 찾으려고 diff를 읽는 파일 수의 상한(저장소를 모두 합쳐). */
export const LINK_SCAN_FILE_LIMIT = 80;
/** 이보다 많이 추가한 파일은 연결을 찾지 않는다(생성 파일일 가능성이 크다). */
const LINK_SCAN_MAX_ADDITIONS = 3000;

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

interface OpenLink {
  from: FileRef;
  link: FileLink;
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
  const ref = useRef(items);
  const prev = ref.current;
  if (prev !== items && (prev.length !== items.length || prev.some((item, i) => item !== items[i]))) {
    ref.current = items;
  }
  return ref.current;
}

function sameFile(a: FileRef | null, b: FileRef | null): boolean {
  return a !== null && b !== null && a.repoPath === b.repoPath && a.filePath === b.filePath;
}

function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf("/");
  return at === -1 ? { name: path, dir: "" } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}

function addedLinesOf(diff: DiffOutput): string[] {
  return diff.hunks.flatMap((h) => h.lines.filter((l) => l.lineType === "add").map((l) => l.content));
}

/**
 * main 대비 변경(D7, 예전 이름 「main 대비 변경」). 저장소마다 그 저장소의 main(또는 고른 기준 브랜치)과
 * 갈라진 지점 이후로 바뀐 파일(커밋 안 한 변경 포함)을 저장소별 그룹으로 보여 주고, 그룹 머리에 그 저장소의
 * 브랜치와 비교 기준 선택을 단다. 체크아웃하지 않고 다른 브랜치를 보는 중이면 그 브랜치를 기준과 비교한다
 * (커밋 안 한 변경은 빼고). 서로 다른 저장소가 같은 문자열을 새로 추가했으면
 * 「연결된 변경」으로 표시하고 나란히 보여 준다. 연결은 문자열 일치로 찾은 추정이다.
 */
export function FilesByRepo({ repos, groupBy = "repo" }: FilesByRepoProps) {
  const { t } = useTranslation();
  // 부모가 렌더마다 새 배열을 넘겨도(워크스페이스의 보이는 저장소 목록) 경로가 같으면 같은 배열을 쓴다.
  const paths = useShallowStable(repos.map((r) => r.path));
  const scopes = useChangesScopes(paths);
  const results = useChangesVsDefaultMany(paths, scopes);
  const setBase = useCompareBaseStore((s) => s.setBase);
  const scopeOf = (repoPath: string): ChangesScope | null => scopes[paths.indexOf(repoPath)] ?? null;
  useChangesActivityRefresh(paths);

  const [selectedState, setSelected] = useState<SelectedFile | null>(null);
  const [openLinkState, setOpenLink] = useState<OpenLink | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // 고른 파일·연결이 지금 보이는 저장소 것이 아니면(저장소를 바꿨거나 「조용한 저장소 숨기기」로 빠졌으면) 버린다.
  const shown = useMemo(() => new Set(paths), [paths]);
  // 비교 범위(기준·보는 브랜치)가 바뀌어도 고른 파일은 그대로 두고, diff만 새 범위로 다시 읽는다.
  const selectedInView = selectedState && shown.has(selectedState.repoPath) ? selectedState : null;
  const selectedScope = selectedInView ? scopeOf(selectedInView.repoPath) : null;
  const selected = useMemo(
    () => (selectedInView ? { ...selectedInView, scope: selectedScope } : null),
    [selectedInView, selectedScope],
  );
  const openLink =
    openLinkState &&
    shown.has(openLinkState.from.repoPath) &&
    openLinkState.link.others.some((o) => shown.has(o.repoPath))
      ? openLinkState
      : null;

  // `useQueries` 결과는 렌더마다 새 배열이다. 받은 데이터(참조)가 바뀔 때만 아래 계산을 다시 한다.
  const changesData = useShallowStable(results.map((r) => r.data));
  const changesByPath = useMemo(() => {
    const out = new Map<string, BranchChanges>();
    changesData.forEach((data, i) => {
      if (data) out.set(paths[i], data);
    });
    return out;
  }, [changesData, paths]);

  const oldPathOf = (ref: FileRef): string | null =>
    changesByPath.get(ref.repoPath)?.files.find((f) => f.path === ref.filePath)?.oldPath ?? null;

  // 연결은 다른 저장소와만 맺으므로 저장소가 둘 이상일 때만 diff를 읽는다. 저장소 순서대로
  // 다 채우면 파일이 많은 저장소 하나가 예산을 다 써서 나머지 저장소는 diff를 하나도 못
  // 읽는다(W7 리뷰) — 그래서 저장소를 한 바퀴씩 돌며(라운드로빈) 고른다.
  const eligibleByRepo = useMemo(() => {
    if (paths.length < 2) return [];
    return paths.map((repoPath) =>
      (changesByPath.get(repoPath)?.files ?? [])
        .filter(
          (f) =>
            !f.isBinary &&
            f.status !== "deleted" &&
            f.additions > 0 &&
            f.additions <= LINK_SCAN_MAX_ADDITIONS &&
            isLinkableFile(f.path),
        )
        .map((f) => ({ repoPath, filePath: f.path, oldPath: f.oldPath, scope: scopes[paths.indexOf(repoPath)] })),
    );
  }, [paths, changesByPath, scopes]);
  const eligibleCount = useMemo(() => eligibleByRepo.reduce((n, files) => n + files.length, 0), [eligibleByRepo]);
  const scanTargets = useMemo(() => {
    const out: { repoPath: string; filePath: string; oldPath: string | null; scope: ChangesScope | null }[] = [];
    const cursors = eligibleByRepo.map(() => 0);
    let added = true;
    while (out.length < LINK_SCAN_FILE_LIMIT && added) {
      added = false;
      for (let i = 0; i < eligibleByRepo.length && out.length < LINK_SCAN_FILE_LIMIT; i++) {
        const files = eligibleByRepo[i];
        if (cursors[i] < files.length) {
          out.push(files[cursors[i]]);
          cursors[i]++;
          added = true;
        }
      }
    }
    return out;
  }, [eligibleByRepo]);
  const scanResults = useFileDiffsVsDefault(scanTargets);
  const scanDiffs = useShallowStable(scanResults.map((r) => r.data));

  // 파일 수백 개의 줄을 훑는 계산이다. 대상이나 받은 diff가 바뀔 때만 다시 한다.
  const links = useMemo(() => {
    const sources: LinkSource[] = [];
    scanTargets.forEach((target, i) => {
      const diff = scanDiffs[i];
      if (diff && !diff.binary) sources.push({ ...target, addedLines: addedLinesOf(diff) });
    });
    return findLinkedChanges(sources);
  }, [scanTargets, scanDiffs]);

  const toggleCollapsed = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleSelect = (repoPath: string, file: BranchChangedFile) => {
    setOpenLink(null);
    setSelected({ repoPath, filePath: file.path, oldPath: file.oldPath, status: file.status, scope: null });
  };

  const handleOpenLink = (repoPath: string, file: BranchChangedFile, link: FileLink) => {
    setSelected({ repoPath, filePath: file.path, oldPath: file.oldPath, status: file.status, scope: null });
    setOpenLink({ from: { repoPath, filePath: file.path }, link });
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
      group: repos.length > 1 ? repo.name : undefined,
    })),
    selectedKey: selected ? fileKey(selected.repoPath, selected.filePath) : null,
    onSelect: (key) => {
      const hit = maximizedEntries.find(({ repo, file }) => fileKey(repo.path, file.path) === key);
      if (hit) handleSelect(hit.repo.path, hit.file);
    },
  };

  const nameOf = (path: string) => repos.find((r) => r.path === path)?.name ?? path;
  const linksScanned = scanTargets.length > 0;
  const linksTruncated = repos.length >= 2 && eligibleCount > LINK_SCAN_FILE_LIMIT;

  const titleBase = tabBaseName(paths.map((p, i) => ({ changes: changesByPath.get(p), scope: scopes[i] })));
  const single = repos.length === 1;
  const singleChanges = single ? results[0]?.data : undefined;
  const list = (
    <div className="flex flex-col min-h-0 h-full" data-testid="files-by-repo">
      <div className="flex flex-col gap-1 px-3 py-2.5 border-b border-(--line) shrink-0">
        <strong className="text-[12.5px] text-foreground">
          {titleBase ? t("filesByRepo.tab", { base: titleBase }) : t("filesByRepo.tabDefault")}
        </strong>
        <span className="text-[11.5px] text-muted-foreground" data-testid="files-summary">
          {single
            ? singleChanges
              ? changesSummary(singleChanges, scopes[0] ?? null, t)
              : t("filesByRepo.subtitleSingle")
            : t("filesByRepo.subtitleMany", { count: repos.length })}
          {linksTruncated && ` · ${t("filesByRepo.linksTruncated", { count: LINK_SCAN_FILE_LIMIT })}`}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {repos.map((repo, i) => {
          const result = results[i];
          const changes = result?.data;
          const isCollapsed = collapsed.has(repo.path);
          return (
            <section key={repo.path} aria-label={repo.name} data-repo={repo.path}>
              <RepoGroupHeader
                repo={repo}
                changes={changes}
                scope={scopes[i] ?? null}
                collapsed={isCollapsed}
                onToggle={() => toggleCollapsed(repo.path)}
                onBaseChange={(base) => setBase(repo.path, base)}
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
                    groupFiles(changes.files, groupBy).map((group) => (
                      <div key={group.dir ?? ""} role={group.dir === null ? undefined : "group"} aria-label={group.dir ?? undefined}>
                        {group.dir !== null && <FolderHeader dir={group.dir} />}
                        {group.files.map((file) => (
                          <FileRow
                            key={`${file.status}:${file.path}`}
                            file={file}
                            showDir={group.dir === null}
                            links={links.get(fileKey(repo.path, file.path)) ?? []}
                            selected={sameFile(selected, { repoPath: repo.path, filePath: file.path })}
                            onSelect={() => handleSelect(repo.path, file)}
                            onOpenLink={(link) => handleOpenLink(repo.path, file, link)}
                          />
                        ))}
                      </div>
                    ))
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      {linksScanned && (
        <div className="px-3 py-2 border-t border-(--line) text-[11px] text-(--faint) shrink-0">
          {t("filesByRepo.linkHint")}
        </div>
      )}
    </div>
  );

  const detail = openLink ? (
    <LinkedCompare
      key={`${fileKey(openLink.from.repoPath, openLink.from.filePath)}:${openLink.link.token}`}
      openLink={openLink}
      nameOf={nameOf}
      oldPathOf={oldPathOf}
      scopeOf={scopeOf}
      onClose={() => setOpenLink(null)}
    />
  ) : selected ? (
    <SelectedFileDiff key={fileKey(selected.repoPath, selected.filePath)} file={selected} />
  ) : (
    <EmptyState icon={FileText} title={t("filesByRepo.selectTitle")} description={t("filesByRepo.selectHint")} />
  );

  return (
    <ListDiffSplit variant="cards" list={list} detail={detail} files={maximizedFiles}>
      {/* 다른 화면(ContentArea, FollowPanel)과 달리 이 탭에는 전환 덮개가 없었다(W7 리뷰) —
          브랜치 전환 중에도 목록·diff를 그대로 누를 수 있었다. */}
      <SwitchingOverlay />
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
}: {
  repo: FilesByRepoRepo;
  changes: BranchChanges | undefined;
  scope: ChangesScope | null;
  collapsed: boolean;
  onToggle: () => void;
  onBaseChange: (base: string | null) => void;
}) {
  const { t } = useTranslation();
  const color = repoLaneColor(repo.path);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="flex items-center gap-2 pr-3 bg-(--acc-faint) border-b border-(--line)">
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
        {repo.name.slice(0, 1).toUpperCase()}
      </span>
      <strong className="text-[12px] text-foreground truncate">{repo.name}</strong>
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
  links: readonly FileLink[];
  selected: boolean;
  onSelect: () => void;
  onOpenLink: (link: FileLink) => void;
}

function FileRow({ file, showDir, links, selected, onSelect, onOpenLink }: FileRowProps) {
  const { t } = useTranslation();
  const { name, dir } = splitPath(file.path);
  const first = links[0];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      className={cn(
        "flex items-center gap-2 min-h-7 px-3 border-b border-(--line) cursor-pointer select-none hover:bg-accent/60",
        selected && "bg-(--acc-sel) hover:bg-(--acc-sel)",
      )}
    >
      <span className={cn("w-2.5 shrink-0 font-mono text-[10.5px] font-bold", statusTextColors[file.status])}>
        {STATUS_LETTER[file.status]}
      </span>
      <span className="flex-1 min-w-0 truncate text-[12.5px] text-foreground">
        {name} {showDir && dir && <span className="text-[11px] text-(--faint)">{dir}</span>}
      </span>
      {first && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenLink(first);
          }}
          title={
            links.length === 1
              ? t("filesByRepo.linkChipTitleSingle", { token: first.token })
              : t("filesByRepo.linkChipTitleMany", { token: first.token, count: links.length })
          }
          className="inline-flex items-center gap-1 max-w-[150px] shrink-0 px-1.5 py-px rounded-(--radius-chip) bg-(--chip) text-[10.5px] font-bold text-(--fg2) hover:bg-accent"
          data-testid="link-chip"
        >
          <span className="shrink-0" aria-hidden="true">
            ⟷
          </span>
          <span className="truncate">{first.token}</span>
          {links.length > 1 && <span className="shrink-0 text-(--faint)">+{links.length - 1}</span>}
        </button>
      )}
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
    </div>
  );
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
  return <DiffViewer diff={result.data} status={file.status} maximizable />;
}

/** 연결된 변경: 두 저장소 파일에서 같은 문자열이 추가된 부분을 나란히 보여 준다. */
function LinkedCompare({
  openLink,
  nameOf,
  oldPathOf,
  scopeOf,
  onClose,
}: {
  openLink: OpenLink;
  nameOf: (repoPath: string) => string;
  /** 저장소의 비교 범위. 목록과 같은 기준으로 diff를 읽는다. */
  scopeOf: (repoPath: string) => ChangesScope | null;
  /** 이름을 바꾼 파일의 옛 경로. 이것이 있어야 main 쪽 내용과 비교된다. */
  oldPathOf: (ref: FileRef) => string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { from, link } = openLink;
  const [otherIndex, setOtherIndex] = useState(0);
  const other = link.others[Math.min(otherIndex, link.others.length - 1)];
  const fromOld = oldPathOf(from);
  const otherOld = oldPathOf(other);
  // 목록에서 연결을 찾을 때 읽은 diff와 같은 키라 캐시를 그대로 쓴다.
  const fromScope = scopeOf(from.repoPath);
  const otherScope = scopeOf(other.repoPath);
  const sides = useMemo(
    () => [
      { ...from, oldPath: fromOld, scope: fromScope },
      { ...other, oldPath: otherOld, scope: otherScope },
    ],
    [from, other, fromOld, otherOld, fromScope, otherScope],
  );
  const [mine, theirs] = useFileDiffsVsDefault(sides);
  const repoNames = [nameOf(from.repoPath), nameOf(other.repoPath)].join(", ");

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="linked-compare">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-(--line) shrink-0 min-w-0">
        <strong className="shrink-0 text-[12.5px] text-foreground">{t("filesByRepo.linkedTitle")}</strong>
        <span className="flex-1 min-w-0 truncate text-[11.5px] text-muted-foreground">
          {t("filesByRepo.linkedSummary", { repos: repoNames })}{" "}
          <span className="font-mono text-foreground">{link.token}</span>
          {" · "}
          <span className="text-(--faint)">{t("filesByRepo.estimate")}</span>
        </span>
        {link.others.length > 1 && (
          <select
            aria-label={t("filesByRepo.pickOther")}
            value={otherIndex}
            onChange={(e) => setOtherIndex(Number(e.target.value))}
            className="shrink-0 h-6 max-w-[180px] px-1.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] text-(--fg2)"
          >
            {link.others.map((o, i) => (
              <option key={fileKey(o.repoPath, o.filePath)} value={i}>
                {nameOf(o.repoPath)} / {o.filePath}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 flex items-center gap-1 h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {t("filesByRepo.closeLink")}
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <LinkedHalf file={from} label={nameOf(from.repoPath)} diff={mine?.data} token={link.token} />
        <LinkedHalf file={other} label={nameOf(other.repoPath)} diff={theirs?.data} token={link.token} />
      </div>
    </div>
  );
}

/** 연결된 변경의 한쪽: 그 문자열이 추가된 구간(hunk)만 보여 주고 문자열을 강조한다. */
function LinkedHalf({
  file,
  label,
  diff,
  token,
}: {
  file: FileRef;
  label: string;
  diff: DiffOutput | undefined;
  token: string;
}) {
  const { t } = useTranslation();
  const hunks = useMemo(
    () =>
      (diff?.hunks ?? []).filter((h) => h.lines.some((l) => l.lineType === "add" && l.content.includes(token))),
    [diff, token],
  );
  return (
    <div className="flex flex-col flex-1 min-w-0 border-r border-(--line) last:border-r-0">
      <div className="flex items-center gap-2 h-[34px] px-3 border-b border-(--line) shrink-0 min-w-0">
        <RepoLaneTag repoPath={file.repoPath} label={label} />
        <strong className="truncate text-[12px] text-foreground" title={file.filePath}>
          {file.filePath}
        </strong>
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1 font-mono text-[12px]">
        {!diff ? (
          <div className="px-3 py-2 text-[11.5px] text-muted-foreground font-sans">{t("filesByRepo.loading")}</div>
        ) : (
          hunks.map((h) => (
            <div key={`${h.oldStart}:${h.newStart}`} className="mb-2">
              {h.lines.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex leading-(--code-lh)",
                    l.lineType === "add" && "bg-diff-add text-diff-add-fg",
                    l.lineType === "delete" && "bg-diff-del text-diff-del-fg",
                    l.lineType === "context" && "text-(--fg2)",
                  )}
                >
                  <span className="w-[38px] shrink-0 pr-1 text-right text-(--ln) select-none">
                    {l.newLineNo ?? ""}
                  </span>
                  <span className="w-5 shrink-0 text-center select-none">
                    {l.lineType === "add" ? "+" : l.lineType === "delete" ? "−" : ""}
                  </span>
                  <span className="whitespace-pre pr-3">
                    {splitByToken(l.content, token).map((part, j) =>
                      part.match ? (
                        <mark
                          key={j}
                          className="bg-[color-mix(in_srgb,var(--amber-400)_35%,transparent)] text-inherit rounded-[2px]"
                        >
                          {part.text}
                        </mark>
                      ) : (
                        <span key={j}>{part.text}</span>
                      ),
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * `repo:activity`를 받으면 그 저장소의 main 대비 변경과 파일 diff를 다시 읽는다.
 * 감시에 들지 않은 저장소는 `CHANGES_VS_DEFAULT_POLL_MS` 주기 갱신이 대신한다.
 */
function useChangesActivityRefresh(paths: readonly string[]): void {
  const queryClient = useQueryClient();
  const key = paths.map(normalizePath).join("\n");
  useEffect(() => {
    const watched = new Set(key.split("\n").filter(Boolean));
    let mounted = true;
    let unlisten: (() => void) | undefined;
    listen<ActivityEvent>("repo:activity", (event) => {
      if (!mounted) return;
      const path = normalizePath(event.payload.path);
      if (!watched.has(path)) return;
      void queryClient.invalidateQueries({
        predicate: (q) =>
          (q.queryKey[0] === "changesVsDefault" || q.queryKey[0] === "fileDiffVsDefault") &&
          typeof q.queryKey[1] === "string" &&
          normalizePath(q.queryKey[1]) === path,
      });
    })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 이벤트를 못 받아도 주기적 갱신이 대신한다 */
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [queryClient, key]);
}

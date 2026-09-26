import { useTranslation } from "react-i18next";
import { FileText, X } from "lucide-react";
import { useRangeChangedFiles, useRangeFileDiff } from "@/api/queries";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import { EmptyState } from "@/components/layout/ContentArea";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { FileStatusBadge } from "@/lib/file-status";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/LoadingState";
import { useUnpushedRangeViewStore } from "./unpushed-range-view";
import type { RangeChangedFile } from "@/types";

/** 파일 경로를 폴더와 이름으로 나눈다. */
function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf("/");
  return at === -1 ? { name: path, dir: "" } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}

/**
 * 「올리지 않은 작업」 머리의 「올릴 내용 합쳐 보기」가 여는 칸(그래프 패널 아래, PR 상세와 같은
 * 자리). base(원격에 있는 첫 커밋)에서 head(HEAD)까지 바뀐 파일을 목록 + diff 두 칸으로 보여 준다.
 * 커밋 안 한 변경은 범위에 없으므로(push에 실리지 않는다) 다루지 않는다. 파일마다 「봤음」 체크는
 * 두지 않는다(리뷰 기준은 이미 push 안 한 커밋 자체다).
 */
export function UnpushedRangeDetailPane() {
  const { t } = useTranslation();
  const range = useUnpushedRangeViewStore((s) => s.range);
  const selectedFile = useUnpushedRangeViewStore((s) => s.selectedFile);
  const selectFile = useUnpushedRangeViewStore((s) => s.selectFile);
  const close = useUnpushedRangeViewStore((s) => s.close);

  const filesQuery = useRangeChangedFiles(range?.repoPath ?? null, range?.baseOid ?? null, range?.headOid ?? null);
  const fileList = filesQuery.data ?? [];
  const file = fileList.find((f) => f.path === selectedFile) ?? null;
  const diffQuery = useRangeFileDiff(
    range?.repoPath ?? null,
    range?.baseOid ?? null,
    range?.headOid ?? null,
    file ? { path: file.path, oldPath: file.oldPath } : null,
  );

  if (!range) return null;

  return (
    <ListDiffSplit
      variant="cards"
      className="animate-content-in"
      list={
        <UnpushedRangeFileList
          files={fileList}
          loading={filesQuery.isLoading}
          error={filesQuery.isError}
          selectedFile={selectedFile}
          onSelectFile={selectFile}
          onClose={close}
        />
      }
      detail={
        !selectedFile ? (
          <EmptyState icon={FileText} title={t("diff.noFileSelected")} description={t("diff.selectFile")} />
        ) : diffQuery.isLoading ? (
          <LoadingState label={t("diff.loadingDiff")} />
        ) : (
          <DiffViewer diff={diffQuery.data ?? null} status={file?.status} maximizable repoPath={range.repoPath} />
        )
      }
    />
  );
}

function UnpushedRangeFileList({
  files,
  loading,
  error,
  selectedFile,
  onSelectFile,
  onClose,
}: {
  files: readonly RangeChangedFile[];
  loading: boolean;
  error: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const totals = files.reduce(
    (sum, f) => ({ additions: sum.additions + f.additions, deletions: sum.deletions + f.deletions }),
    { additions: 0, deletions: 0 },
  );
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-2 h-8 px-3 border-b border-(--line) shrink-0">
        <span className="flex-1 min-w-0 truncate text-[12.5px] font-bold text-foreground">
          {t("graph.unpushedRangeTitle")}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
          className="flex items-center justify-center w-6 h-6 rounded-(--radius-item) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </header>
      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[11px] font-semibold text-(--faint) shrink-0">
        <span>{t("pr.changedFiles", { count: files.length })}</span>
        <span className="text-diff-add-fg font-mono">+{totals.additions}</span>
        <span className="text-diff-del-fg font-mono">−{totals.deletions}</span>
      </div>
      {loading ? (
        <LoadingState layout="row" />
      ) : error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diff.failedToLoad")}</p>
      ) : files.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("graph.unpushedRangeEmpty")}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {files.map((f) => {
            const { name, dir } = splitPath(f.path);
            return (
              <button
                key={f.path}
                type="button"
                title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                onClick={() => onSelectFile(f.path)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  selectedFile === f.path ? "bg-(--acc-sel)" : "hover:bg-accent",
                )}
              >
                <FileStatusBadge status={f.status} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-xs font-medium truncate text-foreground">{name}</span>
                  {dir && <span className="text-[10px] leading-tight text-muted-foreground/50 truncate">{dir}</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  <span className="text-diff-add-fg">+{f.additions}</span> <span className="text-diff-del-fg">−{f.deletions}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

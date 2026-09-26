import { useTranslation } from "react-i18next";
import { FileText, X } from "lucide-react";
import { useRangeChangedFiles, useRangeFileDiff } from "@/api/queries";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import type { MaximizedOrigin } from "@/components/layout/maximized-files";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { Code, FileStatusLetter } from "@/components/ui/marks";
import { DiffViewer } from "@/components/diff/DiffViewer";
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

  const origin: MaximizedOrigin = {
    kind: "range",
    label: (
      <>
        <span className="font-semibold text-foreground shrink-0">{t("graph.unpushedRangeTitle")}</span>
        <Code>{`${range.baseOid ? range.baseOid.slice(0, 7) : "…"} ‥ ${range.headOid.slice(0, 7)}`}</Code>
      </>
    ),
    meta: t("graph.unpushedHeader"),
  };

  return (
    <ListDiffSplit
      variant="cards"
      className="animate-content-in"
      origin={origin}
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
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </header>
      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground shrink-0">
        <span>{t("pr.changedFiles", { count: files.length })}</span>
        <span className="text-diff-add-fg font-mono">+{totals.additions}</span>
        <span className="text-diff-del-fg font-mono">−{totals.deletions}</span>
      </div>
      {loading ? (
        <LoadingState layout="row" />
      ) : error ? (
        <Notice tone="danger">{t("diff.failedToLoad")}</Notice>
      ) : files.length === 0 ? (
        <EmptyState layout="row" title={t("graph.unpushedRangeEmpty")} />
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
                  "w-full flex items-center gap-2 h-7 px-3 text-left transition-colors",
                  selectedFile === f.path ? "bg-(--acc-sel)" : "hover:bg-accent",
                )}
              >
                <FileStatusLetter status={f.status} />
                <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
                  <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">{name}</span>
                  {dir && <span className="shrink-0 truncate text-[11.5px] text-muted-foreground">{dir}</span>}
                </span>
                <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
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

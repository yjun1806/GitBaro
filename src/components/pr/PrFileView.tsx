import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FileQuestion, MessageSquare } from "lucide-react";
import { usePullRequestFileDiff } from "@/api/queries";
import { useMenuActions } from "@/hooks/useMenuActions";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { cn } from "@/lib/utils";
import type { DiffOutput, PrFile, PullRequestDetail } from "@/types";
import { fileStatusOf, revealLineOf, type FileThreads } from "./pr-model";
import { PrThreadCard } from "./PrThread";
import { PrLoading, PrPlaceholder } from "./PrStates";

interface PrFileViewProps {
  pr: PullRequestDetail;
  file: PrFile;
  threads: FileThreads | undefined;
  repoPath: string;
  /** 편집기 열기 메뉴에 넘길 저장소. PR head가 체크아웃돼 있을 때만 준다. */
  editorRepoPath: string | null;
  /** 이 줄(새 쪽)을 보이게 스크롤한다. */
  revealLine: number | null;
  /** 바뀌면 같은 줄로 다시 스크롤한다. */
  revealNonce: number;
  onReveal: (line: number | null) => void;
}

/** GitHub patch 구간 → DiffViewer 입력. 원문이 없어 접힌 구간은 펼칠 수 없다. */
function patchDiff(file: PrFile): DiffOutput | null {
  if (!file.hunks) return null;
  return { filePath: file.path, oldContent: "", newContent: "", hunks: file.hunks, binary: false };
}

/**
 * 상세 오른쪽 칸: 고른 파일의 diff와 그 파일의 리뷰 스레드.
 * - diff: base·head 커밋이 로컬에 있으면 로컬 git diff(원문이 있어 펼치기·문서 보기가 된다),
 *   없거나 실패하면 GitHub patch. patch도 없으면(바이너리·너무 큰 파일) GitHub에서 보라고 안내한다.
 * - 스레드: diff 아래 칸. 줄을 누르면 diff가 그 줄로 간다(새 쪽 줄만 — DiffViewer 제약).
 *   자리를 잃은(outdated) 스레드는 따로 접어 둔다.
 */
export function PrFileView({ pr, file, threads, repoPath, editorRepoPath, revealLine, revealNonce, onReveal }: PrFileViewProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const local = usePullRequestFileDiff(
    pr.localDiff ? repoPath : null,
    pr.localDiff ? { baseSha: pr.baseSha, headSha: pr.headSha, path: file.path, oldPath: file.oldPath } : null,
  );
  const patch = useMemo(() => patchDiff(file), [file]);
  const [threadsOpen, setThreadsOpen] = useState(true);
  const [outdatedOpen, setOutdatedOpen] = useState(false);

  const useLocal = pr.localDiff && !local.isError;
  const diff: DiffOutput | null = useLocal ? (local.data ?? null) : patch;
  const current = threads?.current ?? [];
  const outdated = threads?.outdated ?? [];
  const threadTotal = current.length + outdated.length;

  let diffArea;
  if (useLocal && local.isLoading) {
    diffArea = <PrLoading />;
  } else if (!diff) {
    diffArea = (
      <PrPlaceholder icon={FileQuestion} title={t("pr.file.noPatch")} description={t("pr.file.noPatchHint")}>
        <button
          type="button"
          onClick={() => actions.openInBrowser(`${pr.url}/files`)}
          className="h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
        >
          {t("pr.openOnGitHub")}
        </button>
      </PrPlaceholder>
    );
  } else {
    diffArea = (
      <DiffViewer
        diff={diff}
        status={fileStatusOf(file.status)}
        maximizable
        repoPath={editorRepoPath}
        revealLine={revealLine}
        revealNonce={revealNonce}
        headerExtra={
          !useLocal ? (
            <span className="text-[10.5px] text-(--faint)" title={t("pr.file.patchSourceHint")}>
              {t("pr.file.patchSource")}
            </span>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">{diffArea}</div>
      {threadTotal > 0 && (
        <section
          aria-label={t("pr.thread.sectionLabel")}
          className={cn("shrink-0 flex flex-col border-t border-(--line) bg-surface", threadsOpen && "max-h-[45%]")}
        >
          <button
            type="button"
            onClick={() => setThreadsOpen((v) => !v)}
            aria-expanded={threadsOpen}
            className="flex items-center gap-1.5 h-8 px-3 shrink-0 text-[11.5px] font-semibold text-(--fg2) hover:text-foreground"
          >
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", !threadsOpen && "-rotate-90")} />
            <MessageSquare className="w-3.5 h-3.5" />
            {t("pr.thread.count", { count: threadTotal })}
          </button>
          {threadsOpen && (
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-2">
              {current.map((thread) => {
                const line = revealLineOf(thread);
                return (
                  <PrThreadCard
                    key={thread.id}
                    thread={thread}
                    onReveal={line !== null ? () => onReveal(line) : undefined}
                  />
                );
              })}
              {outdated.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setOutdatedOpen((v) => !v)}
                    aria-expanded={outdatedOpen}
                    className="self-start flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={cn("w-3 h-3 transition-transform", !outdatedOpen && "-rotate-90")} />
                    {t("pr.thread.outdatedGroup", { count: outdated.length })}
                  </button>
                  {outdatedOpen && outdated.map((thread) => <PrThreadCard key={thread.id} thread={thread} />)}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

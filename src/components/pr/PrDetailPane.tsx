import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileText, Globe, MessageSquare, MoreHorizontal, GitPullRequest } from "lucide-react";
import { useBranches, usePullRequest, usePullRequestFiles } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { FileStatusBadge } from "@/lib/file-status";
import { cn } from "@/lib/utils";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import { Card } from "@/components/layout/ContentArea";
import { checkedOutBranch } from "@/components/graph/useHistoryView";
import { ContextMenu, contextMenuPoint } from "@/components/ui/ContextMenu";
import { copyMenuItem } from "@/components/ui/menu-items";
import type { PrFile, PrFiles, PrReviewThread, PullRequestDetail } from "@/types";
import { fileStatusOf, openThreadCount, revealLineOf, threadsByFile } from "./pr-model";
import { selectedPrNumber, usePrViewStore } from "./pr-view";
import { usePrMenu } from "./usePrMenu";
import { BranchPair, CiChip, PrAvatar, PrStateBadge, ReviewDecisionChip, TimeAgo } from "./PrBits";
import { PrError, PrLoading, PrPlaceholder } from "./PrStates";
import { PrOverview } from "./PrOverview";
import { PrFileView } from "./PrFileView";

/**
 * 「PR」 탭의 아래 칸. 그래프 패널 목록에서 고른 PR의 상세를 목록 ↔ 상세 두 칸으로 그린다.
 * 왼쪽: PR 머리(제목·상태·브랜치·판정)와 「개요」, 바뀐 파일 목록. 오른쪽: 개요(설명·체크·커밋·
 * 코드 코멘트·대화) 또는 고른 파일의 diff와 스레드.
 */
export function PrDetailPane() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accountId = useRepoAccountId();
  const number = usePrViewStore((s) => selectedPrNumber(s, activeRepoPath));
  const detail = usePullRequest(activeRepoPath, accountId, number);

  if (number === null || !activeRepoPath) {
    return (
      <Card className="flex-1">
        <PrPlaceholder icon={GitPullRequest} title={t("pr.selectTitle")} description={t("pr.selectDescription")} />
      </Card>
    );
  }
  if (detail.isLoading) {
    return (
      <Card className="flex-1">
        <PrLoading />
      </Card>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Card className="flex-1">
        <PrError error={detail.error} onRetry={() => void detail.refetch()} />
      </Card>
    );
  }
  // PR을 바꾸면 고른 파일·펼친 상태를 새로 시작한다.
  return <PrDetail key={number} pr={detail.data} repoPath={activeRepoPath} accountId={accountId} />;
}

function PrDetail({ pr, repoPath, accountId }: { pr: PullRequestDetail; repoPath: string; accountId: string | null }) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const files = usePullRequestFiles(repoPath, accountId, pr.number, pr.headSha);
  const selectedFile = usePrViewStore((s) => s.selectedFile);
  const selectFile = usePrViewStore((s) => s.selectFile);
  // 같은 줄을 다시 눌러도 다시 스크롤하도록 누를 때마다 nonce를 올린다.
  const [reveal, setReveal] = useState<{ line: number | null; nonce: number }>({ line: null, nonce: 0 });
  const revealAt = (line: number | null) => setReveal((r) => ({ line, nonce: r.nonce + 1 }));
  const { data: branches } = useBranches(repoPath);
  const threads = useMemo(() => threadsByFile(pr.threads), [pr.threads]);
  const [fileMenu, setFileMenu] = useState<{ file: PrFile; x: number; y: number } | null>(null);

  const fileList = files.data?.files ?? [];
  const file = fileList.find((f) => f.path === selectedFile) ?? null;
  // PR head가 지금 체크아웃한 브랜치일 때만 작업 트리 파일이 PR 내용과 같다(편집기로 열기).
  const headCheckedOut = !pr.isCrossRepository && checkedOutBranch(branches) === pr.headRef;

  const openFile = (path: string | null, line: number | null = null) => {
    selectFile(path);
    revealAt(line);
  };
  const openThread = (thread: PrReviewThread) => openFile(thread.path, revealLineOf(thread));
  const openFileMenu = (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    const f = fileList.find((x) => x.path === path);
    if (f) setFileMenu({ file: f, ...contextMenuPoint(e) });
  };

  return (
    <ListDiffSplit
      variant="cards"
      className="animate-content-in"
      files={{
        items: fileList.map((f) => ({
          key: f.path,
          path: f.path,
          status: fileStatusOf(f.status),
          additions: f.additions,
          deletions: f.deletions,
        })),
        selectedKey: selectedFile,
        onSelect: (key) => openFile(key),
        onContextMenu: openFileMenu,
      }}
      list={
        <PrSideList
          pr={pr}
          files={files.data ?? null}
          filesLoading={files.isLoading}
          filesError={files.isError ? files.error : null}
          threads={threads}
          selectedFile={selectedFile}
          onSelectFile={(path) => openFile(path)}
          onFileContextMenu={openFileMenu}
        />
      }
      detail={
        file ? (
          <PrFileView
            key={file.path}
            pr={pr}
            file={file}
            threads={threads.get(file.path)}
            repoPath={repoPath}
            editorRepoPath={headCheckedOut ? repoPath : null}
            revealLine={reveal.line}
            revealNonce={reveal.nonce}
            onReveal={revealAt}
          />
        ) : (
          <PrOverview pr={pr} onOpenThread={openThread} />
        )
      }
    >
      {fileMenu && (
        <ContextMenu
          position={{ x: fileMenu.x, y: fileMenu.y }}
          onClose={() => setFileMenu(null)}
          sections={[
            {
              items: [
                copyMenuItem(t("pr.menu.copyPath"), fileMenu.file.path, actions),
                {
                  label: t("pr.file.viewOnGitHub"),
                  icon: <Globe className="w-3.5 h-3.5" />,
                  onClick: () => actions.openInBrowser(`${pr.url}/files`),
                },
              ],
            },
          ]}
        />
      )}
    </ListDiffSplit>
  );
}

interface PrSideListProps {
  pr: PullRequestDetail;
  files: PrFiles | null;
  filesLoading: boolean;
  filesError: unknown;
  threads: ReturnType<typeof threadsByFile>;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  onFileContextMenu: (path: string, e: React.MouseEvent) => void;
}

/** 상세 왼쪽 칸: PR 머리, 「개요」 줄, 바뀐 파일 목록. */
function PrSideList({
  pr,
  files,
  filesLoading,
  filesError,
  threads,
  selectedFile,
  onSelectFile,
  onFileContextMenu,
}: PrSideListProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const menu = usePrMenu();
  const fileList = files?.files ?? [];
  const selectedIndex = fileList.findIndex((f) => f.path === selectedFile);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: fileList,
    onSelect: (f) => onSelectFile(f.path),
    selectedIndex,
  });
  const talk = pr.conversation.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header
        className="px-3 py-3 flex flex-col gap-1.5 border-b border-(--line) shrink-0"
        onContextMenu={(e) => {
          e.preventDefault();
          menu.open(pr, contextMenuPoint(e));
        }}
      >
        <div className="flex items-center gap-1.5">
          <PrStateBadge pr={pr} />
          <span className="text-[11px] text-(--faint)">#{pr.number}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => actions.openInBrowser(pr.url)}
            title={t("pr.openOnGitHub")}
            aria-label={t("pr.openOnGitHub")}
            className="flex items-center justify-center w-6 h-6 rounded-(--radius-item) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => menu.open(pr, contextMenuPoint(e))}
            title={t("pr.menu.more")}
            aria-label={t("pr.menu.more")}
            className="flex items-center justify-center w-6 h-6 rounded-(--radius-item) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
        <h2 className="text-[13px] font-bold text-foreground leading-[18px] break-words">{pr.title}</h2>
        <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
          <PrAvatar login={pr.author.login} url={pr.author.avatarUrl} size={14} />
          <span className="font-medium text-(--fg2) truncate">{pr.author.login}</span>
          <TimeAgo iso={pr.updatedAt} className="shrink-0" />
        </div>
        <BranchPair pr={pr} />
        <div className="flex items-center gap-1 flex-wrap">
          {pr.reviewDecision && <ReviewDecisionChip decision={pr.reviewDecision} />}
          {pr.ciState && <CiChip state={pr.ciState} />}
          {pr.state === "open" && pr.mergeable === "conflicting" && (
            <span className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-(--radius-chip) bg-danger/15 text-danger text-[10.5px] font-semibold">
              <AlertTriangle className="w-3 h-3" />
              {t("pr.conflicting")}
            </span>
          )}
        </div>
        {menu.element}
      </header>

      <button
        type="button"
        onClick={() => onSelectFile(null)}
        aria-current={selectedFile === null}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors shrink-0",
          selectedFile === null ? "bg-(--acc-sel)" : "hover:bg-accent",
        )}
      >
        <FileText className="w-4 h-4 shrink-0 text-(--fg2)" />
        <span className="flex-1 min-w-0 text-xs font-medium">{t("pr.overview")}</span>
        {talk > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground">
            <MessageSquare className="w-3 h-3" />
            {talk}
          </span>
        )}
      </button>

      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[11px] font-semibold text-(--faint) shrink-0">
        <span>{t("pr.changedFiles", { count: pr.changedFiles })}</span>
        <span className="text-diff-add-fg font-mono">+{pr.additions}</span>
        <span className="text-diff-del-fg font-mono">−{pr.deletions}</span>
      </div>
      {filesLoading ? (
        <PrLoading />
      ) : filesError ? (
        <PrError error={filesError} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
          {fileList.map((f, index) => {
            const lastSlash = f.path.lastIndexOf("/");
            const dir = lastSlash >= 0 ? f.path.slice(0, lastSlash) : "";
            const name = lastSlash >= 0 ? f.path.slice(lastSlash + 1) : f.path;
            const open = openThreadCount(threads.get(f.path));
            return (
              <button
                key={f.path}
                ref={itemRef(index)}
                type="button"
                title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                onClick={() => onSelectFile(f.path)}
                onContextMenu={(e) => onFileContextMenu(f.path, e)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  selectedFile === f.path
                    ? "bg-(--acc-sel)"
                    : activeIndex === index
                      ? "bg-accent ring-1 ring-primary/30"
                      : "hover:bg-accent",
                )}
              >
                <FileStatusBadge status={fileStatusOf(f.status)} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-xs font-medium truncate text-foreground">{name}</span>
                  {dir && <span className="text-[10px] leading-tight text-muted-foreground/50 truncate">{dir}</span>}
                </span>
                {open > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10.5px] text-warning shrink-0"
                    title={t("pr.thread.openCount", { count: open })}
                  >
                    <MessageSquare className="w-3 h-3" />
                    {open}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  <span className="text-diff-add-fg">+{f.additions}</span>{" "}
                  <span className="text-diff-del-fg">−{f.deletions}</span>
                </span>
              </button>
            );
          })}
          {files?.truncated && (
            <button
              type="button"
              onClick={() => actions.openInBrowser(`${pr.url}/files`)}
              className="px-3 py-2 text-[11px] text-primary hover:underline underline-offset-2"
            >
              {t("pr.filesTruncated")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

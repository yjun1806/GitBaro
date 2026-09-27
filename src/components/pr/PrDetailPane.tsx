import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileText, Globe, MessageSquare, MoreHorizontal, GitPullRequest } from "lucide-react";
import { useBranches, usePullRequest, usePullRequestFiles } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useOpenFileInEditor } from "@/hooks/useOpenFileInEditor";
import { useToastStore } from "@/stores/toast";
import { cn } from "@/lib/utils";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import type { MaximizedOrigin } from "@/components/layout/maximized-files";
import { Card } from "@/components/ui/Card";
import { checkedOutBranch } from "@/components/graph/useHistoryView";
import { ContextMenu, contextMenuPoint } from "@/components/ui/ContextMenu";
import { copyMenuItem } from "@/components/ui/menu-items";
import { Button } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { Code, Count, FileStatusLetter, StatusChip } from "@/components/ui/marks";
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

  // 파일 더블클릭: 편집기에서 연다. PR head가 체크아웃된 상태여야 작업 폴더의 파일이 PR 내용과
  // 같다(diff 칸의 repoPath와 같은 판단) — 아니면 왜 못 여는지 알린다. 체크아웃돼 있어도 PR에서
  // 지운 파일은 작업 폴더에도 없다.
  const openFileInEditor = useOpenFileInEditor();
  const addToast = useToastStore((s) => s.addToast);
  const handleFileDoubleClick = (path: string) => {
    if (!headCheckedOut) {
      addToast(t("pr.file.notCheckedOut"), "info");
      return;
    }
    const status = fileList.find((f) => f.path === path)?.status;
    openFileInEditor(repoPath, path, status !== "removed");
  };

  const origin: MaximizedOrigin = {
    kind: "pr",
    label: <Code>{`#${pr.number}`}</Code>,
    title: pr.title,
    meta: [
      t(`pr.state.${pr.isDraft ? "draft" : pr.state}`),
      `${pr.headRef} → ${pr.baseRef}`,
      pr.threadCount > 0 ? t("pr.thread.count", { count: pr.threadCount }) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };

  return (
    <ListDiffSplit
      variant="cards"
      className="animate-content-in"
      origin={origin}
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
        onDoubleClick: handleFileDoubleClick,
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
          onFileDoubleClick={handleFileDoubleClick}
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
  onFileDoubleClick: (path: string) => void;
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
  onFileDoubleClick,
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
          <span className="text-[11.5px] text-muted-foreground">#{pr.number}</span>
          <span className="flex-1" />
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            onClick={() => actions.openInBrowser(pr.url)}
            title={t("pr.openOnGitHub")}
            aria-label={t("pr.openOnGitHub")}
          >
            <Globe className="w-3.5 h-3.5" />
          </Button>
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            onClick={(e) => menu.open(pr, contextMenuPoint(e))}
            title={t("pr.menu.more")}
            aria-label={t("pr.menu.more")}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </div>
        <h2 className="text-[13px] font-bold text-foreground leading-[18px] break-words">{pr.title}</h2>
        <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
          <PrAvatar login={pr.author.login} url={pr.author.avatarUrl} size={14} />
          <span className="font-medium text-(--fg2) truncate">{pr.author.login}</span>
          <TimeAgo iso={pr.updatedAt} className="shrink-0" />
        </div>
        <BranchPair pr={pr} />
        <div className="flex items-center gap-1 flex-wrap">
          {pr.reviewDecision && <ReviewDecisionChip decision={pr.reviewDecision} />}
          {pr.ciState && <CiChip state={pr.ciState} />}
          {pr.state === "open" && pr.mergeable === "conflicting" && (
            <StatusChip tone="danger" icon={<AlertTriangle className="w-3 h-3" aria-hidden="true" />}>
              {t("pr.conflicting")}
            </StatusChip>
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
        <span className="flex-1 min-w-0 text-[12.5px] font-medium">{t("pr.overview")}</span>
        {talk > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MessageSquare className="w-3 h-3" aria-hidden="true" />
            <Count value={talk} tone="muted" />
          </span>
        )}
      </button>

      <SectionLabel
        title={t("pr.changedFiles", { count: pr.changedFiles })}
        trailing={
          <span className="font-mono text-[11.5px]">
            <span className="text-diff-add-fg">+{pr.additions}</span> <span className="text-diff-del-fg">−{pr.deletions}</span>
          </span>
        }
      />
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
                onDoubleClick={() => onFileDoubleClick(f.path)}
                onContextMenu={(e) => onFileContextMenu(f.path, e)}
                className={cn(
                  "w-full h-7 flex items-center gap-2 px-3 text-left select-none transition-colors",
                  selectedFile === f.path
                    ? "bg-(--acc-sel)"
                    : activeIndex === index
                      ? "bg-accent ring-1 ring-inset ring-primary/30"
                      : "hover:bg-accent",
                )}
              >
                <FileStatusLetter status={fileStatusOf(f.status)} />
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-foreground">
                  {name}
                  {dir && <span className="ml-1 text-[11.5px] font-normal text-muted-foreground">{dir}</span>}
                </span>
                {open > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-warning shrink-0"
                    title={t("pr.thread.openCount", { count: open })}
                  >
                    <MessageSquare className="w-3 h-3" aria-hidden="true" />
                    {open}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                  <span className="text-diff-add-fg">+{f.additions}</span>{" "}
                  <span className="text-diff-del-fg">−{f.deletions}</span>
                </span>
              </button>
            );
          })}
          {files?.truncated && (
            <Button variant="ghost" size="sm" onClick={() => actions.openInBrowser(`${pr.url}/files`)} className="mx-3 my-1.5">
              {t("pr.filesTruncated")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

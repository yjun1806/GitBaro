import { useTranslation } from "react-i18next";
import { CheckCheck, ExternalLink, History } from "lucide-react";
import { useMenuActions } from "@/hooks/useMenuActions";
import { cn } from "@/lib/utils";
import type { PrConversationItem, PrReviewThread, PrThreadComment } from "@/types";
import { threadLine } from "./pr-model";
import { PrAvatar, TimeAgo } from "./PrBits";
import { PrMarkdown } from "./PrMarkdown";

const CHIP = "inline-flex items-center gap-1 h-[16px] px-1.5 rounded-(--radius-chip) text-[10px] font-semibold shrink-0";

/** `L12`, 여러 줄이면 `L10–12`. 지운 쪽 줄이면 「옛 줄」을 붙인다. 줄이 없으면(파일 코멘트) 「파일」. */
export function ThreadLineLabel({ thread }: { thread: PrReviewThread }) {
  const { t } = useTranslation();
  const line = threadLine(thread);
  if (line === null) return <span className="font-mono">{t("pr.thread.fileLevel")}</span>;
  const start = thread.startLine !== null && thread.startLine !== line ? `${thread.startLine}–` : "";
  return (
    <span className="font-mono">
      L{start}
      {line}
      {thread.side === "left" && <span className="ml-1 font-sans text-(--faint)">{t("pr.thread.oldSide")}</span>}
    </span>
  );
}

export function ThreadStateChips({ thread }: { thread: PrReviewThread }) {
  const { t } = useTranslation();
  return (
    <>
      {thread.isResolved && (
        <span className={cn(CHIP, "bg-success/15 text-success")}>
          <CheckCheck className="w-3 h-3" />
          {t("pr.thread.resolved")}
        </span>
      )}
      {thread.isOutdated && (
        <span className={cn(CHIP, "bg-(--chip) text-(--fg2)")}>
          <History className="w-3 h-3" />
          {t("pr.thread.outdated")}
        </span>
      )}
    </>
  );
}

/** 코멘트 한 개(스레드·대화 공통): 아바타, 이름, 시각, 본문. */
function CommentBlock({
  comment,
  extra,
}: {
  comment: Pick<PrThreadComment, "author" | "body" | "createdAt" | "url">;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  return (
    <div className="flex gap-2 min-w-0">
      <PrAvatar login={comment.author.login} url={comment.author.avatarUrl} size={20} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
          <span className="font-semibold text-(--fg2) truncate">{comment.author.login}</span>
          {extra}
          <TimeAgo iso={comment.createdAt} className="shrink-0" />
          <span className="flex-1" />
          {comment.url && (
            <button
              type="button"
              onClick={() => actions.openInBrowser(comment.url)}
              title={t("pr.openOnGitHub")}
              aria-label={t("pr.openOnGitHub")}
              className="shrink-0 p-0.5 rounded text-(--faint) hover:text-foreground hover:bg-accent transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
        <PrMarkdown source={comment.body} className="mt-0.5" />
      </div>
    </div>
  );
}

/** diff 조각의 마지막 몇 줄. 자리를 잃은 스레드가 어디에 달렸는지 보인다. */
function HunkExcerpt({ hunk }: { hunk: string }) {
  const lines = hunk.split("\n").filter((l) => !l.startsWith("@@")).slice(-4);
  if (lines.length === 0) return null;
  return (
    <pre className="text-[11px] leading-[16px] font-mono bg-surface rounded px-2 py-1 overflow-x-auto">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(l.startsWith("+") && "text-diff-add-fg", l.startsWith("-") && "text-diff-del-fg")}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

/**
 * 코드 줄에 단 리뷰 스레드 하나. 머리(줄·해결·지난 코멘트)를 누르면 diff에서 그 줄을 보인다
 * (`onReveal`이 있을 때). 자리를 잃은 스레드는 diff 조각을 함께 보인다.
 */
export function PrThreadCard({ thread, onReveal }: { thread: PrReviewThread; onReveal?: () => void }) {
  const { t } = useTranslation();
  const head = (
    <>
      <ThreadLineLabel thread={thread} />
      <ThreadStateChips thread={thread} />
    </>
  );
  return (
    <article
      aria-label={t("pr.thread.label", { path: thread.path })}
      className={cn(
        "flex flex-col gap-2 rounded-(--radius-item) border border-(--line) bg-card px-2.5 py-2",
        thread.isResolved && "opacity-75",
      )}
    >
      {onReveal ? (
        <button
          type="button"
          onClick={onReveal}
          title={t("pr.thread.reveal")}
          className="self-start flex items-center gap-1.5 text-[11px] text-(--fg2) hover:text-primary transition-colors"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-(--fg2)">{head}</div>
      )}
      {thread.isOutdated && <HunkExcerpt hunk={thread.diffHunk} />}
      {thread.comments.map((c) => (
        <CommentBlock key={c.id} comment={c} />
      ))}
      {thread.commentsTruncated && (
        <p className="text-[11px] text-muted-foreground">{t("pr.thread.moreOnGitHub")}</p>
      )}
    </article>
  );
}

const REVIEW_TONE: Record<NonNullable<PrConversationItem["reviewState"]>, string> = {
  approved: "bg-success/15 text-success",
  changes_requested: "bg-danger/15 text-danger",
  commented: "bg-(--chip) text-(--fg2)",
  dismissed: "bg-(--chip) text-(--fg2)",
};

/** 대화 칸의 한 항목(대화 코멘트 또는 리뷰). */
export function ConversationEntry({ item }: { item: PrConversationItem }) {
  const { t } = useTranslation();
  const badge = item.reviewState ? (
    <span className={cn(CHIP, REVIEW_TONE[item.reviewState])}>{t(`pr.reviewEvent.${item.reviewState}`)}</span>
  ) : null;
  return (
    <li className="py-2 border-b border-(--line) last:border-b-0">
      <CommentBlock comment={item} extra={badge} />
    </li>
  );
}

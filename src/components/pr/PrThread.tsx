import { useTranslation } from "react-i18next";
import { CheckCheck, ExternalLink, History } from "lucide-react";
import { useMenuActions } from "@/hooks/useMenuActions";
import { cn } from "@/lib/utils";
import type { PrConversationItem, PrReviewThread, PrThreadComment } from "@/types";
import { threadLine } from "./pr-model";
import { PrAvatar, TimeAgo } from "./PrBits";
import { PrMarkdown } from "./PrMarkdown";
import { Button } from "@/components/ui/Button";
import { Code, StatusChip, type StatusTone } from "@/components/ui/marks";

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
      {thread.side === "left" && <span className="ml-1 font-sans text-muted-foreground">{t("pr.thread.oldSide")}</span>}
    </span>
  );
}

export function ThreadStateChips({ thread }: { thread: PrReviewThread }) {
  const { t } = useTranslation();
  return (
    <>
      {thread.isResolved && (
        <StatusChip tone="success" icon={<CheckCheck className="w-3 h-3" aria-hidden="true" />}>
          {t("pr.thread.resolved")}
        </StatusChip>
      )}
      {thread.isOutdated && (
        <StatusChip tone="neutral" icon={<History className="w-3 h-3" aria-hidden="true" />}>
          {t("pr.thread.outdated")}
        </StatusChip>
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
        <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-muted-foreground">
          <span className="font-semibold text-(--fg2) truncate">{comment.author.login}</span>
          {extra}
          <TimeAgo iso={comment.createdAt} className="shrink-0" />
          <span className="flex-1" />
          {comment.url && (
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              onClick={() => actions.openInBrowser(comment.url)}
              title={t("pr.openOnGitHub")}
              aria-label={t("pr.openOnGitHub")}
            >
              <ExternalLink className="w-3 h-3" />
            </Button>
          )}
        </div>
        <PrMarkdown source={comment.body} className="mt-0.5" sourceUrl={comment.url || undefined} />
      </div>
    </div>
  );
}

/** diff 조각의 마지막 몇 줄. 자리를 잃은 스레드가 어디에 달렸는지 보인다. */
function HunkExcerpt({ hunk }: { hunk: string }) {
  const lines = hunk.split("\n").filter((l) => !l.startsWith("@@")).slice(-4);
  if (lines.length === 0) return null;
  return (
    <Code block className="text-[11.5px] leading-[16px] overflow-x-auto">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(l.startsWith("+") && "text-diff-add-fg", l.startsWith("-") && "text-diff-del-fg")}
        >
          {l || " "}
        </div>
      ))}
    </Code>
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
          className="self-start flex items-center gap-1.5 text-[11.5px] text-(--fg2) hover:text-primary transition-colors"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 text-[11.5px] text-(--fg2)">{head}</div>
      )}
      {thread.isOutdated && <HunkExcerpt hunk={thread.diffHunk} />}
      {thread.comments.map((c) => (
        <CommentBlock key={c.id} comment={c} />
      ))}
      {thread.commentsTruncated && (
        <p className="text-[11.5px] text-muted-foreground">{t("pr.thread.moreOnGitHub")}</p>
      )}
    </article>
  );
}

const REVIEW_TONE: Record<NonNullable<PrConversationItem["reviewState"]>, StatusTone> = {
  approved: "success",
  changes_requested: "danger",
  commented: "neutral",
  dismissed: "neutral",
};

/** 대화 칸의 한 항목(대화 코멘트 또는 리뷰). */
export function ConversationEntry({ item }: { item: PrConversationItem }) {
  const { t } = useTranslation();
  const badge = item.reviewState ? (
    <StatusChip tone={REVIEW_TONE[item.reviewState]}>{t(`pr.reviewEvent.${item.reviewState}`)}</StatusChip>
  ) : null;
  return (
    <li className="py-2 border-b border-(--line) last:border-b-0">
      <CommentBlock comment={item} extra={badge} />
    </li>
  );
}

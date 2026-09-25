import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMenuActions } from "@/hooks/useMenuActions";
import { cn } from "@/lib/utils";
import type { PrReviewThread, PullRequestDetail } from "@/types";
import { threadsByFile } from "./pr-model";
import { CheckIcon, PrAvatar, ReviewerRow, TimeAgo } from "./PrBits";
import { PrMarkdown } from "./PrMarkdown";
import { ConversationEntry, ThreadLineLabel, ThreadStateChips } from "./PrThread";

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold text-(--faint)">
        {title}
        {count !== undefined && <span className="ml-1 font-normal">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function MoreOnGitHub({ url }: { url: string }) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  return (
    <button
      type="button"
      onClick={() => actions.openInBrowser(url)}
      className="self-start text-[11px] text-primary hover:underline underline-offset-2"
    >
      {t("pr.moreOnGitHub")}
    </button>
  );
}

interface PrOverviewProps {
  pr: PullRequestDetail;
  /** 「코드 코멘트」에서 스레드를 누르면 그 파일을 열고 줄을 보인다. */
  onOpenThread: (thread: PrReviewThread) => void;
}

/**
 * 상세 오른쪽 칸의 「개요」: 설명, 리뷰어·라벨, 체크, 커밋, 코드 코멘트(파일별), 대화(시간순).
 * 한 번에 다 싣지 못한 목록은 「GitHub에서 더 보기」로 잇는다.
 */
export function PrOverview({ pr, onOpenThread }: PrOverviewProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const byFile = [...threadsByFile(pr.threads).entries()];
  const threadCount = pr.threads.length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-5 px-5 py-4 max-w-[860px]">
        <Section title={t("pr.section.description")}>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <PrAvatar login={pr.author.login} url={pr.author.avatarUrl} />
            <span className="font-semibold text-(--fg2)">{pr.author.login}</span>
            <TimeAgo iso={pr.createdAt} />
          </div>
          <PrMarkdown source={pr.body} placeholder={t("pr.noDescription")} />
        </Section>

        {(pr.reviewers.length > 0 || pr.labels.length > 0) && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {pr.reviewers.length > 0 && (
              <Section title={t("pr.section.reviewers")}>
                <ul className="flex flex-col gap-1">
                  {pr.reviewers.map((r) => (
                    <ReviewerRow key={`${r.isTeam ? "team" : "user"}:${r.login}`} reviewer={r} />
                  ))}
                </ul>
              </Section>
            )}
            {pr.labels.length > 0 && (
              <Section title={t("pr.section.labels")}>
                <ul className="flex flex-wrap gap-1">
                  {pr.labels.map((l) => (
                    <li
                      key={l.name}
                      className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-(--radius-pill) border border-(--line) text-[10.5px] text-(--fg2)"
                    >
                      {/* 라벨 색은 GitHub이 정한 값이라 점으로만 쓴다(글자색은 테마 토큰). */}
                      <span aria-hidden className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${l.color}` }} />
                      {l.name}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}

        <Section title={t("pr.section.checks")} count={pr.checks.length}>
          {pr.checks.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("pr.noChecks")}</p>
          ) : (
            <ul className="flex flex-col">
              {pr.checks.map((c, i) => (
                <li key={`${c.name}:${i}`}>
                  <button
                    type="button"
                    disabled={!c.url}
                    onClick={() => c.url && actions.openInBrowser(c.url)}
                    title={c.url ? t("pr.openOnGitHub") : undefined}
                    className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-[12px] enabled:hover:bg-accent transition-colors"
                  >
                    <CheckIcon check={c} />
                    <span className="truncate font-medium">{c.name}</span>
                    {c.description && <span className="truncate text-[11px] text-muted-foreground">{c.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pr.truncated.checks && <MoreOnGitHub url={`${pr.url}/checks`} />}
        </Section>

        <Section title={t("pr.section.commits")} count={pr.commitCount}>
          <ul className="flex flex-col">
            {pr.commits.map((c) => (
              <li key={c.oid}>
                <button
                  type="button"
                  onClick={() => actions.openInBrowser(`${pr.url}/commits/${c.oid}`)}
                  title={t("pr.openOnGitHub")}
                  className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-[12px] hover:bg-accent transition-colors"
                >
                  <span className="font-mono text-[11px] text-(--faint) shrink-0">{c.oid.slice(0, 7)}</span>
                  <span className="truncate flex-1 min-w-0">{c.headline}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{c.author?.login ?? c.authorName}</span>
                  <TimeAgo iso={c.authoredAt} className="shrink-0 text-[11px] text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
          {pr.truncated.commits && <MoreOnGitHub url={`${pr.url}/commits`} />}
        </Section>

        <Section title={t("pr.section.codeComments")} count={threadCount}>
          {threadCount === 0 ? (
            <p className="text-xs text-muted-foreground">{t("pr.noCodeComments")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {byFile.map(([path, entry]) => (
                <li key={path} className="flex flex-col">
                  <span className="font-mono text-[11px] text-(--fg2) truncate" title={path}>
                    {path}
                  </span>
                  {[...entry.current, ...entry.outdated].map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => onOpenThread(thread)}
                      className={cn(
                        "flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded text-left text-[11.5px] hover:bg-accent transition-colors",
                        thread.isResolved && "opacity-70",
                      )}
                    >
                      <span className="shrink-0 text-(--fg2)">
                        <ThreadLineLabel thread={thread} />
                      </span>
                      <ThreadStateChips thread={thread} />
                      <span className="shrink-0 font-semibold text-(--fg2)">{thread.comments[0]?.author.login}</span>
                      <span className="truncate text-muted-foreground">{thread.comments[0]?.body}</span>
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {pr.truncated.threads && <MoreOnGitHub url={`${pr.url}/files`} />}
        </Section>

        <Section title={t("pr.section.conversation")} count={pr.conversation.length}>
          {pr.conversation.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("pr.noConversation")}</p>
          ) : (
            <ol className="flex flex-col">
              {pr.conversation.map((item) => (
                <ConversationEntry key={item.id} item={item} />
              ))}
            </ol>
          )}
          {(pr.truncated.comments || pr.truncated.reviews) && <MoreOnGitHub url={pr.url} />}
        </Section>
      </div>
    </div>
  );
}

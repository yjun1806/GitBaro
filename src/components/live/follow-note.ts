import type { useTranslation } from "react-i18next";
import { leadingTicketKey } from "@/lib/ticket-keys";
import { formatRelativeTime } from "@/lib/utils";
import type { CommitTouch, WipFile } from "@/types";

type TFn = ReturnType<typeof useTranslation>["t"];

/**
 * 따라가기 줄의 「눈여겨볼 것」(D49). 판정이 아니라 지금 보는 파일에 있었던 사실 하나(또는 두 개)를
 * 고른다:
 * 1) 원격에 없는 커밋 중 이 파일을 건드린 가장 최근 것 — 이슈 키가 맨 앞에 있으면 그 키, 없으면 제목.
 *    그보다 앞선 커밋 중 작성자가 다른 것이 있으면(같은 사람이면 생략) 「{시각} {작성자} 수정」을 이어 붙인다.
 * 2) 커밋이 없으면(아직 커밋하지 않은 변경) 새 파일인지, 아니면 늘고 준 줄 수.
 * 둘 다 없으면(변경이 없거나 아직 못 읽었으면) null — 오른쪽은 비운다.
 *
 * `commits`는 `useUnpushedFileTouches`가 이 파일에 대해 돌려준 `FileTouches.commits`(최신 순)다.
 */
export function followNote(
  t: TFn,
  file: Pick<WipFile, "status" | "insertions" | "deletions">,
  commits: readonly CommitTouch[],
): string | null {
  const latest = commits[0];
  if (latest) {
    const time = formatRelativeTime(latest.authorTime);
    const ticket = leadingTicketKey(latest.subject);
    const main = ticket
      ? t("live.followLineCommitTicket", { time, ticket: ticket.key })
      : t("live.followLineCommitSubject", { time, subject: latest.subject });
    const earlierByOther = commits.slice(1).find((c) => c.authorName !== latest.authorName);
    if (!earlierByOther) return main;
    const other = t("live.followLineOtherAuthor", {
      time: formatRelativeTime(earlierByOther.authorTime),
      author: earlierByOther.authorName,
    });
    return `${main} · ${other}`;
  }
  if (file.status === "added") return t("live.followLineNewFile");
  if (file.insertions || file.deletions) {
    return t("live.followLineSize", { add: file.insertions ?? 0, del: file.deletions ?? 0 });
  }
  return null;
}

import type { useTranslation } from "react-i18next";
import { leadingTicketKey } from "@/lib/ticket-keys";
import { formatRelativeTime } from "@/lib/utils";
import type { CommitTouch, WipFile } from "@/types";

type TFn = ReturnType<typeof useTranslation>["t"];

/**
 * 따라가기 줄의 「눈여겨볼 것」(D49). 판정이 아니라 지금 보는 파일에 있었던 사실 하나를 고른다:
 * 1) 원격에 없는 커밋 중 이 파일을 건드린 가장 최근 것 — 이슈 키가 맨 앞에 있으면 그 키, 없으면 제목.
 * 2) 아직 커밋하지 않았으면(1이 없으면) 새 파일인지, 아니면 늘고 준 줄 수.
 * 둘 다 없으면(변경이 없거나 아직 못 읽었으면) null — 오른쪽은 비운다.
 *
 * `commits`는 `useUnpushedFileTouches`가 이 파일에 대해 돌려준 `FileTouches.commits`(최신 순)다.
 * 커밋의 작성자는 이 데이터에 없어 「다른 작성자가 고쳤다」류의 사실은 아직 못 만든다.
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
    return ticket
      ? t("live.followLineCommitTicket", { time, ticket: ticket.key })
      : t("live.followLineCommitSubject", { time, subject: latest.subject });
  }
  if (file.status === "added") return t("live.followLineNewFile");
  if (file.insertions || file.deletions) {
    return t("live.followLineSize", { add: file.insertions ?? 0, del: file.deletions ?? 0 });
  }
  return null;
}

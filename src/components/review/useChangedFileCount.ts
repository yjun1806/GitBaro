import { useMemo } from "react";
import { useChangesVsDefaultOnHead, useStatusMany } from "@/api/queries";
import { changedFileCount, sumCounts } from "./tab-counts";

/**
 * 「파일별 변경」 탭 배지의 파일 수. 워크트리마다 main 대비 커밋한 파일(HEAD가 바뀔 때만 다시 읽음)과
 * 커밋하지 않은 파일(`status`, 다른 화면과 같은 조회 키)을 합친다. 아직 모르면 null.
 */
export function useChangedFileCount(entries: readonly { path: string; headOid: string | null }[]): number | null {
  const changes = useChangesVsDefaultOnHead(entries);
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const statuses = useStatusMany(paths);
  const perPath = entries.map((e, i) => changedFileCount(changes[i]?.data, statuses[e.path]));
  return sumCounts(perPath);
}

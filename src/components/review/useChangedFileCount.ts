import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChangesVsDefaultOnHead, useStatusMany } from "@/api/queries";
import { changedFileCount, sumCounts } from "./tab-counts";
import { tabBaseName, useChangesScopes } from "./compare-base";

const NO_STATUS: readonly { path: string }[] = [];

/**
 * 「main 대비 변경」 탭의 이름과 배지 파일 수. 워크트리마다 기준 대비 커밋한 파일(HEAD가 바뀔 때만
 * 다시 읽음)과 커밋 안 한 파일(`status`, 다른 화면과 같은 조회 키)을 합친다. 체크아웃하지 않고 보는
 * 브랜치는 커밋한 파일만 센다. 아직 모르면 수는 null.
 */
export function useBranchChangesTab(entries: readonly { path: string; headOid: string | null }[]): {
  count: number | null;
  label: string;
} {
  const { t } = useTranslation();
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const scopes = useChangesScopes(paths);
  const scoped = useMemo(() => entries.map((e, i) => ({ ...e, scope: scopes[i] })), [entries, scopes]);
  const changes = useChangesVsDefaultOnHead(scoped);
  const statuses = useStatusMany(paths);
  const perPath = entries.map((e, i) =>
    changedFileCount(changes[i]?.data, scopes[i]?.target ? NO_STATUS : statuses[e.path]),
  );
  const base = tabBaseName(entries.map((_, i) => ({ changes: changes[i]?.data, scope: scopes[i] })));
  return {
    count: sumCounts(perPath),
    label: base ? t("filesByRepo.tab", { base }) : t("filesByRepo.tabDefault"),
  };
}

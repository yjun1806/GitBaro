import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useUnpushedFileTouches } from "@/api/queries";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useRepoAvatarColor } from "@/hooks/useRepoDisplay";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import { splitFilePath, type MaximizedOrigin } from "@/components/layout/maximized-files";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { FileTouchesList } from "./FileTouchesList";
import { FileTouchesDetail } from "./FileTouchesDetail";
import { groupFileTouches, type FileTouchRow, type FileTouchSource } from "./file-touches-model";

export interface FileTouchesViewProps {
  /** 읽을 워크트리들(`fileTouchSources`). 워크트리마다 따로 조회한다. */
  sources: readonly FileTouchSource[];
  repoLabel: (repoPath: string) => string;
}

/**
 * 워크스페이스 리뷰의 「파일별 보기」: push하면 바뀌는 파일을 저장소·워크트리를 넘나들어 하나의
 * 목록으로 묶는다(커밋 여러 개가 건드린 파일 먼저). 고른 파일의 오른쪽 칸은 push할 범위 전체를 합친
 * diff가 기본이고, 커밋 하나를 고르면 그 커밋만의 diff로 바뀐다.
 */
export function FileTouchesView({ sources, repoLabel }: FileTouchesViewProps) {
  const { t } = useTranslation();
  const avatarColorOf = useRepoAvatarColor();
  const results = useUnpushedFileTouches(sources);

  const grouped = useMemo(() => groupFileTouches(sources, results), [sources, results]);
  const { multi, single, mergeOnly, pending, errors } = grouped;
  const allRows = useMemo(() => [...multi, ...single, ...mergeOnly], [multi, single, mergeOnly]);

  // 고른 파일. 지워졌거나(다시 읽어 사라짐) 아직 고르지 않았으면 첫 묶음 첫 파일로 되돌아간다.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(null);
  const currentRow = allRows.find((r) => r.key === selectedKey) ?? null;
  const effectiveRow = currentRow ?? allRows[0] ?? null;

  const selectRow = (row: FileTouchRow) => {
    setSelectedKey(row.key);
    setSelectedCommitOid(null);
  };

  const detailRef = useRef<HTMLDivElement>(null);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: allRows,
    selectedIndex: allRows.findIndex((r) => r.key === (effectiveRow?.key ?? null)),
    onSelect: selectRow,
  });
  // Enter로 diff 칸에 초점을 옮긴다(위아래 화살표는 useListKeyboardNav가 이미 처리).
  const handleKeyDown: typeof containerProps.onKeyDown = (e) => {
    containerProps.onKeyDown(e);
    if (e.key === "Enter") detailRef.current?.focus();
  };

  // 읽은 워크트리가 하나도 없을 때만 칸 전체를 읽는 중으로 둔다. 하나라도 읽었으면 그 파일을 먼저 보이고,
  // 나머지는 목록 위에 워크트리마다 「읽는 중」으로 둔다.
  if (allRows.length === 0 && errors.length === 0 && pending.length > 0) {
    return <LoadingState label={t("review.fileView.loading")} />;
  }
  if (allRows.length === 0 && errors.length === 0) {
    return <EmptyState icon={FileText} title={t("review.fileView.emptyTitle")} />;
  }

  const origin: MaximizedOrigin | undefined = effectiveRow
    ? {
        kind: "fileTouches",
        label: <span className="italic text-(--fg2) truncate min-w-0">{t("review.fileView.segFiles")}</span>,
        title: splitFilePath(effectiveRow.touches.path).name,
        meta: [
          repoLabel(effectiveRow.source.path),
          t("review.fileView.combinedScope", { count: effectiveRow.touches.commits.length }),
        ]
          .filter(Boolean)
          .join(" · "),
      }
    : undefined;

  return (
    <ListDiffSplit
      variant="inline"
      className="animate-content-in"
      origin={origin}
      list={
        <FileTouchesList
          grouped={grouped}
          selectedKey={effectiveRow?.key ?? null}
          activeIndex={activeIndex}
          repoLabel={repoLabel}
          avatarColorOf={avatarColorOf}
          onSelect={selectRow}
          containerProps={{ ...containerProps, onKeyDown: handleKeyDown }}
          itemRef={itemRef}
        />
      }
      detail={
        effectiveRow ? (
          <FileTouchesDetail
            ref={detailRef}
            row={effectiveRow}
            repoLabel={repoLabel}
            avatarColorOf={avatarColorOf}
            selectedCommitOid={selectedCommitOid}
            onSelectCommit={setSelectedCommitOid}
          />
        ) : (
          <EmptyState icon={FileText} title={t("diff.noFileSelected")} description={t("diff.selectFile")} />
        )
      }
    />
  );
}

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useUnpushedFileTouches } from "@/api/queries";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useRepoAvatarColor } from "@/hooks/useRepoDisplay";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { FileTouchesList } from "./FileTouchesList";
import { FileTouchesDetail } from "./FileTouchesDetail";
import { groupFileTouches, type FileTouchRow } from "./file-touches-model";

export interface FileTouchesViewProps {
  /** 워크스페이스에 지금 보이는 저장소 경로들(각각 독립된 워크트리 하나로 조회한다). */
  paths: readonly string[];
  repoLabel: (repoPath: string) => string;
}

/**
 * 워크스페이스 리뷰의 「파일별 보기」: 원격에 없는 커밋이 건드린 파일을 저장소를 넘나들어 하나의
 * 목록으로 묶는다(커밋 여러 개가 건드린 파일 먼저). 고른 파일의 오른쪽 칸은 묶인 커밋을 합친
 * diff가 기본이고, 커밋 하나를 고르면 그 커밋만의 diff로 바뀐다.
 */
export function FileTouchesView({ paths, repoLabel }: FileTouchesViewProps) {
  const { t } = useTranslation();
  const avatarColorOf = useRepoAvatarColor();
  const results = useUnpushedFileTouches(paths);

  const { multi, single, errors, truncatedRepos, isLoading } = useMemo(
    () => groupFileTouches(paths, results),
    [paths, results],
  );
  const allRows = useMemo(() => [...multi, ...single], [multi, single]);

  // 고른 파일. 지워졌거나(다시 읽어 사라짐) 아직 고르지 않았으면 첫 묶음 첫 파일로 되돌아간다.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(null);
  const currentRow = allRows.find((r) => r.key === selectedKey) ?? null;
  const defaultKey = multi[0]?.key ?? single[0]?.key ?? null;
  const effectiveRow = currentRow ?? allRows.find((r) => r.key === defaultKey) ?? null;

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

  if (isLoading) {
    return <LoadingState label={t("review.fileView.loading")} />;
  }
  if (allRows.length === 0 && errors.length === 0) {
    return <EmptyState icon={FileText} title={t("review.fileView.emptyTitle")} />;
  }

  return (
    <ListDiffSplit
      variant="inline"
      className="animate-content-in"
      list={
        <FileTouchesList
          multi={multi}
          single={single}
          errors={errors}
          truncatedRepos={truncatedRepos}
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

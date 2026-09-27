import { useTranslation } from "react-i18next";
import { useUIStore, type ReviewFileView } from "@/stores/ui";
import { Segmented } from "@/components/ui/Segmented";

/**
 * 필터 막대 오른쪽의 「커밋 순서 | 파일별」(D44, 5.1). 세 단계가 같은 값(`ui.reviewFileView`)을 쓴다 —
 * 워크스페이스에서 파일별로 보다가 저장소로 내려가도 그대로 파일별이다.
 */
export function ScopeViewToggle() {
  const { t } = useTranslation();
  const view = useUIStore((s) => s.reviewFileView);
  const setView = useUIStore((s) => s.setScopeFileView);
  return (
    <Segmented<ReviewFileView>
      value={view}
      onChange={setView}
      size="sm"
      ariaLabel={t("review.fileView.viewLabel")}
      options={[
        { value: "commits", label: t("review.fileView.segCommits") },
        { value: "files", label: t("review.fileView.segFiles") },
      ]}
    />
  );
}

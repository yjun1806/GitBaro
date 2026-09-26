import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { Spinner } from "./Spinner";

/**
 * 브랜치 전환(checkout + 재조회) 중 부모 영역을 덮는 반투명 로딩 오버레이.
 * 부모 컨테이너에 `relative`가 있어야 올바르게 배치된다. 전환이 즉각적이지
 * 않은 큰 저장소에서 "멈춤"이 아니라 "로딩 중"으로 보이게 하는 피드백.
 */
export function SwitchingOverlay() {
  const { t } = useTranslation();
  const isSwitching = useUIStore((s) => s.isSwitchingBranch);
  if (!isSwitching) return null;
  return (
    <div
      role="status"
      aria-label={t("branch.switching")}
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-[1px] animate-loading-in"
    >
      <Spinner size="lg" className="text-muted-foreground" />
    </div>
  );
}

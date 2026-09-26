import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

interface LoadingStateProps {
  /** 무엇을 읽는지. 없으면 「불러오는 중」. */
  label?: string;
  /**
   * - `panel`(기본): 칸·창·화면 가운데. 내용 전체를 기다릴 때.
   * - `row`: 목록 안 한 줄. 목록의 한 묶음이나 더 불러오기를 기다릴 때.
   */
  layout?: "panel" | "row";
  className?: string;
}

/**
 * 내용 자리를 채우는 「불러오는 중」 표시. 회전 표시와 글자 한 줄이고, 200ms 기다렸다가 흐린 데서
 * 나타나서(`animate-loading-in`) 금방 끝나는 읽기에는 보이지 않는다.
 */
export function LoadingState({ label, layout = "panel", className }: LoadingStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      data-loading-state={layout}
      className={cn(
        "flex items-center gap-2 text-muted-foreground animate-loading-in",
        layout === "panel" ? "flex-1 justify-center px-4 py-6 text-xs" : "px-3 py-2 text-[11.5px]",
        className,
      )}
    >
      <Spinner size={layout === "panel" ? "md" : "sm"} />
      <span className="min-w-0 truncate">{label ?? t("common.loading")}</span>
    </div>
  );
}

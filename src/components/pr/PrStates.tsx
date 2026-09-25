import type { ElementType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getErrorMessage } from "@/lib/utils";
import { prErrorKind } from "./pr-model";

/** 가운데 아이콘 + 한두 줄. PR 목록·상세의 빈 상태와 안내. */
export function PrPlaceholder({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ElementType;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10 px-4 text-muted-foreground">
      <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
        <Icon className="w-6 h-6" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function PrLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex-1 flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
      <Loader2 className="w-6 h-6 animate-spin" />
      <p className="text-xs">{t("common.loading")}</p>
    </div>
  );
}

/** GitHub 호출 실패 안내. 404·403·한도·원격 없음은 할 일을 말하고, 나머지는 원래 문구를 보인다. */
export function PrError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const kind = prErrorKind(error);
  const description =
    kind === "other" ? t("pr.error.other", { error: getErrorMessage(error) }) : t(`pr.error.${kind}`);
  return (
    <PrPlaceholder icon={AlertTriangle} title={t("pr.error.title")} description={description}>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
        >
          {t("pr.retry")}
        </button>
      )}
    </PrPlaceholder>
  );
}

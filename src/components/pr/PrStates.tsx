import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { getErrorMessage } from "@/lib/utils";
import { prErrorKind } from "./pr-model";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";

/** 가운데 아이콘 + 한두 줄. PR 목록·상세의 빈 상태와 안내. */
export function PrPlaceholder({
  icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return <EmptyState icon={icon} title={title} description={description} action={children} />;
}

export function PrLoading() {
  return <LoadingState />;
}

/** GitHub 호출 실패 안내. 404·403·한도·원격 없음은 할 일을 말하고, 나머지는 원래 문구를 보인다. */
export function PrError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const kind = prErrorKind(error);
  const description =
    kind === "other" ? t("pr.error.other", { error: getErrorMessage(error) }) : t(`pr.error.${kind}`);
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <Notice
        tone="danger"
        icon={AlertTriangle}
        title={t("pr.error.title")}
        actions={
          onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t("pr.retry")}
            </Button>
          )
        }
      >
        {description}
      </Notice>
    </div>
  );
}

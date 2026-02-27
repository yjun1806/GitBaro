import { Eye, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";

interface PreviewBannerProps {
  onStopPreview: () => void;
}

export function PreviewBanner({ onStopPreview }: PreviewBannerProps) {
  const { t } = useTranslation();
  const previewBranch = useUIStore((s) => s.previewBranch);

  if (!previewBranch) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/15 border-b border-warning/30 text-warning-foreground">
      <Eye className="w-3.5 h-3.5 text-warning shrink-0" />
      <span className="text-xs font-medium flex-1 truncate">
        {t("preview.previewing", { branch: previewBranch })}
      </span>
      <button
        onClick={onStopPreview}
        className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-warning/20 hover:bg-warning/30 transition-colors"
      >
        <X className="w-3 h-3" />
        {t("preview.stop")}
      </button>
    </div>
  );
}

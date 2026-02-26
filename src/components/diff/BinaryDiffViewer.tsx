import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import type { BinaryPreview } from "@/types";
import { ImageDiff } from "./ImageDiff";
import { SvgPreview } from "./SvgPreview";

interface BinaryDiffViewerProps {
  filePath: string;
  preview: BinaryPreview;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function BinaryDiffViewer({ filePath, preview }: BinaryDiffViewerProps) {
  const { t } = useTranslation();

  if (preview.meta.tooLarge) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
          <FileQuestion className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium">{t("diff.tooLarge")}</p>
        <p className="text-xs image-meta-label">
          {preview.meta.newSize != null && formatFileSize(preview.meta.newSize)}
        </p>
      </div>
    );
  }

  switch (preview.meta.fileType) {
    case "image":
      return <ImageDiff filePath={filePath} preview={preview} />;
    case "svg":
      return <SvgPreview preview={preview} />;
    default:
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
            <FileQuestion className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium">{t("diff.binary")}</p>
          <p className="text-xs">
            {filePath.split(".").pop()?.toUpperCase()}
            {preview.meta.newSize != null && ` · ${formatFileSize(preview.meta.newSize)}`}
          </p>
        </div>
      );
  }
}

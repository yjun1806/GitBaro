import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import type { BinaryPreview } from "@/types";
import { ImageDiff } from "./ImageDiff";
import { SvgPreview } from "./SvgPreview";
import { EmptyState } from "@/components/ui/EmptyState";

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
      <EmptyState
        icon={FileQuestion}
        title={t("diff.tooLarge")}
        description={preview.meta.newSize != null ? formatFileSize(preview.meta.newSize) : undefined}
      />
    );
  }

  switch (preview.meta.fileType) {
    case "image":
      return <ImageDiff filePath={filePath} preview={preview} />;
    case "svg":
      return <SvgPreview preview={preview} />;
    default:
      return (
        <EmptyState
          icon={FileQuestion}
          title={t("diff.binary")}
          description={
            filePath.split(".").pop()?.toUpperCase() +
            (preview.meta.newSize != null ? ` · ${formatFileSize(preview.meta.newSize)}` : "")
          }
        />
      );
  }
}

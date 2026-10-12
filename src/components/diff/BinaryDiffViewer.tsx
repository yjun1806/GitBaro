import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import type { BinaryPreview } from "@/types";
import { ImageDiff } from "./ImageDiff";
import { SvgPreview } from "./SvgPreview";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useDiffForceStore } from "@/stores/diff-force";

interface BinaryDiffViewerProps {
  filePath: string;
  preview: BinaryPreview;
  /** 있으면 「너무 큼」 안내에 「그래도 보기」를 둔다(`DiffOutput.forceKey`). */
  forceKey?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function BinaryDiffViewer({ filePath, preview, forceKey }: BinaryDiffViewerProps) {
  const { t } = useTranslation();
  const force = useDiffForceStore((s) => s.force);

  if (preview.meta.tooLarge) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("diff.tooLarge")}
        description={
          preview.meta.newSize != null || preview.meta.oldSize != null
            ? formatFileSize(Math.max(preview.meta.newSize ?? 0, preview.meta.oldSize ?? 0))
            : undefined
        }
        action={
          forceKey ? (
            <Button size="sm" variant="secondary" onClick={() => force(forceKey)}>
              {t("diff.showAnyway")}
            </Button>
          ) : undefined
        }
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

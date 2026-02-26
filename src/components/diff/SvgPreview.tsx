import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BinaryPreview } from "@/types";

interface SvgPreviewProps {
  preview: BinaryPreview;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function SvgPreview({ preview }: SvgPreviewProps) {
  const { t } = useTranslation();
  const [oldDim, setOldDim] = useState<{ width: number; height: number } | null>(null);
  const [newDim, setNewDim] = useState<{ width: number; height: number } | null>(null);

  const oldSrc = preview.oldBase64
    ? `data:image/svg+xml;base64,${preview.oldBase64}`
    : null;
  const newSrc = preview.newBase64
    ? `data:image/svg+xml;base64,${preview.newBase64}`
    : null;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      <div className="text-center">
        <span className="text-xs font-medium text-muted-foreground">
          {t("diff.svgPreview")}
        </span>
      </div>

      <div className="flex gap-4 justify-center">
        {/* Old SVG */}
        <div className="flex flex-col items-center gap-2 flex-1 max-w-[50%]">
          {oldSrc ? (
            <>
              <span className="text-xs font-medium text-red-500">
                {t("diff.deleted")}
              </span>
              <div className="checkerboard-bg rounded-md overflow-hidden image-diff-border-deleted p-2">
                <img
                  src={oldSrc}
                  alt="old svg"
                  className="max-w-full max-h-[400px] object-contain"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setOldDim({ width: img.naturalWidth, height: img.naturalHeight });
                  }}
                />
              </div>
              <div className="flex flex-col items-center gap-0.5">
                {oldDim && (
                  <span className="image-meta-label">
                    {t("diff.dimensions", { width: oldDim.width, height: oldDim.height })}
                  </span>
                )}
                {preview.meta.oldSize != null && (
                  <span className="image-meta-label">
                    {t("diff.fileSize", { size: formatFileSize(preview.meta.oldSize) })}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
              —
            </div>
          )}
        </div>

        {/* New SVG */}
        <div className="flex flex-col items-center gap-2 flex-1 max-w-[50%]">
          {newSrc ? (
            <>
              <span className="text-xs font-medium text-green-500">
                {t("diff.added")}
              </span>
              <div className="checkerboard-bg rounded-md overflow-hidden image-diff-border-added p-2">
                <img
                  src={newSrc}
                  alt="new svg"
                  className="max-w-full max-h-[400px] object-contain"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNewDim({ width: img.naturalWidth, height: img.naturalHeight });
                  }}
                />
              </div>
              <div className="flex flex-col items-center gap-0.5">
                {newDim && (
                  <span className="image-meta-label">
                    {t("diff.dimensions", { width: newDim.width, height: newDim.height })}
                  </span>
                )}
                {preview.meta.newSize != null && (
                  <span className="image-meta-label">
                    {t("diff.fileSize", { size: formatFileSize(preview.meta.newSize) })}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
              —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

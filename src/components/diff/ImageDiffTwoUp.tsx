import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BinaryFileMeta } from "@/types";

interface ImageDiffTwoUpProps {
  oldSrc: string | null;
  newSrc: string | null;
  meta: BinaryFileMeta;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

interface ImageDimensions {
  width: number;
  height: number;
}

export function ImageDiffTwoUp({ oldSrc, newSrc, meta }: ImageDiffTwoUpProps) {
  const { t } = useTranslation();
  const [oldDim, setOldDim] = useState<ImageDimensions | null>(null);
  const [newDim, setNewDim] = useState<ImageDimensions | null>(null);

  const sizeDiff =
    meta.oldSize != null && meta.newSize != null
      ? meta.newSize - meta.oldSize
      : null;

  const sizePercent =
    sizeDiff != null && meta.oldSize != null && meta.oldSize > 0
      ? Math.round((meta.newSize! / meta.oldSize) * 100)
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 justify-center">
        {/* Old image */}
        <div className="flex flex-col items-center gap-2 flex-1 max-w-[50%]">
          {oldSrc ? (
            <>
              <span className="text-xs font-medium text-red-500">
                {t("diff.deleted")}
              </span>
              <div className="checkerboard-bg rounded-md overflow-hidden image-diff-border-deleted p-1">
                <img
                  src={oldSrc}
                  alt="old"
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
                {meta.oldSize != null && (
                  <span className="image-meta-label">
                    {t("diff.fileSize", { size: formatFileSize(meta.oldSize) })}
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

        {/* New image */}
        <div className="flex flex-col items-center gap-2 flex-1 max-w-[50%]">
          {newSrc ? (
            <>
              <span className="text-xs font-medium text-green-500">
                {t("diff.added")}
              </span>
              <div className="checkerboard-bg rounded-md overflow-hidden image-diff-border-added p-1">
                <img
                  src={newSrc}
                  alt="new"
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
                {meta.newSize != null && (
                  <span className="image-meta-label">
                    {t("diff.fileSize", { size: formatFileSize(meta.newSize) })}
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

      {/* Size diff summary */}
      {sizeDiff != null && (
        <div className="text-center">
          <span className="image-meta-label">
            {t("diff.sizeDiff", {
              diff: `${sizeDiff > 0 ? "+" : ""}${formatFileSize(Math.abs(sizeDiff))}`,
              percent: sizePercent,
            })}
          </span>
        </div>
      )}
    </div>
  );
}

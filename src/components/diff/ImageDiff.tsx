import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { BinaryPreview } from "@/types";
import { ImageDiffTwoUp } from "./ImageDiffTwoUp";
import { ImageDiffSwipe } from "./ImageDiffSwipe";
import { ImageDiffOnionSkin } from "./ImageDiffOnionSkin";
import { ImageDiffDifference } from "./ImageDiffDifference";
import { Segmented } from "@/components/ui/Segmented";

type DiffMode = "two-up" | "swipe" | "onion-skin" | "difference";

interface ImageDiffProps {
  filePath: string;
  preview: BinaryPreview;
}

export function ImageDiff({ filePath: _filePath, preview }: ImageDiffProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DiffMode>("two-up");

  const oldSrc = useMemo(
    () =>
      preview.oldBase64
        ? `data:${preview.meta.mimeType};base64,${preview.oldBase64}`
        : null,
    [preview.oldBase64, preview.meta.mimeType],
  );

  const newSrc = useMemo(
    () =>
      preview.newBase64
        ? `data:${preview.meta.mimeType};base64,${preview.newBase64}`
        : null,
    [preview.newBase64, preview.meta.mimeType],
  );

  const modes: { value: DiffMode; label: string }[] = [
    { value: "two-up", label: t("diff.imageDiff.twoUp") },
    { value: "swipe", label: t("diff.imageDiff.swipe") },
    { value: "onion-skin", label: t("diff.imageDiff.onionSkin") },
    { value: "difference", label: t("diff.imageDiff.difference") },
  ];

  const hasBoth = oldSrc != null && newSrc != null;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      {hasBoth && (
        <div className="flex justify-center">
          <Segmented size="sm" ariaLabel={t("diff.imageDiff.modeLabel")} value={mode} onChange={setMode} options={modes} />
        </div>
      )}

      {mode === "two-up" || !hasBoth ? (
        <ImageDiffTwoUp oldSrc={oldSrc} newSrc={newSrc} meta={preview.meta} />
      ) : mode === "swipe" ? (
        <ImageDiffSwipe oldSrc={oldSrc!} newSrc={newSrc!} />
      ) : mode === "onion-skin" ? (
        <ImageDiffOnionSkin oldSrc={oldSrc!} newSrc={newSrc!} />
      ) : (
        <ImageDiffDifference oldSrc={oldSrc!} newSrc={newSrc!} />
      )}
    </div>
  );
}

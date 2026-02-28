import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { BinaryPreview } from "@/types";
import { ImageDiffTwoUp } from "./ImageDiffTwoUp";
import { ImageDiffSwipe } from "./ImageDiffSwipe";
import { ImageDiffOnionSkin } from "./ImageDiffOnionSkin";
import { ImageDiffDifference } from "./ImageDiffDifference";

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

  const modes: { key: DiffMode; label: string }[] = [
    { key: "two-up", label: t("diff.imageDiff.twoUp") },
    { key: "swipe", label: t("diff.imageDiff.swipe") },
    { key: "onion-skin", label: t("diff.imageDiff.onionSkin") },
    { key: "difference", label: t("diff.imageDiff.difference") },
  ];

  const hasBoth = oldSrc != null && newSrc != null;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      {hasBoth && (
        <div className="flex justify-center">
          <div className="image-diff-mode-bar">
            {modes.map((m) => (
              <button
                key={m.key}
                className={clsx("image-diff-mode-btn", mode === m.key && "active")}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
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

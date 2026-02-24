import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import type { DiffOutput, DiffHunk, FileStatus } from "@/types";
import { DiffHeader } from "./DiffHeader";

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp",
  css: "css", scss: "scss", html: "html", json: "json", md: "markdown",
  yaml: "yaml", yml: "yaml", toml: "toml", sh: "bash", sql: "sql",
  xml: "xml", svg: "xml",
};

function getFileLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG_MAP[ext] ?? ext;
}

function hunksToUnifiedDiff(filePath: string, hunks: DiffHunk[]): string {
  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];
  for (const hunk of hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.lineType === "add" ? "+" : line.lineType === "delete" ? "-" : " ";
      lines.push(prefix + line.content.replace(/\n$/, ""));
    }
  }
  return lines.join("\n");
}

interface DiffViewerProps {
  diff: DiffOutput | null;
  status?: FileStatus;
}

export function DiffViewer({ diff, status = "modified" }: DiffViewerProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const isDark = document.documentElement.classList.contains("dark");

  const stats = useMemo(() => {
    if (!diff) return { added: 0, removed: 0 };
    let added = 0;
    let removed = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.lineType === "add") added++;
        else if (line.lineType === "delete") removed++;
      }
    }
    return { added, removed };
  }, [diff]);

  const diffData = useMemo(() => {
    if (!diff || diff.binary || diff.hunks.length === 0) return null;
    const lang = getFileLang(diff.filePath);
    return {
      oldFile: { fileName: diff.filePath, fileLang: lang, content: diff.oldContent || null },
      newFile: { fileName: diff.filePath, fileLang: lang, content: diff.newContent || null },
      hunks: [hunksToUnifiedDiff(diff.filePath, diff.hunks)],
    };
  }, [diff]);

  const toggleView = () =>
    setViewMode((v) => (v === "unified" ? "split" : "unified"));

  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("diff.noSelection")}
      </div>
    );
  }

  if (diff.binary) {
    return (
      <div className="flex-1 flex flex-col">
        <DiffHeader
          filePath={diff.filePath}
          status={status}
          addedLines={0}
          removedLines={0}
          viewMode={viewMode}
          onToggleView={toggleView}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
            <FileQuestion className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium">{t("diff.binary")}</p>
          <p className="text-xs">{diff.filePath.split(".").pop()?.toUpperCase()}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <DiffHeader
        filePath={diff.filePath}
        status={status}
        addedLines={stats.added}
        removedLines={stats.removed}
        viewMode={viewMode}
        onToggleView={toggleView}
      />

      <div className="flex-1 min-h-0 overflow-auto">
        {diffData ? (
          <DiffView
            data={diffData}
            diffViewMode={viewMode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
            diffViewTheme={isDark ? "dark" : "light"}
            diffViewHighlight
            diffViewWrap={false}
            diffViewFontSize={12}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
              <FileQuestion className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium">{t("diff.binary")}</p>
            <p className="text-xs">{diff.filePath.split(".").pop()?.toUpperCase()}</p>
          </div>
        )}
      </div>
    </div>
  );
}

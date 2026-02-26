import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import { DiffFile } from "@git-diff-view/core";
import { highlighter } from "@git-diff-view/lowlight";
import "@git-diff-view/react/styles/diff-view-pure.css";
import "./diff-theme.css";
import type { DiffOutput, DiffHunk, FileStatus } from "@/types";
import { DiffHeader } from "./DiffHeader";
import { BinaryDiffViewer } from "./BinaryDiffViewer";
import { useUIStore } from "@/stores/ui";

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
    lines.push(hunk.header.replace(/\n$/, ""));
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
  const theme = useUIStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

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

  // DiffFile 캐시 — 같은 diff 객체에 대해 initRaw/initSyntax를 반복하지 않음.
  // WeakMap이므로 diff 객체가 GC되면 캐시도 자동 정리.
  const cacheRef = useRef(new WeakMap<DiffOutput, DiffFile>());

  const diffFile = useMemo(() => {
    if (!diff || diff.binary || diff.hunks.length === 0) return null;

    const cached = cacheRef.current.get(diff);
    if (cached) {
      // 테마만 갱신 (lowlight는 class 기반이라 syntax 재처리 불필요)
      cached.initTheme(isDark ? "dark" : "light");
      return cached;
    }

    const lang = getFileLang(diff.filePath);
    const file = new DiffFile(
      diff.filePath,
      diff.oldContent || "",
      diff.filePath,
      diff.newContent || "",
      [hunksToUnifiedDiff(diff.filePath, diff.hunks)],
      lang,
      lang,
    );
    file.initTheme(isDark ? "dark" : "light");
    file.initRaw();
    file.initSyntax({ registerHighlighter: highlighter });
    cacheRef.current.set(diff, file);
    return file;
  }, [diff, isDark]);

  // viewMode에 따라 필요한 라인만 빌드 (idempotent — 내부 플래그로 중복 실행 방지)
  if (diffFile) {
    if (viewMode === "split") {
      diffFile.buildSplitDiffLines();
    } else {
      diffFile.buildUnifiedDiffLines();
    }
  }

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
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <DiffHeader
          filePath={diff.filePath}
          status={status}
          addedLines={0}
          removedLines={0}
          viewMode={viewMode}
          onToggleView={toggleView}
        />
        <div className="flex-1 min-h-0 overflow-auto">
          {diff.binaryPreview ? (
            <BinaryDiffViewer filePath={diff.filePath} preview={diff.binaryPreview} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
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
        {diffFile ? (
          <DiffView
            diffFile={diffFile}
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
            <p className="text-sm font-medium">{t("diff.noSelection")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

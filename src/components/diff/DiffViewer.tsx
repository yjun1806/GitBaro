import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import { DiffFile } from "@git-diff-view/core";
import { highlighter } from "@git-diff-view/lowlight";
import "@git-diff-view/react/styles/diff-view-pure.css";
import "./diff-theme.css";
import type { DiffOutput, DiffHunk, FileStatus } from "@/types";
import { DiffHeader } from "./DiffHeader";
import { BinaryDiffViewer } from "./BinaryDiffViewer";
import { VirtualizedDiffView } from "./VirtualizedDiffView";
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

// 행 렌더링은 VirtualizedDiffView가 윈도잉하므로 행 수 자체는 병목이 아니다.
// 다만 initSyntax는 파일 전체를 메인 스레드에서 파싱하므로, 큰 diff는 하이라이팅을
// 기본 off로 두고(HIGHLIGHT_LIMIT) 사용자가 필요할 때 켤 수 있게 한다.
const HIGHLIGHT_LIMIT = 2000;

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

  // 큰 diff는 하이라이팅을 기본 off로 두되, 사용자가 켤 수 있다 — diff가 바뀌면 초기화.
  const [forceHighlight, setForceHighlight] = useState(false);
  useEffect(() => {
    setForceHighlight(false);
  }, [diff]);

  const stats = useMemo(() => {
    if (!diff) return { added: 0, removed: 0, total: 0 };
    let added = 0;
    let removed = 0;
    let total = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        total++;
        if (line.lineType === "add") added++;
        else if (line.lineType === "delete") removed++;
      }
    }
    return { added, removed, total };
  }, [diff]);

  // total = 실제 렌더되는 행 수(context 포함). 임계값은 이걸 기준으로 판정.
  const wantHighlight = stats.total <= HIGHLIGHT_LIMIT || forceHighlight;

  // DiffFile 캐시 — 같은 diff 객체에 대해 initRaw/initSyntax를 반복하지 않음.
  // WeakMap이므로 diff 객체가 GC되면 캐시도 자동 정리.
  const cacheRef = useRef(new WeakMap<DiffOutput, DiffFile>());
  // syntax가 이미 빌드된 파일 추적 — 하이라이팅 토글 시 중복 파싱 방지.
  const syntaxInitedRef = useRef(new WeakSet<DiffFile>());

  const diffFile = useMemo(() => {
    if (!diff || diff.binary || diff.hunks.length === 0) return null;

    const initSyntaxOnce = (file: DiffFile) => {
      if (wantHighlight && !syntaxInitedRef.current.has(file)) {
        file.initSyntax({ registerHighlighter: highlighter });
        syntaxInitedRef.current.add(file);
      }
    };

    const cached = cacheRef.current.get(diff);
    if (cached) {
      // 테마만 갱신 (lowlight는 class 기반이라 syntax 재처리 불필요)
      cached.initTheme(isDark ? "dark" : "light");
      initSyntaxOnce(cached);
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
    initSyntaxOnce(file);
    cacheRef.current.set(diff, file);
    return file;
  }, [diff, isDark, wantHighlight]);

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

      {!wantHighlight && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs bg-surface border-b border-border text-muted-foreground">
          <span>{t("diff.highlightDisabled", { lines: stats.total })}</span>
          <button
            type="button"
            onClick={() => setForceHighlight(true)}
            className="shrink-0 px-2 py-0.5 rounded text-accent hover:bg-accent/10"
          >
            {t("diff.enableHighlight")}
          </button>
        </div>
      )}

      {diffFile ? (
        <VirtualizedDiffView
          diffFile={diffFile}
          viewMode={viewMode}
          isDark={isDark}
          highlight={wantHighlight}
          fontSize={12}
        />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
            <FileQuestion className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium">{t("diff.noSelection")}</p>
        </div>
      )}
    </div>
  );
}

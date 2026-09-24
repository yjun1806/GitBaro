import { useState, useMemo, useRef, useCallback, type ReactNode } from "react";
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
import { MarkdownDiffView } from "./MarkdownDiffView";
import { availableModes, defaultMode, diffResetKey, type DiffViewMode } from "./view-mode";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";

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
  /** Working-tree diffs: whether this is the staged side. Part of the view reset key. */
  staged?: boolean;
  /** 줄 보기에서 「방금 바뀐 줄」로 강조할 새 쪽 줄 번호(따라가기). */
  freshLines?: ReadonlySet<number>;
  /** 줄 보기에서 이 새 쪽 줄 번호가 보이도록 스크롤한다(따라가기). */
  revealLine?: number | null;
  /** diff 머리의 줄 수 앞에 둘 것(따라가기의 「4초 전 수정」, 스테이지 쪽 고르기). */
  headerExtra?: ReactNode;
  /** diff 머리에 「크게 보기」 버튼을 둘지. 목록 + diff 화면에서만 켠다. */
  maximizable?: boolean;
}

export function DiffViewer({
  diff,
  status = "modified",
  staged = false,
  freshLines,
  revealLine = null,
  headerExtra,
  maximizable = false,
}: DiffViewerProps) {
  const { t } = useTranslation();
  const lineMode = useUIStore((s) => s.diffLineMode);
  const setLineMode = useUIStore((s) => s.setDiffLineMode);
  const isMaximized = useUIStore((s) => s.isDiffMaximized);
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  const [viewMode, setViewMode] = useState<DiffViewMode>(() =>
    defaultMode(diff?.filePath, diff?.binary ?? false, lineMode),
  );
  const theme = useUIStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const addToast = useToastStore((s) => s.addToast);

  const filePath = diff?.filePath;
  const binary = diff?.binary ?? false;
  const modes = useMemo(() => availableModes(filePath ?? "", binary), [filePath, binary]);

  // 큰 diff는 하이라이팅을 기본 off로 두되, 사용자가 켤 수 있다.
  const [forceHighlight, setForceHighlight] = useState(false);

  // 파일(또는 staged 여부)이 바뀔 때만 보기 상태를 초기화한다 — md는 문서 보기, 나머지는
  // 마지막으로 고른 줄 보기. 같은 파일이 디스크 변경으로 다시 조회되면 diff 객체만 새로
  // 오므로 모드·하이라이팅·스크롤(아래 `key`)이 그대로 유지된다.
  // 렌더 중에 맞춘다 — effect로 하면 새 파일이 한 프레임 동안 이전 모드로 그려진다.
  const resetKey = diffResetKey(filePath, staged, binary);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setViewMode(defaultMode(filePath, binary, lineMode));
    setForceHighlight(false);
  }

  const handleSelectMode = useCallback(
    (mode: DiffViewMode) => {
      setViewMode(mode);
      if (mode !== "document") setLineMode(mode);
    },
    [setLineMode],
  );

  // 문서 모드가 실패하면(계산 오류·타임아웃) 빈 화면 대신 줄 보기로 물러선다.
  // 조용히 바꾸면 "왜 문서 보기가 안 뜨지"가 되므로 이유를 말한다.
  const handleDocError = useCallback(
    (reason: string) => {
      addToast(t(reason === "timeout" ? "mdDiff.timeout" : "mdDiff.failed"), "warning");
      setViewMode(useUIStore.getState().diffLineMode);
    },
    [addToast, t],
  );

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

  // 문서 보기는 이 파이프라인을 전혀 쓰지 않는다. 그런데도 빌드하면 `initSyntax`가 파일
  // 전체를 메인 스레드에서 파싱해, 문서 diff를 Worker로 밀어낸 이유를 그대로 되돌린다.
  // (통합 ↔ 나란히 전환에는 재실행되지 않도록 boolean으로 좁혀 의존한다.)
  const wantsLineDiff = viewMode !== "document";

  const diffFile = useMemo(() => {
    if (!diff || diff.binary || diff.hunks.length === 0) return null;
    if (!wantsLineDiff) return null;

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
    // 원문을 함께 넘겨야 접힌 구간을 펼칠 수 있다(`getExpandEnabled()`). 원문이 있으면
    // `DiffFile`이 파일 전체를 들고 있게 되지만, 접힘은 라인의 `isHidden`으로 표현되므로
    // 화면에는 hunk만 나온다 — 그 필터링은 `VirtualizedDiffView`가 한다.
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
  }, [diff, isDark, wantHighlight, wantsLineDiff]);

  // viewMode에 따라 필요한 라인만 빌드 (idempotent — 내부 플래그로 중복 실행 방지)
  if (diffFile) {
    if (viewMode === "split") {
      diffFile.buildSplitDiffLines();
    } else {
      diffFile.buildUnifiedDiffLines();
    }
  }

  if (!diff) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        {t("diff.noSelection")}
        {/* 크게 보는 중에 diff가 비면 머리의 버튼이 없으므로 여기서 되돌린다. */}
        {maximizable && isMaximized && (
          <button
            type="button"
            onClick={() => setMaximized(false)}
            className="h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
          >
            {t("diff.restoreSize")}
          </button>
        )}
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
          modes={modes}
          onSelectMode={handleSelectMode}
          extra={headerExtra}
          maximizable={maximizable}
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
        modes={modes}
        onSelectMode={handleSelectMode}
        extra={headerExtra}
        maximizable={maximizable}
      />

      {viewMode !== "document" && !wantHighlight && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs bg-surface border-b border-border text-muted-foreground">
          <span>{t("diff.highlightDisabled", { lines: stats.total })}</span>
          <button
            type="button"
            onClick={() => setForceHighlight(true)}
            className="shrink-0 px-2 py-0.5 rounded font-medium text-foreground underline underline-offset-2 hover:bg-accent"
          >
            {t("diff.enableHighlight")}
          </button>
        </div>
      )}

      {viewMode === "document" ? (
        // 파일이 바뀌면 새로 마운트한다 — 안 그러면 새 원문으로 계산이 끝나기 전 한 프레임
        // 동안 이전 파일의 문서가 남는다.
        <MarkdownDiffView
          key={diff.filePath}
          oldContent={diff.oldContent}
          newContent={diff.newContent}
          onError={handleDocError}
        />
      ) : diffFile ? (
        // 파일·모드마다 새로 마운트한다. 행 키(`l3`, `h0`)는 파일·모드를 가리지 않아서,
        // 같은 가상 스크롤러를 재사용하면 이전 파일의 행 높이가 새 파일에 남아 행이 겹친다.
        // 같은 파일의 재조회(새 diffFile)에는 키가 그대로라 스크롤 위치가 유지된다.
        <VirtualizedDiffView
          key={`${resetKey}\u0000${viewMode}`}
          diffFile={diffFile}
          viewMode={viewMode}
          isDark={isDark}
          highlight={wantHighlight}
          fontSize={12}
          freshLines={freshLines}
          revealLine={revealLine}
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

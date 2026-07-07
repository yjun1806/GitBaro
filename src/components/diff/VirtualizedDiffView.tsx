import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DiffFile,
  DiffLineType,
  checkDiffLineIncludeChange,
  getSyntaxDiffTemplate,
  getSyntaxLineTemplate,
  getPlainDiffTemplate,
  getPlainLineTemplate,
  type DiffLine,
  type DiffHunkItem,
  type SyntaxLine,
} from "@git-diff-view/core";

// @git-diff-view의 <DiffView>는 전체 행을 <table>에 렌더해 큰 diff에서 프리즈된다.
// 여기서는 DiffFile이 계산한 라인 데이터·신택스·intra-line 템플릿은 그대로 재사용하고,
// 뷰포트에 보이는 행만 @tanstack/react-virtual로 윈도잉해 DOM 노드를 화면 크기로 고정한다.
//
// DiffFile.getUnifiedLine(i)는 content 라인만 반환한다(hunk 헤더는 별도). 각 hunk의 첫
// content 라인에 diff.prevHunkLine이 붙으므로, 그 지점마다 헤더 행을 끼워 평탄한 행 배열을
// 만들어 가상화한다.

const MONO_FONT = "Menlo, Consolas, monospace";

type Operator = "add" | "del" | undefined;
type SyntaxLineT = SyntaxLine & { template?: string };
type SplitLine = { lineNumber?: number; value?: string; diff?: DiffLine };
type Row = { kind: "hunk"; text: string } | { kind: "line"; index: number };

function operatorOf(type: DiffLineType | undefined): Operator {
  if (type === DiffLineType.Add) return "add";
  if (type === DiffLineType.Delete) return "del";
  return undefined;
}

function hunkText(h: DiffHunkItem): string {
  const info = (h.unifiedInfo ?? h.splitInfo) as { plainText?: string } | undefined;
  return info?.plainText ?? "";
}

// 라인 배경색 — diff-theme.css의 CSS 변수를 재사용(테마 자동 대응).
function contentBg(type: DiffLineType | undefined): string {
  if (type === DiffLineType.Add) return "var(--diff-add-content--)";
  if (type === DiffLineType.Delete) return "var(--diff-del-content--)";
  if (type === DiffLineType.Hunk) return "var(--diff-hunk-content--)";
  return "var(--diff-plain-content--)";
}

function numberBg(type: DiffLineType | undefined): string {
  if (type === DiffLineType.Add) return "var(--diff-add-lineNumber--)";
  if (type === DiffLineType.Delete) return "var(--diff-del-lineNumber--)";
  if (type === DiffLineType.Hunk) return "var(--diff-hunk-lineNumber--)";
  return "var(--diff-plain-content--)";
}

// DiffFile이 라인별로 만들어 둔 HTML 템플릿(신택스 + intra-line 변경 강조)을 그대로 꺼낸다.
// 없으면 라이브러리와 동일한 빌더로 lazy 생성해 캐시한다.
interface RenderedContent {
  html?: string;
  text?: string;
  cls: string;
}

function resolveContent(
  diffFile: DiffFile,
  diffLine: DiffLine | undefined,
  syntaxLine: SyntaxLineT | undefined,
  rawLine: string,
  operator: Operator,
  highlight: boolean,
): RenderedContent {
  const hasChange = checkDiffLineIncludeChange(diffLine);

  if (highlight && syntaxLine) {
    if (diffLine && hasChange && operator) {
      if (!diffLine.syntaxTemplate) {
        getSyntaxDiffTemplate({ diffFile, diffLine, syntaxLine, operator });
      }
      if (diffLine.syntaxTemplate) {
        return { html: diffLine.syntaxTemplate, cls: "diff-line-syntax-raw" };
      }
    }
    if (!syntaxLine.template) {
      syntaxLine.template = getSyntaxLineTemplate(syntaxLine);
    }
    if (syntaxLine.template) {
      return { html: syntaxLine.template, cls: "diff-line-syntax-raw" };
    }
  }

  // 하이라이팅 off(대형 diff) — intra-line 변경만 유지하고 신택스는 생략.
  if (diffLine && hasChange && operator) {
    if (!diffLine.plainTemplate) {
      getPlainDiffTemplate({ diffLine, rawLine, operator });
    }
    if (diffLine.plainTemplate) {
      return { html: diffLine.plainTemplate, cls: "diff-line-content-raw" };
    }
  }

  if (rawLine && !highlight) {
    return { html: getPlainLineTemplate(rawLine), cls: "diff-line-content-raw" };
  }

  return { text: rawLine, cls: "diff-line-content-raw" };
}

function ContentCell({ content, style }: { content: RenderedContent; style: React.CSSProperties }) {
  if (content.html !== undefined) {
    return (
      <span className={content.cls} style={style}>
        <span dangerouslySetInnerHTML={{ __html: content.html }} />
      </span>
    );
  }
  return (
    <span className={content.cls} style={style}>
      {content.text}
    </span>
  );
}

interface VirtualizedDiffViewProps {
  diffFile: DiffFile;
  viewMode: "unified" | "split";
  isDark: boolean;
  highlight: boolean;
  fontSize: number;
}

export function VirtualizedDiffView({
  diffFile,
  viewMode,
  isDark,
  highlight,
  fontSize,
}: VirtualizedDiffViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowHeight = Math.round(fontSize * 1.6);
  const isSplit = viewMode === "split";

  // 고정폭(monospace) 기준 픽셀 계산 — 가로 스크롤 트랙 폭과 줄번호 칸 폭 산정.
  const metrics = useMemo(() => {
    const ch = fontSize * 0.6;
    const oldLines = diffFile.getOldFileContent().split("\n");
    const newLines = diffFile.getNewFileContent().split("\n");
    const maxOldChars = oldLines.reduce((m, l) => Math.max(m, l.length), 0);
    const maxNewChars = newLines.reduce((m, l) => Math.max(m, l.length), 0);
    const maxLineNo = Math.max(oldLines.length, newLines.length, 1);
    const digits = String(maxLineNo).length;
    const numColPx = Math.max(2, digits) * ch + 16;
    const contentPad = 12;
    return {
      numColPx,
      unifiedInner: numColPx * 2 + Math.max(maxOldChars, maxNewChars) * ch + contentPad,
      splitLeftContentPx: maxOldChars * ch + contentPad,
      splitRightContentPx: maxNewChars * ch + contentPad,
      splitInner: numColPx * 2 + (maxOldChars + maxNewChars) * ch + contentPad * 2,
    };
  }, [diffFile, fontSize]);

  // 평탄한 행 배열 — hunk 헤더를 content 라인 사이에 삽입.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const len = isSplit ? diffFile.splitLineLength : diffFile.unifiedLineLength;
    for (let i = 0; i < len; i++) {
      const prevHunk = isSplit
        ? diffFile.getSplitLeftLine(i).diff?.prevHunkLine ??
          diffFile.getSplitRightLine(i).diff?.prevHunkLine
        : diffFile.getUnifiedLine(i).diff?.prevHunkLine;
      if (prevHunk) out.push({ kind: "hunk", text: hunkText(prevHunk) });
      out.push({ kind: "line", index: i });
    }
    return out;
  }, [diffFile, isSplit]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 24,
  });

  const numStyle: React.CSSProperties = {
    width: metrics.numColPx,
    minWidth: metrics.numColPx,
    flexShrink: 0,
    textAlign: "right",
    padding: "0 6px",
    userSelect: "none",
    color: "var(--diff-plain-lineNumber-color--)",
    lineHeight: `${rowHeight}px`,
    whiteSpace: "pre",
  };

  const contentStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "0 6px",
    lineHeight: `${rowHeight}px`,
    whiteSpace: "pre",
  };

  const renderHunkRow = (text: string) => (
    <div
      className="flex"
      style={{
        height: rowHeight,
        background: contentBg(DiffLineType.Hunk),
        color: "var(--diff-hunk-content-color--)",
      }}
    >
      <span style={{ ...contentStyle }}>{text}</span>
    </div>
  );

  const renderUnifiedRow = (index: number) => {
    const line = diffFile.getUnifiedLine(index);
    const diffLine = line.diff;
    const type = diffLine?.type;
    const raw = line.value ?? "";

    const syntaxLine = line.newLineNumber
      ? diffFile.getNewSyntaxLine(line.newLineNumber)
      : line.oldLineNumber
        ? diffFile.getOldSyntaxLine(line.oldLineNumber)
        : undefined;
    const content = resolveContent(diffFile, diffLine, syntaxLine, raw, operatorOf(type), highlight);

    return (
      <div className="flex" style={{ height: rowHeight, background: contentBg(type) }}>
        <span style={{ ...numStyle, background: numberBg(type) }}>{line.oldLineNumber ?? ""}</span>
        <span style={{ ...numStyle, background: numberBg(type) }}>{line.newLineNumber ?? ""}</span>
        <ContentCell content={content} style={contentStyle} />
      </div>
    );
  };

  const renderSplitSide = (line: SplitLine, side: "old" | "new") => {
    const type = line.diff?.type;
    const raw = line.value ?? "";
    const isEmpty = line.lineNumber == null && !line.diff;
    const bg = isEmpty ? "var(--diff-empty-content--)" : contentBg(type);

    const syntaxLine =
      line.lineNumber == null
        ? undefined
        : side === "old"
          ? diffFile.getOldSyntaxLine(line.lineNumber)
          : diffFile.getNewSyntaxLine(line.lineNumber);
    const content = resolveContent(diffFile, line.diff, syntaxLine, raw, operatorOf(type), highlight);

    return (
      <>
        <span style={{ ...numStyle, background: isEmpty ? "var(--diff-empty-content--)" : numberBg(type) }}>
          {line.lineNumber ?? ""}
        </span>
        <span style={{ display: "inline-block", background: bg, flex: 1, minWidth: 0 }}>
          {!isEmpty && <ContentCell content={content} style={contentStyle} />}
        </span>
      </>
    );
  };

  const renderSplitRow = (index: number) => {
    const left = diffFile.getSplitLeftLine(index);
    const right = diffFile.getSplitRightLine(index);

    return (
      <div className="flex" style={{ height: rowHeight }}>
        <span
          style={{
            display: "flex",
            width: metrics.numColPx + metrics.splitLeftContentPx,
            flexShrink: 0,
            borderRight: "1px solid var(--diff-border--)",
          }}
        >
          {renderSplitSide(left, "old")}
        </span>
        <span style={{ display: "flex", flex: 1, minWidth: 0 }}>
          {renderSplitSide(right, "new")}
        </span>
      </div>
    );
  };

  const renderRow = (row: Row) => {
    if (row.kind === "hunk") return renderHunkRow(row.text);
    return isSplit ? renderSplitRow(row.index) : renderUnifiedRow(row.index);
  };

  return (
    <div
      ref={parentRef}
      className="flex-1 min-h-0 overflow-auto diff-tailwindcss-wrapper"
      data-theme={isDark ? "dark" : "light"}
    >
      <div
        className="diff-style-root"
        style={{
          position: "relative",
          height: virtualizer.getTotalSize(),
          width: isSplit
            ? `max(100%, ${Math.ceil(metrics.splitInner)}px)`
            : `max(100%, ${Math.ceil(metrics.unifiedInner)}px)`,
          fontFamily: MONO_FONT,
          fontSize,
          background: "var(--diff-plain-content--)",
        }}
      >
        {virtualizer.getVirtualItems().map((v) => (
          <div
            key={v.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${v.start}px)`,
            }}
          >
            {renderRow(rows[v.index])}
          </div>
        ))}
      </div>
    </div>
  );
}

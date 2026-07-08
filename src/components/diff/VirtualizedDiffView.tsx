import { useMemo, useRef, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DiffOverviewRuler } from "./DiffOverviewRuler";
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
const CHAR_WIDTH_RATIO = 0.6; // Menlo 고정폭 글리프 advance ≈ 0.6em (가로 트랙 폭 추정용)
const NUM_COL_PAD = 16;
const CONTENT_PAD = 12;

type Operator = "add" | "del" | undefined;
type SyntaxLineT = SyntaxLine & { template?: string };
type SplitLine = { lineNumber?: number; value?: string; diff?: DiffLine };
export type DiffRow = { kind: "hunk"; text: string } | { kind: "line"; index: number };

// A contiguous run of changed rows, for the overview ruler. start/end are
// inclusive indices into DiffLayout.rows.
export type ChangeKind = "add" | "del" | "mix";
export interface ChangeBlock {
  start: number;
  end: number;
  kind: ChangeKind;
}

export interface DiffLayout {
  rows: DiffRow[];
  changeBlocks: ChangeBlock[];
  maxLineNo: number;
  maxUnifiedChars: number;
  maxOldChars: number;
  maxNewChars: number;
}

function operatorOf(type: DiffLineType | undefined): Operator {
  if (type === DiffLineType.Add) return "add";
  if (type === DiffLineType.Delete) return "del";
  return undefined;
}

function hunkText(h: DiffHunkItem): string {
  const info = (h.unifiedInfo ?? h.splitInfo) as { plainText?: string } | undefined;
  return info?.plainText ?? "";
}

function lineChars(value: string | undefined): number {
  // 표시 폭 추정 — 후행 개행은 폭에 무관하므로 제외.
  return value ? value.replace(/\n$/, "").length : 0;
}

// 평탄한 행 배열(hunk 헤더 삽입) + 가로 트랙/줄번호 폭 추정치를 한 번의 순회로 계산한다.
// 순수 함수 — 렌더 밖에서 테스트 가능.
export function buildDiffLayout(diffFile: DiffFile, isSplit: boolean): DiffLayout {
  const rows: DiffRow[] = [];
  const changeBlocks: ChangeBlock[] = [];
  let block: ChangeBlock | null = null;
  let maxLineNo = 1;
  let maxUnifiedChars = 0;
  let maxOldChars = 0;
  let maxNewChars = 0;
  const len = isSplit ? diffFile.splitLineLength : diffFile.unifiedLineLength;

  // Extend/close the current change block based on a line row's add/del state.
  const trackChange = (hasAdd: boolean, hasDel: boolean) => {
    if (!hasAdd && !hasDel) {
      block = null; // context line ends the run
      return;
    }
    const kind: ChangeKind = hasAdd && hasDel ? "mix" : hasAdd ? "add" : "del";
    const rowIdx = rows.length - 1;
    if (block) {
      block.end = rowIdx;
      if (block.kind !== kind) block.kind = "mix";
    } else {
      block = { start: rowIdx, end: rowIdx, kind };
      changeBlocks.push(block);
    }
  };

  for (let i = 0; i < len; i++) {
    if (isSplit) {
      const left = diffFile.getSplitLeftLine(i);
      const right = diffFile.getSplitRightLine(i);
      const prevHunk = left.diff?.prevHunkLine ?? right.diff?.prevHunkLine;
      if (prevHunk) {
        rows.push({ kind: "hunk", text: hunkText(prevHunk) });
        block = null; // a hunk header separates change runs
      }
      rows.push({ kind: "line", index: i });
      trackChange(
        right.diff?.type === DiffLineType.Add,
        left.diff?.type === DiffLineType.Delete,
      );
      if (left.lineNumber) maxLineNo = Math.max(maxLineNo, left.lineNumber);
      if (right.lineNumber) maxLineNo = Math.max(maxLineNo, right.lineNumber);
      maxOldChars = Math.max(maxOldChars, lineChars(left.value));
      maxNewChars = Math.max(maxNewChars, lineChars(right.value));
    } else {
      const line = diffFile.getUnifiedLine(i);
      const prevHunk = line.diff?.prevHunkLine;
      if (prevHunk) {
        rows.push({ kind: "hunk", text: hunkText(prevHunk) });
        block = null;
      }
      rows.push({ kind: "line", index: i });
      trackChange(
        line.diff?.type === DiffLineType.Add,
        line.diff?.type === DiffLineType.Delete,
      );
      if (line.oldLineNumber) maxLineNo = Math.max(maxLineNo, line.oldLineNumber);
      if (line.newLineNumber) maxLineNo = Math.max(maxLineNo, line.newLineNumber);
      maxUnifiedChars = Math.max(maxUnifiedChars, lineChars(line.value));
    }
  }

  return { rows, changeBlocks, maxLineNo, maxUnifiedChars, maxOldChars, maxNewChars };
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

interface RenderedContent {
  html?: string;
  text?: string;
  cls: string;
}

// DiffFile이 라인별로 만들어 둔 HTML 템플릿(신택스 + intra-line 변경 강조)을 꺼낸다.
// 주의(의도된 side-effect): 라이브러리와 동일하게 diffLine/syntaxLine의 template 필드를
// lazy 캐시로 채운다. 외부(라이브러리 소유) 객체에 대한 idempotent 쓰기이며 재렌더를
// 유발하지 않으므로, 보이는 행만 필요할 때 파싱하도록 렌더 경로에서 호출한다.
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
  const [scrollable, setScrollable] = useState(false);

  const rowHeight = Math.round(fontSize * 1.6);
  const isSplit = viewMode === "split";

  const layout = useMemo(() => buildDiffLayout(diffFile, isSplit), [diffFile, isSplit]);

  const metrics = useMemo(() => {
    const ch = fontSize * CHAR_WIDTH_RATIO;
    const digits = String(layout.maxLineNo).length;
    const numColPx = Math.max(2, digits) * ch + NUM_COL_PAD;
    return {
      numColPx,
      unifiedInner: numColPx * 2 + layout.maxUnifiedChars * ch + CONTENT_PAD,
      splitLeftContentPx: layout.maxOldChars * ch + CONTENT_PAD,
      splitRightContentPx: layout.maxNewChars * ch + CONTENT_PAD,
      splitInner: numColPx * 2 + (layout.maxOldChars + layout.maxNewChars) * ch + CONTENT_PAD * 2,
    };
  }, [layout, fontSize]);

  const rows = layout.rows;

  // 파일이 바뀌면 이전 파일의 스크롤 오프셋이 남지 않도록 맨 위로 리셋.
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [diffFile]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 24,
  });

  // Show the overview ruler only when the content actually overflows.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, rowHeight]);

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

  // unified 줄번호는 가로 스크롤 시 고정(행이 transform이 아니라 top으로 배치돼 sticky가 동작).
  const stickyNum = (left: number, bg: string): React.CSSProperties => ({
    ...numStyle,
    position: "sticky",
    left,
    zIndex: 1,
    background: bg,
  });

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
        <span style={stickyNum(0, numberBg(type))}>{line.oldLineNumber ?? ""}</span>
        <span style={stickyNum(metrics.numColPx, numberBg(type))}>{line.newLineNumber ?? ""}</span>
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

  const renderRow = (row: DiffRow) => {
    if (row.kind === "hunk") return renderHunkRow(row.text);
    return isSplit ? renderSplitRow(row.index) : renderUnifiedRow(row.index);
  };

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={parentRef}
        className="absolute inset-0 overflow-auto diff-tailwindcss-wrapper"
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
                top: v.start,
                left: 0,
                width: "100%",
              }}
            >
              {renderRow(rows[v.index])}
            </div>
          ))}
        </div>
      </div>
      {scrollable && (
        <DiffOverviewRuler
          blocks={layout.changeBlocks}
          rowCount={rows.length}
          onJump={(i) => virtualizer.scrollToIndex(i, { align: "center" })}
        />
      )}
    </div>
  );
}

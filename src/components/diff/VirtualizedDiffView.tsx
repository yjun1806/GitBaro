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
const CHAR_WIDTH_RATIO = 0.6; // Menlo 고정폭 글리프 advance ≈ 0.6em (줄번호 칸 폭 추정용)
const NUM_COL_PAD = 16;

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
  /** 줄번호 칸 폭을 정하는 데만 쓴다. 본문은 접혀서 가로 폭을 미리 잴 필요가 없다. */
  maxLineNo: number;
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

// 평탄한 행 배열(hunk 헤더 삽입) + 줄번호 칸 폭을 한 번의 순회로 계산한다.
// 순수 함수 — 렌더 밖에서 테스트 가능.
export function buildDiffLayout(diffFile: DiffFile, isSplit: boolean): DiffLayout {
  const rows: DiffRow[] = [];
  const changeBlocks: ChangeBlock[] = [];
  let block: ChangeBlock | null = null;
  let maxLineNo = 1;
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
    }
  }

  return { rows, changeBlocks, maxLineNo };
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

  // 긴 줄은 가로로 스크롤하지 않고 접는다. 그래서 재야 할 폭은 줄번호 칸 하나뿐이다.
  const numColPx = useMemo(() => {
    const digits = String(layout.maxLineNo).length;
    return Math.max(2, digits) * (fontSize * CHAR_WIDTH_RATIO) + NUM_COL_PAD;
  }, [layout.maxLineNo, fontSize]);

  const rows = layout.rows;

  // 파일이 바뀌면 이전 파일의 스크롤 오프셋이 남지 않도록 맨 위로 리셋.
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [diffFile]);

  // 줄이 접히면 행 높이가 제각각이 된다 — 추정치로 자리를 잡고 실제 높이는 재서 채운다.
  // (`measureElement`가 `data-index`로 행을 식별하므로 각 행에 그 속성이 필요하다.)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 12,
  });

  // 창 너비가 바뀌면 접히는 지점이 달라져 모든 행 높이가 무효가 된다.
  // **폭이 실제로 달라졌을 때만** 다시 잰다 — 높이 변화에도 반응하면 재측정이 스크롤바를
  // 만들고 그게 다시 재측정을 부르는 진동에 빠질 수 있다.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      virtualizer.measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualizer]);

  // Show the overview ruler only when the content actually overflows.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // 행이 접히며 총 높이가 자라면 그때 넘치기 시작할 수 있다 — 총 높이도 신호로 본다.
  }, [layout, rowHeight, virtualizer.getTotalSize()]);

  const numStyle: React.CSSProperties = {
    width: numColPx,
    minWidth: numColPx,
    flexShrink: 0,
    textAlign: "right",
    padding: "0 6px",
    userSelect: "none",
    color: "var(--diff-plain-lineNumber-color--)",
    lineHeight: `${rowHeight}px`,
    whiteSpace: "pre",
    // 접힌 행에서는 번호가 첫 줄에 붙어 있어야 어느 줄인지 읽힌다.
    alignSelf: "stretch",
  };

  // `pre-wrap`은 코드의 들여쓰기·연속 공백을 지키면서 폭이 모자랄 때만 접는다.
  // `anywhere`는 공백 없는 긴 토큰(URL·해시·미니파이 코드)도 칸 안에 가둔다.
  const contentStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "0 6px",
    lineHeight: `${rowHeight}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };

  const renderHunkRow = (text: string) => (
    <div
      className="flex"
      style={{
        minHeight: rowHeight,
        background: contentBg(DiffLineType.Hunk),
        color: "var(--diff-hunk-content-color--)",
      }}
    >
      <span style={contentStyle}>{text}</span>
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
      <div className="flex" style={{ minHeight: rowHeight, background: contentBg(type) }}>
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
        <span style={{ display: "flex", background: bg, flex: 1, minWidth: 0 }}>
          {!isEmpty && <ContentCell content={content} style={contentStyle} />}
        </span>
      </>
    );
  };

  const renderSplitRow = (index: number) => {
    const left = diffFile.getSplitLeftLine(index);
    const right = diffFile.getSplitRightLine(index);

    // 좌우를 정확히 반씩 나눈다. 가장 긴 줄에 맞춰 폭을 잡던 예전 방식은 한쪽에 긴 줄이
    // 하나만 있어도 반대쪽이 짜부라졌고, 그 폭 때문에 가로 스크롤이 생겼다.
    const half: React.CSSProperties = { display: "flex", width: "50%", minWidth: 0 };

    return (
      <div className="flex" style={{ minHeight: rowHeight }}>
        <span style={{ ...half, borderRight: "1px solid var(--diff-border--)" }}>
          {renderSplitSide(left, "old")}
        </span>
        <span style={half}>{renderSplitSide(right, "new")}</span>
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
        className="absolute inset-0 overflow-y-auto overflow-x-hidden diff-tailwindcss-wrapper"
        data-theme={isDark ? "dark" : "light"}
      >
        <div
          className="diff-style-root"
          style={{
            position: "relative",
            height: virtualizer.getTotalSize(),
            width: "100%",
            fontFamily: MONO_FONT,
            fontSize,
            background: "var(--diff-plain-content--)",
          }}
        >
          {virtualizer.getVirtualItems().map((v) => (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
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

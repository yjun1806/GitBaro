import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronUp, ChevronDown, UnfoldVertical } from "lucide-react";
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

// 라이브러리가 한 번에 펼치는 줄 수. 이보다 적게 접혀 있으면 방향 버튼은 의미가 없으므로
// "모두 펼치기" 하나만 둔다. (라이브러리 상수라 바뀔 수 있지만, 틀려도 버튼 구성만 달라진다.)
const EXPAND_STEP = 40;

type Operator = "add" | "del" | undefined;
type SyntaxLineT = SyntaxLine & { template?: string };
type SplitLine = { lineNumber?: number; value?: string; diff?: DiffLine };
export type DiffRow =
  /** 접힌 구간을 알리는 헤더 행. `index`는 이 hunk를 펼칠 때 라이브러리에 넘길 라인 인덱스다. */
  | { kind: "hunk"; text: string; index: number; hiddenCount: number }
  | { kind: "line"; index: number };

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

/**
 * 본문 칸 스타일 — **가로 스크롤 대신 접기**가 이 뷰의 규칙이다.
 *
 * `pre-wrap`은 코드의 들여쓰기·연속 공백을 지키면서 폭이 모자랄 때만 접고,
 * `anywhere`는 공백 없는 긴 토큰(URL·해시·미니파이 코드)까지 칸 안에 가둔다.
 * `flex: 1` + `minWidth: 0`이 없으면 flex 자식이 내용 폭만큼 부풀어 접히지 않는다.
 *
 * 렌더 밖으로 뺀 이유는 이 조합이 깨지면 가로 스크롤이 조용히 되살아나기 때문이다 —
 * 테스트가 붙잡을 수 있는 자리에 둔다.
 */
export function contentStyleFor(rowHeight: number): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    padding: "0 6px",
    lineHeight: `${rowHeight}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };
}

function operatorOf(type: DiffLineType | undefined): Operator {
  if (type === DiffLineType.Add) return "add";
  if (type === DiffLineType.Delete) return "del";
  return undefined;
}

/** hunk 헤더가 담고 있는 것: 화면에 쓸 문구와, 그 앞에 몇 줄이 접혀 있는지. */
interface HunkInfo {
  plainText?: string;
  startHiddenIndex?: number;
  endHiddenIndex?: number;
}

function hunkRow(h: DiffHunkItem, isSplit: boolean, index: number): DiffRow {
  const info = ((isSplit ? h.splitInfo : h.unifiedInfo) ?? {}) as HunkInfo;
  const start = info.startHiddenIndex ?? 0;
  const end = info.endHiddenIndex ?? 0;
  return {
    kind: "hunk",
    text: info.plainText ?? "",
    index,
    hiddenCount: Math.max(0, end - start),
  };
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

  // 라이브러리는 파일 전체를 들고 있고 접힘은 `isHidden`으로 표현한다. 그걸 무시하면
  // 한 줄만 바뀐 파일도 전부 렌더된다 — 접힌 줄은 여기서 걸러낸다.
  for (let i = 0; i < len; i++) {
    if (isSplit) {
      const left = diffFile.getSplitLeftLine(i);
      const right = diffFile.getSplitRightLine(i);
      if (left.isHidden && right.isHidden) continue;
      const hunk = diffFile.getSplitHunkLine(i);
      if (hunk?.splitInfo) {
        rows.push(hunkRow(hunk, true, i));
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
      if (line.isHidden) continue;
      const hunk = diffFile.getUnifiedHunkLine(i);
      if (hunk?.unifiedInfo) {
        rows.push(hunkRow(hunk, false, i));
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
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  const rowHeight = Math.round(fontSize * 1.6);
  const isSplit = viewMode === "split";

  // 펼치기는 `diffFile` 내부 상태를 바꿀 뿐 새 객체를 만들지 않는다 — React가 알아채도록
  // 직접 신호를 준다. 파일이 바뀌면 새 `diffFile`이 오므로 자연히 초기화된다.
  const [expandTick, setExpandTick] = useState(0);
  // 위로 펼치면 보던 내용이 그만큼 아래로 밀린다 — 펼치기 직전에 보던 라인을 기억해 두었다가
  // 새 행 배열이 만들어진 뒤 그 자리로 되돌린다.
  const [anchorLine, setAnchorLine] = useState<number | null>(null);

  const canExpand = diffFile.getExpandEnabled();

  const handleExpand = useCallback(
    (dir: "up" | "down" | "all", index: number) => {
      if (isSplit) diffFile.onSplitHunkExpand(dir, index);
      else diffFile.onUnifiedHunkExpand(dir, index);
      setAnchorLine(index);
      setExpandTick((n) => n + 1);
    },
    [diffFile, isSplit],
  );

  const layout = useMemo(
    () => buildDiffLayout(diffFile, isSplit),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expandTick은 diffFile 내부 변경 신호
    [diffFile, isSplit, expandTick],
  );

  // 긴 줄은 가로로 스크롤하지 않고 접는다. 그래서 재야 할 폭은 줄번호 칸 하나뿐이다.
  const numColPx = useMemo(() => {
    const digits = String(layout.maxLineNo).length;
    return Math.max(2, digits) * (fontSize * CHAR_WIDTH_RATIO) + NUM_COL_PAD;
  }, [layout.maxLineNo, fontSize]);

  const rows = layout.rows;

  // 파일이 바뀌면 이전 파일의 스크롤 오프셋이 남지 않도록 맨 위로 리셋.
  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [diffFile]);

  // 줄이 접히면 행 높이가 제각각이 된다 — 추정치로 자리를 잡고 실제 높이는 재서 채운다.
  // (`measureElement`가 `data-index`로 행을 식별하므로 각 행에 그 속성이 필요하다.)
  // **행을 내용으로 식별한다.** 기본값인 배열 인덱스를 쓰면 펼치기로 행이 밀렸을 때 React가
  // 같은 요소를 재사용하고, 요소 크기가 그대로면 ResizeObserver도 다시 보고하지 않아
  // 짧은 줄의 높이가 긴 줄에 남는다(다음 행이 그 위를 덮어 그린다).
  const getItemKey = useCallback(
    (index: number) => {
      const row = rows[index];
      return row.kind === "hunk" ? `h${row.index}` : `l${row.index}`;
    },
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey,
    overscan: 12,
  });

  // 펼친 뒤 원래 보던 라인을 화면 상단으로 되돌린다. 라인 인덱스는 펼쳐도 그대로이므로
  // (행 배열에서의 위치만 밀린다) 그걸 앵커로 삼는다.
  useEffect(() => {
    if (anchorLine === null) return;
    // **먼저 측정을 버린다.** 높이 캐시는 행 인덱스 기준인데 펼치면 같은 인덱스에 다른 행이
    // 온다. 그대로 두면 짧은 줄의 높이가 긴 줄에 적용돼 다음 행이 그 위를 덮어 그린다.
    virtualizer.measure();
    const at = rows.findIndex((r) => r.kind === "line" && r.index === anchorLine);
    if (at >= 0) virtualizer.scrollToIndex(at, { align: "start" });
    setAnchorLine(null);
  }, [anchorLine, rows, virtualizer]);

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

  // 눈금자는 실제로 넘칠 때만 띄운다.
  // 뷰포트와 **콘텐츠를 함께** 관찰한다. 총 높이를 의존성에 넣어 재구독하는 방법도 있지만,
  // 행이 측정될 때마다 값이 바뀌어 스크롤 한 번에 옵저버를 수십 번 다시 만들게 된다.
  useEffect(() => {
    const el = parentRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  /**
   * 눈금자용 — 행 인덱스를 문서 전체에서의 위치(0~1)로.
   *
   * `getOffsetForIndex`를 쓰면 안 된다. 그건 아이템의 위치가 아니라 "그 아이템을 보이게
   * 하려면 얼마나 스크롤해야 하나"라서 스크롤 범위로 잘린다 — 문서 끝 근처 블록들이 전부
   * 같은 자리에 겹친다(실측으로 확인했다).
   *
   * 아직 재지 않은 행은 균일 높이로 어림한다. 화면 밖 행이 추정치인 건 가상 스크롤의
   * 본래 성질이라 피할 수 없고, 스크롤하면서 실제 값으로 대체된다.
   */
  const ratioOf = useCallback(
    (rowIndex: number) => {
      const total = virtualizer.getTotalSize();
      if (!total) return 0;
      if (rowIndex >= rows.length) return 1;
      const measured = virtualizer.measurementsCache[rowIndex];
      const start = measured ? measured.start : rowIndex * rowHeight;
      return Math.min(1, Math.max(0, start / total));
    },
    [virtualizer, rows.length, rowHeight],
  );

  const numStyle: React.CSSProperties = {
    width: numColPx,
    minWidth: numColPx,
    flexShrink: 0,
    textAlign: "right",
    padding: "0 6px",
    userSelect: "none",
    color: "var(--diff-plain-lineNumber-color--)",
    // 행이 여러 줄로 접혀도 번호는 첫 줄 높이에 놓인다(칸 배경은 flex가 알아서 늘린다).
    lineHeight: `${rowHeight}px`,
    whiteSpace: "pre",
  };

  const contentStyle = contentStyleFor(rowHeight);

  const expandBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: rowHeight,
    height: rowHeight,
    flexShrink: 0,
    cursor: "pointer",
    color: "var(--diff-hunk-content-color--)",
  };

  /**
   * 접힌 구간의 헤더. 접힌 줄이 한 번에 펼칠 수 있는 양보다 많을 때만 방향 버튼을 낸다 —
   * 40줄 이하인데 "위로/아래로"를 주면 둘 다 같은 결과라 고르는 의미가 없다.
   */
  const renderHunkRow = (row: Extract<DiffRow, { kind: "hunk" }>) => {
    const stepwise = row.hiddenCount > EXPAND_STEP;
    return (
      <div
        className="flex"
        style={{
          minHeight: rowHeight,
          background: contentBg(DiffLineType.Hunk),
          color: "var(--diff-hunk-content-color--)",
        }}
      >
        {canExpand && row.hiddenCount > 0 && (
          <span className="flex" style={{ flexShrink: 0 }}>
            {stepwise && (
              <>
                <button
                  type="button"
                  style={expandBtnStyle}
                  title={t("diff.expandUp")}
                  aria-label={t("diff.expandUp")}
                  onClick={() => handleExpand("up", row.index)}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  style={expandBtnStyle}
                  title={t("diff.expandDown")}
                  aria-label={t("diff.expandDown")}
                  onClick={() => handleExpand("down", row.index)}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              style={expandBtnStyle}
              title={t("diff.expandAll", { lines: row.hiddenCount })}
              aria-label={t("diff.expandAll", { lines: row.hiddenCount })}
              onClick={() => handleExpand("all", row.index)}
            >
              <UnfoldVertical className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
        <span style={contentStyle}>{row.text}</span>
      </div>
    );
  };

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
    if (row.kind === "hunk") return renderHunkRow(row);
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
          ref={contentRef}
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
          ratioOf={ratioOf}
          onJump={(i) => virtualizer.scrollToIndex(i, { align: "center" })}
        />
      )}
    </div>
  );
}

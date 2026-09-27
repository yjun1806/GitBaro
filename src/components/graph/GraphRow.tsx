import { memo, type MouseEvent, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Bot } from "lucide-react";
import { RefBadge } from "@/components/history/CommitItem";
import { CiStateIcon, type CiSummary } from "@/components/history/CommitDetail";
import { FocusFlash } from "@/components/ui/FocusFlash";
import { RefLabel as RefLabelMark, StatusChip, LineDelta } from "@/components/ui/marks";
import { cn, formatRelativeTime, formatRelativeTimeShort, splitConventionalPrefix } from "@/lib/utils";
import { leadingTicketKey } from "@/lib/ticket-keys";
import type { GraphEdge, GraphRowLayout } from "@/lib/graph-lanes";
import type { CommitInfo, CommitStats, RefLabel } from "@/types";
import { GRAPH_ROW_HEIGHT, laneX, type WipTarget } from "./graph-model";
import { chainDotStyle, chainEdgeStyle } from "./graph-paint";
import { changeBarWidths } from "./change-cell";

const H = GRAPH_ROW_HEIGHT;
const MID = H / 2;
const DOT_R = 4.5;
/** 고른 커밋의 점 반지름(강조 중일 때, 시안: 줄기 강조). */
const SELECTED_DOT_R = 5;
const WIP_R = 5;
/** 영역 머리 행의 높이(디자인 시스템 카드 머리와 같은 32px). 커밋 행(30px)보다 조금 크다. */
export const REGION_HEADER_HEIGHT = 32;

/**
 * 설명 / 변경 / CI / 작성자 / 시각 칸(디자인 시스템 3.15, 시안 `scope-unify.html`). 컨테이너
 * (`@container/graph`, 그래프 카드 전체)가 좁아지면 칸이 단계별로 줄어든다 — SHA 칸은 없다(D45).
 *
 * - 820px 이하: 작성자 칸을 줄이고(112→36px) 이름을 뺀다(아바타만 남는다).
 * - 680px 이하: 변경 칸을 줄이고(128→64px) 파일 수·크기 막대를 빼고 `+ −` 숫자만 남긴다.
 * - 560px 이하: 변경 칸을 뺀다(0px, 내용도 감춘다).
 * - 400px 이하(D47 2단계의 좁은 커밋 목록): 설명과 시각 두 칸만 남는다. CI·작성자 칸, 브랜치 이름표,
 *   WIP 행의 브랜치·워크트리 표시와 버튼을 감추고, 설명은 제목만 말줄임으로 둔다.
 *
 * CI(16px)·시각(64px)·설명(`1fr`)은 400px까지 그대로다.
 */
export const GRAPH_COLUMNS = cn(
  "grid items-center gap-3",
  "grid-cols-[minmax(0,1fr)_128px_16px_112px_64px]",
  "@max-[820px]/graph:grid-cols-[minmax(0,1fr)_128px_16px_36px_64px]",
  "@max-[680px]/graph:grid-cols-[minmax(0,1fr)_64px_16px_36px_64px]",
  "@max-[560px]/graph:grid-cols-[minmax(0,1fr)_0px_16px_36px_64px]",
  "@max-[400px]/graph:grid-cols-[minmax(0,1fr)_auto] @max-[400px]/graph:gap-2",
);

/** 좁은 커밋 목록(400px 이하)에서 감추는 칸·표시. 감춘 칸은 그리드에서 빠져 설명·시각 두 칸만 남는다. */
export const NARROW_HIDDEN_CLASS = "@max-[400px]/graph:hidden";

/** 「변경」 칸을 좁아짐 둘째 단계에서 줄이는 표시(파일 수·크기 막대를 감춘다, `+ −` 숫자만 남긴다). */
const CHANGE_DETAIL_CLASS = "@max-[680px]/graph:hidden";
/** 「변경」 칸을 좁아짐 셋째 단계에서 통째로 감추는 표시(그리드 칸은 이미 0px, 내용도 겹치지 않게 감춘다). */
const CHANGE_CELL_HIDDEN_CLASS = "@max-[560px]/graph:hidden";
/** 「작성자」 칸의 이름을 좁아짐 첫 단계에서 감추는 표시(아바타만 남는다). */
const AUTHOR_NAME_HIDDEN_CLASS = "@max-[820px]/graph:hidden";

/** 커밋 줄 「변경」 칸(3.15). 병합 커밋은 「병합」 글자 하나, 그 외는 파일 수·크기 막대·`+N −N`. */
function ChangeCell({ stats }: { stats: CommitStats | undefined }) {
  const { t } = useTranslation();
  if (!stats) return <span aria-hidden="true" className={NARROW_HIDDEN_CLASS} />;
  if (stats.merge) {
    return (
      <span className={cn("truncate text-[11.5px] text-muted-foreground", CHANGE_CELL_HIDDEN_CLASS, NARROW_HIDDEN_CLASS)}>
        {t("graph.mergeCommit")}
      </span>
    );
  }
  const { filesChanged, additions, deletions } = stats;
  // 바뀐 파일이 없는 커밋(빈 커밋)은 칸을 비운다 — 「파일 0 · +0 −0」은 읽을 거리가 없다.
  if (filesChanged === null || filesChanged === 0) return <span aria-hidden="true" className={NARROW_HIDDEN_CLASS} />;
  const hasLines = additions !== null && deletions !== null;
  const bar = hasLines ? changeBarWidths(additions, deletions) : null;
  return (
    <span className={cn("flex items-center gap-1.5 min-w-0 whitespace-nowrap", CHANGE_CELL_HIDDEN_CLASS, NARROW_HIDDEN_CLASS)}>
      <span className={cn("shrink-0 text-[11.5px] text-muted-foreground", CHANGE_DETAIL_CLASS)}>
        {t("graph.fileCount", { count: filesChanged })}
      </span>
      {bar && (
        <span
          className={cn("shrink-0 flex h-1.5 rounded-[3px] overflow-hidden bg-(--chip)", CHANGE_DETAIL_CLASS)}
          style={{ width: bar.barWidth }}
        >
          <i className="block h-full bg-success" style={{ width: bar.addWidth }} />
          <i className="block h-full bg-danger" style={{ width: bar.delWidth }} />
        </span>
      )}
      {/* 0인 쪽은 뺀다(+7 −0 → +7). 둘 다 0이면(이름만 바뀜·바이너리) 숫자를 두지 않는다. */}
      {hasLines && <LineDelta additions={additions} deletions={deletions} className="text-[11.5px]" />}
    </span>
  );
}

/** 커밋 줄 「CI」 칸(3.15). 실행 기록이 있을 때만 아이콘 하나(`CommitDetail`의 접힌 요약 줄과 같은 부품). */
function CiCell({ ci }: { ci: CiSummary | null | undefined }) {
  if (!ci) return <span aria-hidden="true" className={NARROW_HIDDEN_CLASS} />;
  return (
    <span className={cn("flex items-center justify-center", NARROW_HIDDEN_CLASS)}>
      <CiStateIcon ci={ci} />
    </span>
  );
}

/** 한 선의 SVG 경로. 레인이 바뀌는 선은 행 가운데 높이를 지나는 곡선으로 그린다. */
export function edgePath(edge: GraphEdge, dotLane: number): string {
  const [x1, y1, x2, y2] =
    edge.kind === "pass"
      ? [laneX(edge.fromLane), 0, laneX(edge.toLane), H]
      : edge.kind === "in"
        ? [laneX(edge.fromLane), 0, laneX(dotLane), MID]
        : [laneX(dotLane), MID, laneX(edge.toLane), H];
  if (x1 === x2) return `M${x1} ${y1} V${y2}`;
  const ym = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}`;
}

/**
 * 커밋 점이 원격에 있는지. 점 모양은 모두 같다(채운 점, 레인 색) — `unpushed`/`pushed`는
 * 행 바탕(`UNPUSHED_ROW_CLASS`)과 영역 머리(`UnpushedHeaderRow` 등)를 가르는 데만 쓴다.
 */
export type CommitDot = "plain" | "unpushed" | "pushed";

/**
 * 원격에 없는 커밋 행의 바탕. 위 WIP 행부터 「origin에 있음」 머리 바로 위까지가 한 덩어리
 * (아직 push 안 한 작업)로 읽힌다. 고른 행·강조 행·hover 바탕이 이보다 앞선다.
 */
export const UNPUSHED_ROW_CLASS = "bg-(--unpushed-tint)";

interface GraphCellProps {
  layout: GraphRowLayout;
  width: number;
  colorOf: (chain: number) => string;
  /** 위 WIP 행에서 내려오는 점선을 이 커밋 점까지 잇는다(지금 연 워크트리의 HEAD 행). */
  wipAbove: boolean;
  dot: CommitDot;
  /** 줄기에 마우스를 올리면 보일 이름(회색 줄기: 브랜치 이름 또는 「merge됨」). 없으면 undefined. */
  laneTitle?: (chain: number) => string | undefined;
  /** 지금 강조 중인 줄기(고른 커밋의 줄기, 없으면 마우스 올린 줄기). 없으면 강조 없음(모두 그대로). */
  highlightChain?: number | null;
  /** 이 행이 고른 커밋인지. 강조 중인 줄기 위에 있으면 점을 키우고 테를 두른다. */
  isSelected?: boolean;
  /**
   * 좁은 커밋 목록(D47 2단계): 레인 점 하나 폭만 쓴다. 가지·병합 선 대신 옅은 세로선 하나에 그 커밋의
   * 줄기 색 점을 둔다 — 제목 폭을 넓히려는 것이다. 가지 모양은 「그래프 펼치기」로 본다.
   */
  compact?: boolean;
}

/** 한 행의 그래프 칸. 선이 행 안에서 완결되므로 행마다 따로 그린다(`graph-lanes`). */
function GraphCell({
  layout,
  width,
  colorOf,
  wipAbove,
  dot,
  laneTitle,
  highlightChain = null,
  isSelected = false,
  compact = false,
}: GraphCellProps) {
  if (compact) return <CompactGraphCell layout={layout} colorOf={colorOf} dot={dot} isSelected={isSelected} />;
  const x = laneX(layout.lane);
  const color = colorOf(layout.chain);
  const dotTitle = laneTitle?.(layout.chain);
  const dotStyle = chainDotStyle(layout.chain, highlightChain, isSelected);
  const dotRadius = dotStyle.ring ? SELECTED_DOT_R : DOT_R;
  return (
    <svg
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      aria-hidden="true"
      className="shrink-0 overflow-hidden"
      data-lane={layout.lane}
    >
      {layout.edges.map((edge, i) => {
        const title = laneTitle?.(edge.chain);
        const edgeStyle = chainEdgeStyle(edge.chain, highlightChain);
        return (
          <path
            key={i}
            d={edgePath(edge, layout.lane)}
            stroke={colorOf(edge.chain)}
            strokeWidth={edgeStyle.strokeWidth}
            fill="none"
            strokeOpacity={edgeStyle.strokeOpacity}
          >
            {title && <title>{title}</title>}
          </path>
        );
      })}
      {wipAbove && (
        <path
          d={`M${x} 0 V${MID}`}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="2.5 2"
          fill="none"
          opacity={dotStyle.opacity}
        />
      )}
      {dotStyle.ring && (
        <circle cx={x} cy={MID} r={SELECTED_DOT_R + 2.5} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.5} />
      )}
      <circle cx={x} cy={MID} r={dotRadius} data-dot={dot} fill={color} opacity={dotStyle.opacity}>
        {dotTitle && <title>{dotTitle}</title>}
      </circle>
    </svg>
  );
}

/** 좁은 커밋 목록의 그래프 칸: 레인 하나 폭, 옅은 세로선 + 줄기 색 점. */
function CompactGraphCell({
  layout,
  colorOf,
  dot,
  isSelected,
}: Pick<GraphCellProps, "layout" | "colorOf" | "dot" | "isSelected">) {
  const width = COMPACT_GRAPH_WIDTH;
  const x = laneX(0);
  return (
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true" className="shrink-0" data-lane={layout.lane}>
      <path d={`M${x} 0 V${H}`} stroke="var(--line2)" strokeWidth={2} fill="none" />
      <circle cx={x} cy={MID} r={isSelected ? SELECTED_DOT_R : DOT_R} data-dot={dot} fill={colorOf(layout.chain)} />
    </svg>
  );
}

/** 좁은 커밋 목록의 그래프 칸 폭(px): 레인 하나. */
export const COMPACT_GRAPH_WIDTH = laneX(0) * 2;

interface GraphRowProps {
  compact?: boolean;
  commit: CommitInfo;
  layout: GraphRowLayout;
  graphWidth: number;
  colorOf: (chain: number) => string;
  remoteTags: Set<string> | null;
  avatarUrl?: string;
  isSelected: boolean;
  isHighlighted: boolean;
  wipAbove: boolean;
  /** 커밋 점 모양(원격에 있는지). 기본은 채운 점. */
  dot?: CommitDot;
  laneTitle?: (chain: number) => string | undefined;
  /** 브랜치 이름표 색(그 브랜치를 체크아웃한 워크트리의 색). 없으면 회색 이름표. */
  refColor?: (label: RefLabel) => string | null;
  /** 설명 칸 맨 앞(ref 라벨 앞)에 둘 것. 저장소별 레인 모드의 저장소 표시에 쓴다. */
  leading?: ReactNode;
  /** 「변경」 칸(3.15). 아직 모르면(조회 전) 비워 둔다 — 줄 높이·정렬은 그대로다. */
  stats?: CommitStats;
  /** 「CI」 칸(3.15). 이 커밋의 실행 기록이 없으면(조회 전 포함) null. */
  ci?: CiSummary | null;
  /**
   * 따라가는 중에 새로 나타난 커밋(`useNewCommits`). 행을 한 번 비춘다(`FocusFlash`). 행이 다시 마운트되지
   * 않는 한 다시 그려도 다시 비추지 않는다.
   */
  flash?: boolean;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** 브랜치·태그 이름표 우클릭. 주면 행의 메뉴 대신 이름표 메뉴를 연다. */
  onRefContextMenu?: (label: RefLabel, e: MouseEvent) => void;
  /** 지금 강조 중인 줄기(고른 커밋의 줄기, 없으면 마우스 올린 줄기). 없으면 강조 없음. */
  highlightChain?: number | null;
  /** 강조 중인 줄기의 브랜치 이름. 미리보기 중이면 마우스 올린 행에, 아니면 고른 행에 붙인다. */
  chainLabel?: string;
  /** 이 행이 이름 칩을 붙일 행인지(고른 행, 또는 미리보기 중이면 마우스 올린 행). */
  chainLabelHere?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 커밋 그래프의 커밋 행. 그래프 칸 + [설명(ref 라벨, 이슈 키, 제목) / 변경 / CI / 작성자 / 시각](3.15).
 * 에이전트가 쓴 커밋(트레일러로 추정)은 작성자 칸에 흐린 표시와 「추정」 툴팁을 붙인다.
 */
export const GraphRow = memo(function GraphRow({
  commit,
  layout,
  graphWidth,
  colorOf,
  remoteTags,
  avatarUrl,
  isSelected,
  isHighlighted,
  wipAbove,
  dot = "plain",
  laneTitle,
  refColor,
  leading,
  stats,
  ci,
  flash = false,
  highlightChain = null,
  chainLabel,
  chainLabelHere = false,
  compact = false,
  onClick,
  onContextMenu,
  onRefContextMenu,
  onMouseEnter,
  onMouseLeave,
  ref,
}: GraphRowProps) {
  const { t } = useTranslation();
  const resolvedAvatar = avatarUrl ?? commit.author.avatarUrl;
  const authorName = commit.author.name || commit.author.email;
  const agentName = commit.isAgentAuthored ? commit.coAuthors[0]?.name : undefined;
  // 제목 맨 앞의 이슈 키만 배지로 뗀다(3.15) — 제목 어디든의 키를 찾는 `ticketKeysOf`와 다르다.
  const ticket = leadingTicketKey(commit.summary);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-current={isSelected ? "true" : undefined}
      data-commit-id={commit.id}
      // SHA는 칸에 없다(D45) — hover로만 닿는다. 아래 칸의 「복사」, 우클릭 「SHA 복사」가 나머지 두 길이다.
      title={`${commit.id} · ${commit.summary}`}
      className={cn(
        "relative isolate flex items-center w-full text-left border-b border-(--line) select-none transition-colors",
        isSelected
          ? "bg-(--acc-sel)"
          : isHighlighted
            ? "bg-accent ring-1 ring-inset ring-primary/30"
            : cn("hover:bg-accent", dot === "unpushed" && UNPUSHED_ROW_CLASS),
      )}
      style={{ height: H }}
    >
      {flash && <FocusFlash testId="commit-flash" />}
      <GraphCell
        layout={layout}
        width={graphWidth}
        colorOf={colorOf}
        wipAbove={wipAbove}
        dot={dot}
        laneTitle={laneTitle}
        highlightChain={highlightChain}
        isSelected={isSelected}
        compact={compact}
      />
      <span className={cn(GRAPH_COLUMNS, "flex-1 min-w-0 pl-2 pr-3 text-[12.5px]")}>
        <span className="flex items-center gap-2 min-w-0">
          {leading && <span className={cn("contents", NARROW_HIDDEN_CLASS)}>{leading}</span>}
          {commit.refs.map((label) => (
            <span
              key={`${label.kind}:${label.name}`}
              className={cn("contents", NARROW_HIDDEN_CLASS)}
              data-ref-label={label.name}
              onContextMenu={
                onRefContextMenu
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRefContextMenu(label, e);
                    }
                  : undefined
              }
            >
              {/* 이름표를 제목보다 먼저 지킨다: 줄어들지 않고 다 보이되, 설명 칸의 45%(최대 320px)를 넘으면
                  그때만 말줄임. 제목은 남은 폭을 쓴다(3.15). */}
              <RefBadge
                label={label}
                remoteTags={remoteTags}
                laneColor={refColor?.(label)}
                className="shrink-0 max-w-[min(320px,45%)]!"
              />
            </span>
          ))}
          {ticket && (
            <span className="shrink-0 @max-[400px]/graph:hidden inline-flex items-center h-[18px] px-1.5 rounded-(--radius-chip) bg-(--chip) text-(--fg2) font-mono text-[10.5px] font-semibold">
              {ticket.key}
            </span>
          )}
          {/* 좁은 목록: Conventional Commits 머리는 타입만 흐리게 두고 나머지를 제목으로(전체는 줄 title). */}
          {compact ? (
            <NarrowTitle summary={commit.summary} bold={isSelected} />
          ) : (
            <span className={cn("truncate text-foreground", isSelected ? "font-bold" : "font-medium")}>
              {ticket ? ticket.rest : commit.summary}
            </span>
          )}
          {chainLabelHere && !compact && highlightChain !== null && chainLabel && (
            <span
              className="shrink-0 px-1.5 py-px rounded-(--radius-chip) text-[10.5px] font-semibold"
              style={{ color: colorOf(highlightChain) }}
            >
              {chainLabel}
            </span>
          )}
        </span>
        <ChangeCell stats={stats} />
        <CiCell ci={ci} />
        <span className={cn("flex items-center gap-1.5 min-w-0 text-[12.5px] text-(--fg2)", NARROW_HIDDEN_CLASS)}>
          {resolvedAvatar ? (
            <img src={resolvedAvatar} alt="" className="w-[18px] h-[18px] rounded-full shrink-0 object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center bg-(--chip) text-[9px] font-extrabold text-(--fg2)"
            >
              {(authorName || "?")[0].toUpperCase()}
            </span>
          )}
          <span className={cn("truncate", AUTHOR_NAME_HIDDEN_CLASS)}>{authorName}</span>
          {commit.isAgentAuthored && (
            <span
              className="flex items-center gap-0.5 shrink-0 opacity-50"
              title={t("graph.agentGuess", { name: agentName ?? t("graph.agent") })}
              aria-label={t("graph.agentGuess", { name: agentName ?? t("graph.agent") })}
            >
              <Bot className="w-3 h-3" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {compact ? formatRelativeTimeShort(commit.timestamp) : formatRelativeTime(commit.timestamp)}
        </span>
      </span>
    </button>
  );
});

/** 좁은 커밋 목록의 제목: Conventional Commits 머리는 타입만 흐리게 둔다. */
function NarrowTitle({ summary, bold }: { summary: string; bold: boolean }) {
  const conventional = splitConventionalPrefix(summary);
  return (
    <span className={cn("truncate text-foreground", bold ? "font-bold" : "font-medium")}>
      {conventional ? (
        <>
          <span className="font-normal text-muted-foreground">{conventional.type} </span>
          {conventional.rest}
        </>
      ) : (
        summary
      )}
    </span>
  );
}

interface GraphWipRowProps {
  /** 좁은 커밋 목록(D47 2단계): 「커밋 안 한 변경 · 9」와 짧은 시각. */
  compact?: boolean;
  /** 설명 칸 앞부분(스크린 리더용 이름에도 쓴다). 파일 수는 이 컴포넌트가 붙인다. */
  wipLabel: string;
  /** 변경이 쌓인 브랜치와 워크트리. 행마다 늘 보여 준다(여러 워크트리가 있어도 헷갈리지 않게). */
  target: WipTarget;
  /** 스크린 리더용 이름 맨 앞에 붙일 것(워크스페이스 그래프의 저장소 이름). */
  ariaContext?: string;
  count: number | null;
  /** 커밋하지 않은 파일이 마지막으로 바뀐 시각(epoch ms). */
  changedAt: number | null;
  color: string;
  graphWidth: number;
  selected: boolean;
  /** 아래 HEAD 커밋 행까지 점선을 잇는다. */
  connectDown: boolean;
  /**
   * 저장소별 레인 모드: 원을 이 레인에 두고, 지나가는 선과 아래로 잇는 선을 그린다.
   * 없으면 첫 레인에 원만 그린다(단일 저장소 그래프).
   */
  layout?: GraphRowLayout;
  colorOf?: (chain: number) => string;
  /** 설명 칸 맨 앞에 둘 것(저장소 표시). */
  leading?: ReactNode;
  /** 파일 수 뒤에 둘 것(따라가기의 「따라가는 중」 알약, 시안 D4). */
  trailing?: ReactNode;
  /** 행 오른쪽 끝의 버튼(「작업 중인 변경 N」). 행 버튼 밖에 둔다(버튼 안에 버튼을 넣지 않는다). */
  action?: ReactNode;
  /**
   * 에이전트가 지금(1분 안) 파일을 고치는 중인가(`followRowParts`가 이미 계산해 넘긴다). 켜지면
   * 점선 원이 기어가고, `changedAt`이 앞으로 갈 때마다 테가 한 번 퍼진다(D4 후속, 2026-09-26).
   */
  live?: boolean;
  onSelect: () => void;
  /** 행 우클릭(`useWipRowMenu`). */
  onContextMenu?: (e: MouseEvent) => void;
}

/**
 * 워크트리 하나의 커밋하지 않은 변경(WIP) 행. 그래프 칸에는 점선 원을 그린다.
 * 고르면 아래 칸에서 그 워크트리를 따라간다(D4, `FollowPanel`).
 */
export function GraphWipRow({
  wipLabel,
  target,
  ariaContext,
  count,
  changedAt,
  color,
  graphWidth,
  selected,
  connectDown,
  layout,
  colorOf,
  leading,
  trailing,
  action,
  live = false,
  compact = false,
  onSelect,
  onContextMenu,
}: GraphWipRowProps) {
  const { t } = useTranslation();
  const x = laneX(layout?.lane ?? 0);
  const active = (count ?? 0) > 0;
  // 「에이전트가 지금 쓰는 중」: changedAt이 최근(부모의 60초 판정)이고 파일이 남아 있을 때만.
  // 커밋 직후처럼 changedAt은 최근인데 파일이 0이 된 순간에는 기어가지 않는다.
  const editing = live && active;
  const branchText = wipBranchText(t, target);
  const worktreeText = target.worktree ?? t("graph.wipMainWorktree");
  const countText = count === null ? "…" : t("graph.fileCount", { count });
  return (
    <div
      className={cn(
        "group/wip flex items-center w-full shrink-0 border-b border-(--line) transition-colors",
        selected ? "bg-(--acc-sel)" : "hover:bg-accent",
      )}
      style={{ height: H }}
      data-testid="wip-row"
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(e);
            }
          : undefined
      }
    >
    <button
      type="button"
      aria-pressed={selected}
      aria-label={[ariaContext, wipLabel, branchText, worktreeText, countText].filter(Boolean).join(" · ")}
      onClick={onSelect}
      className="flex items-center flex-1 min-w-0 h-full text-left"
    >
      <svg width={graphWidth} height={H} viewBox={`0 0 ${graphWidth} ${H}`} aria-hidden="true" className="shrink-0">
        {layout?.edges.map((edge, i) => (
          <path
            key={i}
            d={edgePath(edge, layout.lane)}
            stroke={colorOf ? colorOf(edge.chain) : color}
            strokeWidth={2}
            strokeOpacity={0.9}
            strokeDasharray={edge.kind === "out" && edge.fromLane === layout.lane ? "2.5 2" : undefined}
            fill="none"
          />
        ))}
        {connectDown && (
          <path d={`M${x} ${MID + WIP_R} V${H}`} stroke={color} strokeWidth={2} strokeDasharray="2.5 2" fill="none" />
        )}
        <circle
          cx={x}
          cy={MID}
          r={WIP_R}
          fill="var(--card)"
          stroke={color}
          strokeOpacity={active ? 1 : 0.5}
          strokeWidth={2}
          strokeDasharray="2.5 2"
          data-testid="wip-ring"
          className={cn("transition-[stroke-opacity] duration-(--motion-base)", editing && "animate-wip-crawl")}
        />
        {/* 동작 줄이기 전용 정지 테: 기어가기·테 퍼짐 대신 조용한 3px 테 하나로 「지금 쓰는 중」을 말한다. */}
        {editing && (
          <circle
            cx={x}
            cy={MID}
            r={WIP_R + 3}
            fill="none"
            stroke="var(--live-soft)"
            strokeWidth={3}
            aria-hidden="true"
            data-testid="wip-halo"
            className="opacity-(--wip-halo-opacity)"
          />
        )}
        {/* changedAt이 앞으로 갈 때마다 다시 마운트해 한 번 퍼진다(사이드바 점의 pulseKey와 같은 어휘). */}
        {editing && (
          <circle
            key={changedAt}
            cx={x}
            cy={MID}
            r={WIP_R}
            fill="none"
            stroke="var(--live-soft)"
            strokeWidth={2}
            aria-hidden="true"
            data-testid="wip-pulse-ring"
            className="[transform-box:fill-box] origin-center animate-wip-ring"
          />
        )}
      </svg>
      <span className={cn(GRAPH_COLUMNS, "flex-1 min-w-0 pl-2 pr-3 text-[12.5px]")}>
        {/* 설명이 변경·CI·작성자 칸까지 넓게 쓴다(커밋 안 한 변경에는 그 칸들이 없다). 시각 칸만 맞춘다. */}
        <span className="col-span-4 @max-[400px]/graph:col-span-1 flex items-center gap-2 min-w-0">
          {leading && <span className={cn("contents", NARROW_HIDDEN_CLASS)}>{leading}</span>}
          {/* 좁으면 말줄임 대신 더 짧은 말로 바꾼다. */}
          <span className="italic text-(--fg2) shrink-0 whitespace-nowrap">{compact ? t("shell.uncommittedShort") : wipLabel}</span>
          <span className={cn("contents", NARROW_HIDDEN_CLASS)}>
          {/* 이 변경이 쌓인 브랜치(그 브랜치 최신 커밋 위)와 워크트리. 브랜치는 늘 브랜치 아이콘이고,
              체크아웃한 워크트리가 있으면 그 레인 색으로 채운다 — 워크트리 이름표(폴더 아이콘)와
              헷갈리지 않게 종류를 지킨다. */}
          <RefLabelMark
            name={branchText}
            kind="local"
            laneColor={target.branch !== null ? color : null}
            className="max-w-[320px]"
          />
          {target.worktree !== null ? (
            <RefLabelMark
              name={target.worktree}
              kind="worktree"
              laneColor={color}
              title={t("graph.worktree")}
              className="max-w-[240px]"
            />
          ) : (
            <span className="shrink-0 text-[11.5px] text-muted-foreground">{worktreeText}</span>
          )}
          </span>
          {/* 좁은 목록: 「커밋 안 한 변경 · 9」. 수는 이 행 한 곳에만 있다(One owner per number). */}
          <span className="text-[11.5px] text-muted-foreground shrink-0">
            {compact ? (count !== null ? `· ${count}` : null) : countText}
          </span>
          <span className={cn("contents", NARROW_HIDDEN_CLASS)}>{trailing}</span>
        </span>
        {/* 시각은 한 번만: 방금 바뀐 중이면 설명 끝의 주황 「N초 전 바뀜」이 말하고, 이 칸은 비운다.
            좁은 목록은 그 주황 안내를 감추므로 이 칸이 짧은 시각을 맡는다. */}
        <span className="truncate text-[11.5px] text-muted-foreground">
          {changedAt !== null && (count ?? 0) > 0 && (compact || !trailing)
            ? compact
              ? formatRelativeTimeShort(changedAt / 1000)
              : t("graph.modifiedAgo", { time: formatRelativeTime(changedAt / 1000) })
            : null}
        </span>
      </span>
    </button>
    {action && <span className={cn("shrink-0 pr-3 pl-1 flex items-center gap-1.5", NARROW_HIDDEN_CLASS)}>{action}</span>}
    </div>
  );
}

export interface FollowRowButtonProps {
  /** 지금 이 워크트리를 따라가는 중인가. `null`이면 따라가지 않는다(멈춤 상태는 이 버튼에 없다). */
  mode: "following" | null;
  /** 에이전트가 지금(대략 1분 안) 파일을 고치는 중인가. */
  live: boolean;
  onClick: () => void;
}

/**
 * WIP 행 오른쪽의 따라가기 버튼(늘 보인다, 개선안 D4). 행을 눌러도 같은 동작(따라가기 시작)이
 * 일어나지만, 이 버튼이 그 동작을 눈에 보이는 이름표로 드러낸다. 행 버튼 밖에 둔다(버튼 안에
 * 버튼을 두지 않는다). 모양은 디자인 시스템의 칩 채움 보조 버튼(3.1 secondary)이고, 따라가는
 * 중에는 같은 자리에서 색만 바뀌어 알약 두 개가 겹쳐 보이지 않는다.
 */
export function FollowRowButton({ mode, live, onClick }: FollowRowButtonProps) {
  const { t } = useTranslation();
  const following = mode === "following";
  return (
    <button
      type="button"
      data-follow-button=""
      aria-pressed={following}
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-(--radius-chip) text-[11.5px] font-semibold transition-colors",
        following
          ? "bg-(--live-soft) text-(--live)"
          : "bg-(--chip) text-(--fg2) hover:bg-accent hover:text-foreground",
      )}
    >
      {(following || live) && (
        <span
          className={cn("w-1.5 h-1.5 rounded-full bg-(--live)", following && "animate-live-breathe")}
          aria-hidden="true"
        />
      )}
      {following ? t("graph.followingStop") : t("graph.follow")}
    </button>
  );
}

/** 이 시간 안에 바뀐 워크트리는 「에이전트가 지금 고치는 중」으로 본다(D4). */
const LIVE_EDIT_MS = 60_000;

/**
 * WIP 행의 따라가기 표시 두 조각(D4)을 한 번에 계산한다: 에이전트가 지금(1분 안) 고치는
 * 중이고 아직 따라가지 않으면 보일 안내(`trailing`), 늘 보이는 오른쪽 끝 버튼(`followButton`).
 * `t`·`now`는 부르는 화면이 이미 가진 값을 넘긴다(행마다 새로 훅을 만들지 않는다).
 * `count`가 0이면(파일이 없음) `trailing`을 보이지 않는다 — 아래 「N분 전 수정」과 같은 규칙이다(#7).
 */
export function followRowParts(
  t: TFunction,
  now: number,
  changedAt: number | null,
  count: number | null,
  following: boolean,
  onToggle: () => void,
): { trailing: ReactNode; followButton: ReactNode; live: boolean } {
  const live = changedAt !== null && now - changedAt < LIVE_EDIT_MS;
  const trailing =
    live && !following && (count ?? 0) > 0 ? (
      <span className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-semibold text-(--live)">
        <span className="w-1.5 h-1.5 rounded-full bg-(--live)" aria-hidden="true" />
        {t("graph.changedAgo", {
          time: t("live.secondsAgo", { count: Math.max(0, Math.floor((now - (changedAt as number)) / 1000)) }),
        })}
      </span>
    ) : undefined;
  return {
    trailing,
    // 따라가지 않을 때는 버튼을 두지 않는다 — 줄을 누르는 것이 곧 따라가기다(같은 동작 둘을 나란히 두지 않는다).
    // 따라가는 중에는 그 상태를 알리고 멈추는 자리로 남긴다.
    followButton: following ? <FollowRowButton mode="following" live={live} onClick={onToggle} /> : null,
    live,
  };
}

/** WIP 행의 브랜치 표시: 「feat/x 브랜치」, 브랜치가 없으면 「브랜치 없음 (HEAD 1a2b3c4)」. */
export function wipBranchText(t: TFunction, target: WipTarget): string {
  if (target.branch !== null) return t("graph.wipBranch", { branch: target.branch });
  return target.shortSha
    ? t("graph.wipDetached", { sha: target.shortSha })
    : t("graph.wipDetachedUnknown");
}

interface RegionHeaderThrough {
  graphWidth: number;
  /** 이 행을 지나 아래로 이어지는 선(바로 위 행의 아래 가장자리 선, WIP 행 포함). */
  through: readonly { lane: number; chain: number }[];
  colorOf: (chain: number) => string;
}

interface RegionHeaderRowProps extends RegionHeaderThrough {
  name: string;
  desc?: string;
  /** 옅은 바탕(「올리지 않음」 머리만, 시안 결정: 「옅게」 단계). */
  tinted?: boolean;
  testId: string;
}

/**
 * 영역 머리 행(D48: 짧은 상태 말). 영역 아래 끝의 구분 줄 대신 영역 **위** 머리에 짧은 상태
 * 문장을 두어, 상태를 먼저 읽고 그 아래 커밋을 보게 한다. 그래프 선은 끊기지 않고 지나간다.
 * 개수는 넣지 않는다(사이드바 ↑N·Push 버튼이 맡는다).
 */
function RegionHeaderRow({ name, desc, tinted = false, graphWidth, through, colorOf, testId }: RegionHeaderRowProps) {
  const height = REGION_HEADER_HEIGHT;
  return (
    <div
      role="separator"
      aria-label={desc ? `${name} · ${desc}` : name}
      className={cn("flex items-center border-b border-(--line)", tinted && UNPUSHED_ROW_CLASS)}
      style={{ height }}
      data-testid={testId}
    >
      <svg width={graphWidth} height={height} viewBox={`0 0 ${graphWidth} ${height}`} aria-hidden="true" className="shrink-0">
        {through.map(({ lane, chain }) => (
          <path
            key={`${lane}:${chain}`}
            d={`M${laneX(lane)} 0 V${height}`}
            stroke={colorOf(chain)}
            strokeWidth={2}
            strokeOpacity={0.9}
            fill="none"
          />
        ))}
      </svg>
      <span className="flex items-center gap-2 flex-1 min-w-0 pl-2 pr-3">
        <StatusChip tone="neutral">{name}</StatusChip>
        {desc && <span className="flex-1 min-w-0 truncate text-[11.5px] text-muted-foreground">{desc}</span>}
      </span>
    </div>
  );
}

/**
 * 「지금」 영역 머리(D48). 커밋하지 않은 변경(WIP 행) 바로 위, 그래프 맨 위에 둔다. 보일 WIP
 * 행이 하나도 없거나(모든 워크트리가 깨끗함) 체크아웃하지 않은 브랜치를 보는 중이면 그리지 않는다.
 */
export function NowHeaderRow(props: RegionHeaderThrough) {
  const { t } = useTranslation();
  return (
    <RegionHeaderRow {...props} name={t("graph.nowHeader")} desc={t("graph.nowHeaderDesc")} testId="now-header-row" />
  );
}

export interface UnpushedHeaderRowProps extends RegionHeaderThrough {
  /** 이 레인이 커밋을 올리는 원격 이름(`origin`). 원격이 여럿이면 「원격」. */
  remote: string;
}

/**
 * 「올리지 않은 작업」 영역 머리. WIP 행 바로 아래, 이 저장소 자신의 첫 미반영 커밋 위에 둔다
 * (`remoteBoundaryIndex`가 원격 경계를 그릴 수 있을 때만 — 못 그리면 이 머리도 없다. 행 바탕
 * 틴트만으로 표시한다).
 */
export function UnpushedHeaderRow({ remote, ...rest }: UnpushedHeaderRowProps) {
  const { t } = useTranslation();
  return (
    <RegionHeaderRow
      {...rest}
      tinted
      name={t("graph.unpushedHeader")}
      desc={t("graph.unpushedHeaderDesc", { remote })}
      testId="unpushed-header-row"
    />
  );
}

export interface RemoteHeaderRowProps extends RegionHeaderThrough {
  /** 원격 이름(`origin`). 원격이 여럿이면 「원격」. */
  remote: string;
  /** 체크아웃한 브랜치. 모르면 undefined. */
  branch?: string;
}

/**
 * 「origin에 있음」 영역 머리. 원격에 있는 첫 커밋 바로 위에 두며, 이 행 위(옅은 바탕)가 아직
 * push 안 한 커밋이고 여기부터 아래는 모두 원격에 있다(`remoteBoundaryIndex`).
 */
export function RemoteHeaderRow({ remote, branch, ...rest }: RemoteHeaderRowProps) {
  const { t } = useTranslation();
  return (
    <RegionHeaderRow {...rest} name={t("graph.remoteHeader", { remote })} desc={branch} testId="remote-header-row" />
  );
}

export interface BaseHeaderRowProps extends RegionHeaderThrough {
  /** 기본 브랜치 이름(`main`). */
  branch: string;
  /** 갈라진 지점 커밋의 시각(epoch s). */
  timestamp: number | null;
}

/**
 * 기본 브랜치 영역 머리(예전 「main에서 갈라진 지점」 행). 갈라진 지점 커밋 바로 위에 끼며,
 * 이 행 위가 이 브랜치에서 새로 만든 커밋이다.
 */
export function BaseHeaderRow({ branch, timestamp, ...rest }: BaseHeaderRowProps) {
  const { t } = useTranslation();
  return (
    <RegionHeaderRow
      {...rest}
      name={t("graph.baseHeader", { branch })}
      desc={timestamp !== null ? t("graph.baseHeaderDesc", { time: formatRelativeTime(timestamp) }) : undefined}
      testId="base-header-row"
    />
  );
}

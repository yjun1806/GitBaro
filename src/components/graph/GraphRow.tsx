import type { MouseEvent, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Bot, FolderGit2 } from "lucide-react";
import { RefBadge } from "@/components/history/CommitItem";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GraphEdge, GraphRowLayout } from "@/lib/graph-lanes";
import type { CommitInfo } from "@/types";
import { formatSeenClock, GRAPH_ROW_HEIGHT, laneX } from "./graph-model";

const H = GRAPH_ROW_HEIGHT;
const MID = H / 2;
const DOT_R = 4.5;
const WIP_R = 5;

/** 설명 / 작성자 / 시각 / 커밋 칸. 시안 `gen_d.py`의 `1fr 110px 80px 70px`. */
export const GRAPH_COLUMNS = "grid grid-cols-[minmax(0,1fr)_110px_80px_70px] gap-3 items-center";

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

interface GraphCellProps {
  layout: GraphRowLayout;
  width: number;
  colorOf: (chain: number) => string;
  isNew: boolean;
  /** 위 WIP 행에서 내려오는 점선을 이 커밋 점까지 잇는다(지금 연 워크트리의 HEAD 행). */
  wipAbove: boolean;
}

/** 한 행의 그래프 칸. 선이 행 안에서 완결되므로 행마다 따로 그린다(`graph-lanes`). */
function GraphCell({ layout, width, colorOf, isNew, wipAbove }: GraphCellProps) {
  const x = laneX(layout.lane);
  const color = colorOf(layout.chain);
  return (
    <svg
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      aria-hidden="true"
      className="shrink-0 overflow-hidden"
      data-lane={layout.lane}
    >
      {layout.edges.map((edge, i) => (
        <path
          key={i}
          d={edgePath(edge, layout.lane)}
          stroke={colorOf(edge.chain)}
          strokeWidth={2}
          fill="none"
          strokeOpacity={0.9}
        />
      ))}
      {wipAbove && (
        <path d={`M${x} 0 V${MID}`} stroke={color} strokeWidth={2} strokeDasharray="2.5 2" fill="none" />
      )}
      <circle
        cx={x}
        cy={MID}
        r={DOT_R}
        fill={color}
        stroke={isNew ? "var(--card)" : undefined}
        strokeWidth={isNew ? 1.5 : undefined}
      />
    </svg>
  );
}

interface GraphRowProps {
  commit: CommitInfo;
  layout: GraphRowLayout;
  graphWidth: number;
  colorOf: (chain: number) => string;
  remoteTags: Set<string> | null;
  avatarUrl?: string;
  isSelected: boolean;
  isHighlighted: boolean;
  isNew: boolean;
  /** 「여기까지 확인함」 아래(이미 확인한) 커밋. 시안처럼 흐리게 그린다. */
  isSeen: boolean;
  wipAbove: boolean;
  /** 설명 칸 맨 앞(ref 라벨 앞)에 둘 것. 저장소별 레인 모드의 저장소 표시에 쓴다. */
  leading?: ReactNode;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 커밋 그래프의 커밋 행. 그래프 칸 + [설명(새 커밋 점, ref 라벨, 제목) / 작성자 / 시각 / 커밋].
 * 에이전트가 쓴 커밋(트레일러로 추정)은 작성자 칸에 흐린 표시와 「추정」 툴팁을 붙인다.
 */
export function GraphRow({
  commit,
  layout,
  graphWidth,
  colorOf,
  remoteTags,
  avatarUrl,
  isSelected,
  isHighlighted,
  isNew,
  isSeen,
  wipAbove,
  leading,
  onClick,
  onContextMenu,
  ref,
}: GraphRowProps) {
  const { t } = useTranslation();
  const resolvedAvatar = avatarUrl ?? commit.author.avatarUrl;
  const authorName = commit.author.name || commit.author.email;
  const agentName = commit.isAgentAuthored ? commit.coAuthors[0]?.name : undefined;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={isSelected ? "true" : undefined}
      data-commit-id={commit.id}
      data-seen={isSeen || undefined}
      className={cn(
        "flex items-center w-full text-left border-b border-(--line) select-none transition-colors",
        // 시안(gen_d.py)의 확인한 커밋: opacity 0.55. 고른 행은 또렷하게 둔다.
        isSeen && !isSelected && "[&>*]:opacity-55",
        isSelected
          ? "bg-(--acc-sel)"
          : isHighlighted
            ? "bg-accent ring-1 ring-inset ring-primary/30"
            : "hover:bg-accent",
      )}
      style={{ height: H }}
    >
      <GraphCell layout={layout} width={graphWidth} colorOf={colorOf} isNew={isNew} wipAbove={wipAbove} />
      <span className={cn(GRAPH_COLUMNS, "flex-1 min-w-0 pl-2 pr-3 text-[12.5px]")}>
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={cn("w-1.5 h-1.5 rounded-full shrink-0", isNew ? "bg-(--acc)" : "bg-transparent")}
            title={isNew ? t("graph.newCommit") : undefined}
          />
          {leading}
          {commit.refs.map((label) => (
            <RefBadge key={`${label.kind}:${label.name}`} label={label} remoteTags={remoteTags} />
          ))}
          <span className={cn("truncate text-foreground", isSelected ? "font-bold" : "font-medium")}>
            {commit.summary}
          </span>
        </span>
        <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-(--fg2)">
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
          <span className="truncate">{authorName}</span>
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
        <span className="truncate text-[12px] text-muted-foreground">
          {formatRelativeTime(commit.timestamp)}
        </span>
        <span className="flex items-center gap-1 font-mono text-[11.5px] text-(--faint)">
          {commit.shortId}
          {commit.isUnpushed && (
            <ArrowUp
              strokeWidth={3}
              className="w-3 h-3 text-primary"
              aria-label={t("graph.unpushed")}
            />
          )}
        </span>
      </span>
    </button>
  );
}

interface GraphWipRowProps {
  wipLabel: string;
  /** 다른 워크트리의 WIP 행이면 그 브랜치(또는 폴더) 이름. 지금 연 워크트리면 null. */
  worktreeName: string | null;
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
  onSelect: () => void;
}

/**
 * 워크트리 하나의 커밋하지 않은 변경(WIP) 행. 그래프 칸에는 점선 원을 그린다.
 * 고르면 아래 칸에 그 워크트리의 스테이징 목록(`ChangesView`)이 열린다.
 */
export function GraphWipRow({
  wipLabel,
  worktreeName,
  count,
  changedAt,
  color,
  graphWidth,
  selected,
  connectDown,
  layout,
  colorOf,
  leading,
  onSelect,
}: GraphWipRowProps) {
  const { t } = useTranslation();
  const x = laneX(layout?.lane ?? 0);
  const active = (count ?? 0) > 0;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={wipLabel}
      onClick={onSelect}
      className={cn(
        "flex items-center w-full text-left shrink-0 border-b border-(--line) transition-colors",
        selected ? "bg-(--acc-sel)" : "hover:bg-accent",
      )}
      style={{ height: H }}
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
          stroke={active ? color : "var(--faint)"}
          strokeWidth={2}
          strokeDasharray="2.5 2"
        />
      </svg>
      <span className={cn(GRAPH_COLUMNS, "flex-1 min-w-0 pl-2 pr-3 text-[12.5px]")}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 shrink-0" />
          {leading}
          {worktreeName && (
            <span
              className="inline-flex items-center gap-1 max-w-[180px] shrink-0 px-[7px] py-px rounded-[6px] border border-(--line2) text-[10.5px] font-bold text-(--fg2)"
              title={t("graph.worktree")}
            >
              <FolderGit2 className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono">{worktreeName}</span>
            </span>
          )}
          <span className="italic text-(--fg2) truncate">{t("shell.uncommitted")}</span>
          <span className="text-[11.5px] text-muted-foreground shrink-0">
            {count === null ? "…" : t("graph.fileCount", { count })}
          </span>
        </span>
        <span />
        <span className="truncate text-[12px] text-muted-foreground">
          {changedAt !== null && (count ?? 0) > 0
            ? t("graph.modifiedAgo", { time: formatRelativeTime(changedAt / 1000) })
            : null}
        </span>
        <span />
      </span>
    </button>
  );
}

interface SeenDividerProps {
  seenAt: number | null;
  graphWidth: number;
  /** 구분선을 지나 아래로 이어지는 선(바로 위 행의 아래 가장자리 선). */
  through: readonly { lane: number; chain: number }[];
  colorOf: (chain: number) => string;
}

/** 「여기까지 확인함」 구분선. 이 선 위의 커밋이 새 커밋이다. 그래프 선은 끊기지 않고 지나간다. */
export function SeenDivider({ seenAt, graphWidth, through, colorOf }: SeenDividerProps) {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="separator"
      aria-label={t("graph.seenHere")}
      className="flex items-center border-b border-(--line) bg-(--acc-faint)"
      style={{ height: H }}
    >
      <svg width={graphWidth} height={H} viewBox={`0 0 ${graphWidth} ${H}`} aria-hidden="true" className="shrink-0">
        {through.map(({ lane, chain }) => (
          <path
            key={`${lane}:${chain}`}
            d={`M${laneX(lane)} 0 V${H}`}
            stroke={colorOf(chain)}
            strokeWidth={2}
            strokeOpacity={0.9}
            fill="none"
          />
        ))}
      </svg>
      <span className="flex items-center gap-2.5 flex-1 min-w-0 pl-2 pr-3">
        <span className="shrink-0 text-[11px] font-bold text-(--acc)">
          {seenAt !== null
            ? t("graph.seenHereAt", {
                time: formatSeenClock(
                  seenAt,
                  Date.now(),
                  {
                    today: (time) => t("graph.seenToday", { time }),
                    yesterday: (time) => t("graph.seenYesterday", { time }),
                  },
                  i18n.language,
                ),
              })
            : t("graph.seenHere")}
        </span>
        <span className="flex-1 h-px bg-(--acc-line)" />
        <span className="shrink-0 text-[11px] text-muted-foreground truncate">{t("graph.seenHint")}</span>
      </span>
    </div>
  );
}

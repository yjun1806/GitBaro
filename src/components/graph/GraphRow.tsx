import type { MouseEvent, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowUp, Bot, FolderGit2, GitBranch } from "lucide-react";
import { RefBadge } from "@/components/history/CommitItem";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GraphEdge, GraphRowLayout } from "@/lib/graph-lanes";
import type { CommitInfo, RefLabel } from "@/types";
import { formatSeenClock, GRAPH_ROW_HEIGHT, laneX, type WipTarget } from "./graph-model";
import { LANE_LABEL_CLASS, laneLabelStyle } from "./lane-style";

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

/**
 * 커밋 점 모양. `plain`: 채운 점(검토 기준이 확인함이거나 원격이 없을 때).
 * `unpushed`: 원격에 없는 커밋 — 채운 점 + 옅은 고리. `pushed`: 원격에 있는 커밋 — 속 빈 점.
 */
export type CommitDot = "plain" | "unpushed" | "pushed";

interface GraphCellProps {
  layout: GraphRowLayout;
  width: number;
  colorOf: (chain: number) => string;
  isNew: boolean;
  /** 위 WIP 행에서 내려오는 점선을 이 커밋 점까지 잇는다(지금 연 워크트리의 HEAD 행). */
  wipAbove: boolean;
  dot: CommitDot;
  /** 줄기에 마우스를 올리면 보일 이름(회색 줄기: 브랜치 이름 또는 「merge됨」). 없으면 undefined. */
  laneTitle?: (chain: number) => string | undefined;
}

/** 한 행의 그래프 칸. 선이 행 안에서 완결되므로 행마다 따로 그린다(`graph-lanes`). */
function GraphCell({ layout, width, colorOf, isNew, wipAbove, dot, laneTitle }: GraphCellProps) {
  const x = laneX(layout.lane);
  const color = colorOf(layout.chain);
  const dotTitle = laneTitle?.(layout.chain);
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
        return (
          <path
            key={i}
            d={edgePath(edge, layout.lane)}
            stroke={colorOf(edge.chain)}
            strokeWidth={2}
            fill="none"
            strokeOpacity={0.9}
          >
            {title && <title>{title}</title>}
          </path>
        );
      })}
      {wipAbove && (
        <path d={`M${x} 0 V${MID}`} stroke={color} strokeWidth={2} strokeDasharray="2.5 2" fill="none" />
      )}
      {dot === "unpushed" && (
        <circle cx={x} cy={MID} r={DOT_R + 2.5} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.5} />
      )}
      <circle
        cx={x}
        cy={MID}
        r={dot === "pushed" ? DOT_R - 0.5 : DOT_R}
        data-dot={dot}
        fill={dot === "pushed" ? "var(--card)" : color}
        stroke={dot === "pushed" ? color : isNew ? "var(--card)" : undefined}
        strokeWidth={dot === "pushed" ? 2 : isNew ? 1.5 : undefined}
      >
        {dotTitle && <title>{dotTitle}</title>}
      </circle>
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
  /** 커밋 점 모양(원격에 있는지). 기본은 채운 점. */
  dot?: CommitDot;
  laneTitle?: (chain: number) => string | undefined;
  /** 브랜치 이름표 색(그 브랜치를 체크아웃한 워크트리의 색). 없으면 회색 이름표. */
  refColor?: (label: RefLabel) => string | null;
  /** 이 행 위 가장자리에 「원격에 올라간 지점」 경계를 그린다. */
  remoteBoundary?: boolean;
  /** 이 커밋 레인에 「여기까지 확인함」 눈금을 붙인다(확인함 기준). 값은 툴팁 문구. */
  seenTick?: string | null;
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
  dot = "plain",
  laneTitle,
  refColor,
  remoteBoundary = false,
  seenTick = null,
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
      data-remote-boundary={remoteBoundary || undefined}
      className={cn(
        "relative flex items-center w-full text-left border-b border-(--line) select-none transition-colors",
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
      {remoteBoundary && <RemoteBoundary />}
      {seenTick && <SeenTick lane={layout.lane} label={seenTick} />}
      <GraphCell
        layout={layout}
        width={graphWidth}
        colorOf={colorOf}
        isNew={isNew}
        wipAbove={wipAbove}
        dot={dot}
        laneTitle={laneTitle}
      />
      <span className={cn(GRAPH_COLUMNS, "flex-1 min-w-0 pl-2 pr-3 text-[12.5px]")}>
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={cn("w-1.5 h-1.5 rounded-full shrink-0", isNew ? "bg-(--acc)" : "bg-transparent")}
            title={isNew ? t("graph.newCommit") : undefined}
          />
          {leading}
          {commit.refs.map((label) => (
            <RefBadge
              key={`${label.kind}:${label.name}`}
              label={label}
              remoteTags={remoteTags}
              laneColor={refColor?.(label)}
            />
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
              className="w-3 h-3 text-(--faint)"
              aria-label={t("graph.unpushed")}
            />
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * 「원격에 올라간 지점」 경계: 이 행 위 가장자리의 가는 점선. 위는 원격에 없는 커밋, 여기부터 원격에 있다.
 * 선 위에 마우스를 올리면 이름이 보인다.
 */
function RemoteBoundary() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="remote-boundary"
      title={t("graph.remoteBoundary")}
      className="absolute left-0 right-0 -top-[3px] h-[6px] z-[1] flex items-center"
    >
      <span aria-hidden="true" className="w-full border-t border-dashed border-(--ln)" />
    </span>
  );
}

/** 「여기까지 확인함」 눈금: 이 커밋 레인 위 가장자리의 짧은 가로 막대. 전체 폭 줄 대신 쓴다. */
function SeenTick({ lane, label }: { lane: number; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="seen-tick"
      className="absolute -top-[2px] z-[1] h-[4px] w-[14px] rounded-full bg-(--acc)"
      style={{ left: laneX(lane) - 7 }}
    />
  );
}

/** 「여기까지 확인함 · 오늘 14:10」 문구. 눈금과 구분선이 같이 쓴다. */
export function useSeenLabel(): (seenAt: number | null) => string {
  const { t, i18n } = useTranslation();
  return (seenAt) =>
    seenAt !== null
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
      : t("graph.seenHere");
}

interface GraphWipRowProps {
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
  onSelect: () => void;
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
  onSelect,
}: GraphWipRowProps) {
  const { t } = useTranslation();
  const x = laneX(layout?.lane ?? 0);
  const active = (count ?? 0) > 0;
  const branchText = wipBranchText(t, target);
  const worktreeText = target.worktree ?? t("graph.wipMainWorktree");
  const countText = count === null ? "…" : t("graph.fileCount", { count });
  return (
    <div
      className={cn(
        "flex items-center w-full shrink-0 border-b border-(--line) transition-colors",
        selected ? "bg-(--acc-sel)" : "hover:bg-accent",
      )}
      style={{ height: H }}
      data-testid="wip-row"
    >
    <button
      type="button"
      aria-pressed={selected}
      aria-label={[ariaContext, wipLabel, branchText, worktreeText, countText].filter(Boolean).join(" · ")}
      onClick={onSelect}
      className="flex items-center flex-1 min-w-0 h-full text-left"
    >
      {/* 워크트리 색의 짧은 막대: 이 행이 어느 워크트리의 변경인지 레인과 같은 색으로 알린다. */}
      <span
        aria-hidden="true"
        data-testid="wip-bar"
        className="self-center shrink-0 w-[3px] h-[18px] rounded-full ml-0.5 -mr-[5px]"
        style={{ background: color }}
      />
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
        />
      </svg>
      <span className={cn(GRAPH_COLUMNS, "flex-1 min-w-0 pl-2 pr-3 text-[12.5px]")}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 shrink-0" />
          {leading}
          <span className="italic text-(--fg2) truncate">{wipLabel}</span>
          {/* 이 변경이 쌓인 브랜치(그 브랜치 최신 커밋 위)와 워크트리. */}
          <span
            className={cn(
              "inline-flex items-center gap-1 max-w-[200px] shrink-0 px-[7px] py-px rounded-[6px] text-[10.5px] font-bold",
              target.branch === null ? "bg-(--chip) text-muted-foreground" : LANE_LABEL_CLASS,
            )}
            style={target.branch === null ? undefined : laneLabelStyle(color)}
            title={branchText}
          >
            <GitBranch className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono">{branchText}</span>
          </span>
          {target.worktree !== null ? (
            <span
              className="inline-flex items-center gap-1 max-w-[180px] shrink-0 px-[7px] py-px rounded-[6px] border border-(--line2) text-[10.5px] font-bold text-(--fg2)"
              title={t("graph.worktree")}
            >
              <FolderGit2 className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono">{target.worktree}</span>
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground">{worktreeText}</span>
          )}
          <span className="text-[11.5px] text-muted-foreground shrink-0">{countText}</span>
          {trailing}
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
    {action && <span className="shrink-0 pr-3 pl-1">{action}</span>}
    </div>
  );
}

/** WIP 행의 브랜치 표시: 「feat/x 브랜치」, 브랜치가 없으면 「브랜치 없음 (HEAD 1a2b3c4)」. */
export function wipBranchText(t: TFunction, target: WipTarget): string {
  if (target.branch !== null) return t("graph.wipBranch", { branch: target.branch });
  return target.shortSha
    ? t("graph.wipDetached", { sha: target.shortSha })
    : t("graph.wipDetachedUnknown");
}

interface ForkPointRowProps {
  /** 기본 브랜치 이름(`main`). */
  branch: string;
  /** 갈라진 지점 커밋의 시각(epoch s). */
  timestamp: number | null;
  graphWidth: number;
  /** 이 행을 지나 아래로 이어지는 선(바로 위 행의 아래 가장자리 선). */
  through: readonly { lane: number; chain: number }[];
  colorOf: (chain: number) => string;
}

/**
 * 저장소 그래프의 「main에서 갈라진 지점」 행(D4). 갈라진 지점 커밋 바로 위에 끼며, 이 행 위가
 * 이 브랜치에서 새로 만든 커밋이다. 그래프 선은 끊기지 않고 지나간다.
 */
export function ForkPointRow({ branch, timestamp, graphWidth, through, colorOf }: ForkPointRowProps) {
  const { t } = useTranslation();
  return (
    <div
      role="separator"
      aria-label={t("graph.forkPoint", { branch })}
      className="flex items-center border-b border-(--line)"
      style={{ height: H }}
      data-testid="fork-point-row"
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
      <span className="flex items-center gap-2 flex-1 min-w-0 pl-2 pr-3 text-[12.5px]">
        <span className="w-1.5 shrink-0" />
        <span className="shrink-0 px-[7px] py-px rounded-[6px] bg-(--chip) text-[10.5px] font-bold text-(--fg2)">
          {branch}
        </span>
        <span className="flex-1 truncate text-(--fg2)">{t("graph.forkPoint", { branch })}</span>
        {timestamp !== null && (
          <span className="shrink-0 text-[12px] text-muted-foreground">{formatRelativeTime(timestamp)}</span>
        )}
      </span>
    </div>
  );
}

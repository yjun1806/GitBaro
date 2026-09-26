import { GitBranch, Tag, FolderGit2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { avatarInitial, type AvatarColor } from "@/lib/avatar-color";
import { laneLabelStyle, LANE_LABEL_CLASS } from "@/components/graph/lane-style";
import { statusTextColors, statusTooltips } from "@/lib/file-status";
import type { FileStatus } from "@/types";

/**
 * 행 안에서 18px 높이로 놓이는 작은 표시들(3.2)과 파일 상태 글자(3.3). 뜻마다 하나씩이고,
 * 서로 바꿔 쓰지 않는다.
 */

/* ── Count ───────────────────────────────────────────────────────── */

export type CountTone = "live" | "sync" | "muted";

const COUNT_TONE_CLASS: Record<CountTone, string> = {
  live: "text-(--live)",
  sync: "text-(--fg2)",
  muted: "text-muted-foreground",
};

export interface CountProps {
  value: number;
  /** 기호. 점 옆(`● 3`)·올릴/받을 커밋(`↑2`·`↓1`)에 쓴다. 기본은 없음. */
  prefix?: "●" | "↑" | "↓" | "";
  tone: CountTone;
  /** 화면 읽기 프로그램에 알릴 뜻. 주면 `role="img"`로 그린다. */
  label?: string;
}

/**
 * 사용자가 행동할 수를 보이는 글자(3.2). 바탕·알약·테두리가 없다 — 알약으로 그리지 않는다(D1).
 * 예외: 툴바 버튼 안의 수(`TOOLBAR_BADGE`)와 탭 뒤의 수(`Tab`)는 버튼·탭 자체의 알약 모양을 그대로
 * 쓴다(D35) — 그 둘은 이 컴포넌트를 쓰지 않는다.
 */
export function Count({ value, prefix = "", tone, label }: CountProps) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : {})}
      className={cn("text-[10.5px] font-semibold tabular-nums leading-none", COUNT_TONE_CLASS[tone])}
    >
      {prefix}
      {value}
    </span>
  );
}

/* ── StatusChip ──────────────────────────────────────────────────── */

export type StatusTone = "neutral" | "success" | "danger" | "warning" | "info" | "live";

const STATUS_CHIP_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-(--chip) text-(--fg2)",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  live: "bg-(--live-soft) text-(--live)",
};

export interface StatusChipProps {
  tone: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
}

/** 한 단어로 된 상태(3.2). 톤 여섯 — 브랜드 색 톤은 없다(D3). */
export function StatusChip({ tone, icon, children }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 h-[18px] px-1.5 rounded-(--radius-chip) text-[10.5px] font-semibold shrink-0",
        STATUS_CHIP_TONE_CLASS[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/* ── RefLabel ────────────────────────────────────────────────────── */

export type RefLabelKind = "local" | "remote" | "head" | "tag" | "tag-local" | "worktree";

const REF_KIND_CLASS: Record<Exclude<RefLabelKind, "worktree">, string> = {
  local: "bg-(--chip) text-foreground border-(--line2)",
  remote: "bg-transparent text-muted-foreground border-border",
  head: "bg-(--chip) text-foreground border-foreground/50 font-bold",
  tag: "bg-success/10 text-success border-success/45",
  "tag-local": "bg-transparent text-success border-success/45 border-dashed",
};

export interface RefLabelProps {
  name: string;
  kind: RefLabelKind;
  /** 이 브랜치를 체크아웃한 워크트리의 레인 색(`kind="worktree"`일 때만 쓴다). 없으면 회색. */
  laneColor?: string | null;
  className?: string;
}

/** git 참조(브랜치·태그·워크트리·HEAD)의 이름(3.2). 종류·위치로 모양이 갈린다(D4). */
export function RefLabel({ name, kind, laneColor, className }: RefLabelProps) {
  const Icon = kind === "tag" || kind === "tag-local" ? Tag : kind === "worktree" ? FolderGit2 : GitBranch;
  const laneStyle = kind === "worktree" ? laneLabelStyle(laneColor) : undefined;
  return (
    <span
      title={name}
      style={laneStyle}
      className={cn(
        "inline-flex items-center gap-1 h-[18px] max-w-[140px] px-1.5 rounded-(--radius-chip) font-mono text-[10.5px] font-semibold leading-none border overflow-hidden",
        laneStyle
          ? cn(LANE_LABEL_CLASS, "border-transparent")
          : kind === "worktree"
            ? "bg-card text-(--fg2) border-(--line2)"
            : REF_KIND_CLASS[kind],
        className,
      )}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate min-w-0">{name}</span>
    </span>
  );
}

/* ── RepoTile ────────────────────────────────────────────────────── */

export type RepoTileSize = "sm" | "md" | "lg" | "xl";

const REPO_TILE_SIZE_CLASS: Record<RepoTileSize, string> = {
  sm: "w-4 h-4 text-[9px] rounded-[5px]",
  md: "w-[18px] h-[18px] text-[9px] rounded-[5px]",
  lg: "w-5 h-5 text-[10.5px] rounded-[5px]",
  xl: "w-7 h-7 text-[12px] rounded-(--radius-item)",
};

export interface RepoTileProps {
  name: string;
  color: AvatarColor;
  size: RepoTileSize;
}

/** 저장소 하나: 저장소 색 바탕에 첫 글자(3.2). 저장소가 아닌 것은 `NEUTRAL_TILE`을 쓴다. */
export function RepoTile({ name, color, size }: RepoTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex items-center justify-center shrink-0 font-extrabold", REPO_TILE_SIZE_CLASS[size])}
      style={{ backgroundColor: color.background, color: color.foreground }}
    >
      {avatarInitial(name)}
    </span>
  );
}

/* ── Dot ─────────────────────────────────────────────────────────── */

export interface DotProps {
  /** 커밋 안 함·받을/올릴 것이 있음 같은 「켜짐」 상태. 꺼지면 회색 점. */
  on: boolean;
  /** 방금 바뀐 순간 테가 한 번 퍼진다. */
  live?: boolean;
  /** 따라가는 중이면 숨 쉰다. */
  breathe?: boolean;
  label?: string;
}

/** 「지금 바뀌는 중」 같은 살아 있는 상태의 점(3.2). 6px, 색은 `--live`(꺼지면 `--muted`). */
export function Dot({ on, live = false, breathe = false, label }: DotProps) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full shrink-0",
        on ? "bg-(--live)" : "bg-muted-foreground",
        live && "shadow-[0_0_0_3px_var(--live-soft)] animate-live-ring",
        breathe && "animate-live-breathe",
      )}
    />
  );
}

/* ── Code ────────────────────────────────────────────────────────── */

export interface CodeProps extends Omit<React.HTMLAttributes<HTMLElement>, "className" | "children"> {
  /** 덩어리(명령 미리보기, 로그). 기본은 줄 안 조각. */
  block?: boolean;
  children: ReactNode;
  className?: string;
}

/** git 명령·경로·비교 범위 같은 글자 그대로의 값(3.2). */
export function Code({ block = false, children, className, ...props }: CodeProps) {
  return (
    <code
      className={cn(
        "font-mono text-[11.5px] text-(--fg2) bg-(--chip) rounded-(--radius-chip)",
        block ? "block px-2.5 py-2 whitespace-pre-wrap" : "px-1.5 py-px",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

/* ── FileStatusLetter ────────────────────────────────────────────── */

const STATUS_LETTER: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  ignored: "!",
  conflicted: "!",
};

export interface FileStatusLetterProps {
  status: FileStatus;
}

/**
 * 파일 한 줄 맨 앞의 상태 글자(3.3). 색 칸 아이콘(옛 `FileStatusBadge`, 지웠다)을 대신한다 — 행
 * 앞에 색 칸이 줄마다 서면 목록이 시끄럽다(D5).
 */
export function FileStatusLetter({ status }: FileStatusLetterProps) {
  return (
    <span
      role="img"
      aria-label={statusTooltips[status]}
      title={statusTooltips[status]}
      className={cn("w-2.5 shrink-0 text-center font-mono text-[10.5px] font-bold", statusTextColors[status])}
    >
      {STATUS_LETTER[status]}
    </span>
  );
}

import { Tag, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RefLabel } from "@/types";
import { LANE_LABEL_CLASS, laneLabelStyle } from "@/components/graph/lane-style";

export function RefBadge({
  label,
  remoteTags,
  laneColor,
}: {
  label: RefLabel;
  remoteTags?: Set<string> | null;
  /**
   * 커밋 그래프에서 이 브랜치를 체크아웃한 워크트리의 레인 색. 주면 브랜치 이름표를 그 색조로
   * 칠한다(옅은 바탕 + 같은 색조의 진한 글자). 태그와 워크트리에 묶이지 않은 브랜치는 회색 그대로.
   */
  laneColor?: string | null;
}) {
  const isRemote = label.kind === "remoteBranch";
  const isTag = label.kind === "tag";
  // A tag is local-only when origin's tag list is known and doesn't contain it.
  const isLocalOnlyTag = isTag && remoteTags != null && !remoteTags.has(label.name);
  // Two orthogonal signals (the palette is monochrome, so color can't carry
  // location — form does):
  //   Type     → color: branches read neutral (gray), tags read green (accent).
  //   Location → form: local/unpushed refs are outlined (local-only tags dashed),
  //              on-remote refs are filled. HEAD is the one emphasised ref.
  const TypeIcon = isTag ? Tag : GitBranch;
  const laneStyle = isTag ? undefined : laneLabelStyle(laneColor);
  if (laneStyle) {
    return (
      <span
        style={laneStyle}
        data-lane-label=""
        className={cn(
          "inline-flex items-center gap-0.5 max-w-[140px] rounded px-1 py-px text-[10px] font-medium leading-none border",
          LANE_LABEL_CLASS,
          // 원격 브랜치는 바탕 없이 테두리만, HEAD는 테두리와 굵기로 한 번 더 강조한다.
          isRemote ? "bg-transparent dark:bg-transparent border-current/40" : "border-transparent",
          label.isHead && "border-current/60 font-semibold",
        )}
      >
        <TypeIcon className="w-2.5 h-2.5 shrink-0" />
        <span className="truncate">{label.name}</span>
      </span>
    );
  }
  return (
    <span
      title={isLocalOnlyTag ? `${label.name} (local only)` : undefined}
      className={cn(
        "inline-flex items-center gap-0.5 max-w-[140px] rounded px-1 py-px text-[10px] font-medium leading-none border",
        label.isHead
          ? // HEAD ("you are here"): neutral chip, strongest outline and weight. Brand color is
            // kept for selection and primary actions only.
            "bg-(--chip) text-foreground border-foreground/50 font-semibold"
          : isLocalOnlyTag
            ? // Local-only tag: green, outlined + dashed = "not yet pushed".
              "bg-transparent text-success border-success/45 border-dashed"
            : isTag
              ? // Pushed tag: green, soft-filled.
                "bg-success/10 text-success border-success/45"
              : isRemote
                ? // Remote branch: neutral, outlined.
                  "bg-transparent text-muted-foreground border-border"
                : // Local branch: neutral, filled.
                  "bg-muted text-foreground border-border",
      )}
    >
      <TypeIcon className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

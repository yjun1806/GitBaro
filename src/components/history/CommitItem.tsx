import type { RefLabel } from "@/types";
import { RefLabel as RefLabelMark, type RefLabelKind } from "@/components/ui/marks";

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
  // 레인 색이 있으면(태그가 아닌 브랜치를 그 색의 워크트리가 체크아웃한 경우) 종류 판정을 덮어쓰고
  // 레인 색 이름표(kind="worktree")로 그린다 — 태그는 절대 레인 색을 쓰지 않는다.
  const kind: RefLabelKind =
    laneColor && !isTag
      ? "worktree"
      : label.isHead
        ? "head"
        : isRemote
          ? "remote"
          : isTag
            ? isLocalOnlyTag
              ? "tag-local"
              : "tag"
            : "local";
  return <RefLabelMark name={label.name} kind={kind} laneColor={laneColor} />;
}

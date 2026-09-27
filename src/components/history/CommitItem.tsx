import { useTranslation } from "react-i18next";
import type { RefLabel } from "@/types";
import { RefLabel as RefLabelMark, type RefLabelKind } from "@/components/ui/marks";

export function RefBadge({
  label,
  remoteTags,
  laneColor,
  className,
}: {
  label: RefLabel;
  /** 이름표 폭 규칙(커밋 그래프는 이름표를 제목보다 먼저 지킨다). */
  className?: string;
  remoteTags?: Set<string> | null;
  /**
   * 커밋 그래프에서 이 브랜치를 체크아웃한 워크트리의 레인 색. `kind="local"`로 정해진 브랜치에만
   * 채움으로 쓴다(옅은 바탕 + 같은 색조의 진한 글자). 원격·HEAD·태그·워크트리에 묶이지 않은 브랜치는
   * 회색 그대로.
   */
  laneColor?: string | null;
}) {
  const { t } = useTranslation();
  const isRemote = label.kind === "remoteBranch";
  const isTag = label.kind === "tag";
  // A tag is local-only when origin's tag list is known and doesn't contain it.
  const isLocalOnlyTag = isTag && remoteTags != null && !remoteTags.has(label.name);
  // 종류가 레인 색보다 먼저다: 원격은 테두리만, HEAD는 굵은 테두리로 남아야 한다 — 레인 색이 있다고
  // (예: origin/feat가 로컬 feat과 같은 워크트리 색을 물려받을 때) 로컬 브랜치와 같은 채움으로
  // 덮어쓰면 `feat`와 `origin/feat`, 지금 워크트리의 HEAD가 서로 구분되지 않는다.
  const kind: RefLabelKind = label.isHead
    ? "head"
    : isRemote
      ? "remote"
      : isTag
        ? isLocalOnlyTag
          ? "tag-local"
          : "tag"
        : "local";
  return (
    <RefLabelMark
      name={label.name}
      kind={kind}
      laneColor={laneColor}
      className={className}
      title={isLocalOnlyTag ? t("history.tagLocalOnly", { name: label.name }) : undefined}
    />
  );
}

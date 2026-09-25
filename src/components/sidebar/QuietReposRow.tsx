import { useTranslation } from "react-i18next";
import { TreeRowFrame } from "./TreeRowFrame";

/** 줄에 이름을 보여 줄 조용한 저장소 수. 나머지는 「…」로 줄인다. */
const NAMES_SHOWN = 2;

interface QuietReposRowProps {
  names: string[];
  expanded: boolean;
  onToggle: () => void;
}

/**
 * 「조용한 저장소 N개 (a, b, …)」 줄. 계정 머리글처럼 카드 밖 사이드바 바탕에 놓인다. 커밋하지 않은 파일·↑↓가 없고 10분 안에 바뀐 파일도 없는
 * 계정 바로 아래 저장소를 한 줄로 접어 둔다(판정은 `isQuietRepo`).
 */
export function QuietReposRow({ names, expanded, onToggle }: QuietReposRowProps) {
  const { t } = useTranslation();
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  const label = t("sidebarTree.quietRepos", {
    count: names.length,
    names: names.length > NAMES_SHOWN ? `${shown}, …` : shown,
  });
  return (
    <TreeRowFrame
      level={2}
      label={label}
      expanded={expanded}
      chevron="leading"
      surface="frame"
      onToggle={onToggle}
      className="gap-1.5"
    >
      <span className="flex-1 min-w-0 truncate text-[11.5px] text-[var(--faint)]">{label}</span>
    </TreeRowFrame>
  );
}

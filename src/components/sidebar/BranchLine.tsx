import { GitBranch } from "lucide-react";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import { BRANCH_MAX_CHARS, ROW_SUBLINE } from "./row-style";

interface BranchLineProps {
  /** 체크아웃한 브랜치. 없으면(detached 등) 아이콘과 이름을 빼고 덧붙임만 보인다. */
  branch: string | null;
  /** 브랜치 뒤에 옅게 붙는 글(예: 「main에서」). 자르지 않고 늘 보인다. */
  suffix?: string;
  /** 마우스를 올리면 보이는 전체 글. 없으면 브랜치 이름. */
  title?: string;
}

/**
 * 저장소·워크트리 행의 둘째 줄: 브랜치 아이콘 + 고정폭 브랜치 이름 + 「· 덧붙임」.
 * 긴 브랜치 이름은 가운데를 「…」로 줄여 앞뒤가 보이게 하고, 그래도 넘치면 끝에서 자른다.
 */
export function BranchLine({ branch, suffix, title }: BranchLineProps) {
  if (!branch && !suffix) return null;
  return (
    <span className={ROW_SUBLINE} title={title ?? branch ?? undefined}>
      {branch && (
        <>
          <GitBranch className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate min-w-0">{middleEllipsis(branch, BRANCH_MAX_CHARS)}</span>
        </>
      )}
      {suffix && (
        <span className="shrink-0 whitespace-nowrap">
          {branch && "· "}
          {suffix}
        </span>
      )}
    </span>
  );
}

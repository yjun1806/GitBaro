import { GitBranch } from "lucide-react";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import { cn } from "@/lib/utils";
import type { MetaPart, MetaPartKind } from "./row-meta";
import { BRANCH_MAX_CHARS, ROW_SUBLINE } from "./row-style";

const PART_CLASS: Record<MetaPartKind, string> = {
  repos: "",
  // 수정: 보조 글자
  modified: "text-(--fg2)",
  // 새 커밋: 행 안에서 선택 막대 말고는 유일한 브랜드 색
  newCommits: "text-(--acc) font-semibold",
  // ↑↓·깨끗함: 설명 글자(기본색)
  sync: "",
  clean: "",
};

interface RowSublineProps {
  /** 체크아웃한 브랜치. 없으면(워크스페이스, detached) 아이콘과 이름을 뺀다. */
  branch?: string | null;
  parts?: MetaPart[];
  className?: string;
}

/**
 * 저장소·워크트리·워크스페이스 행의 둘째 줄: 「⎇ 브랜치 · 수정 N · 새 커밋 N · ↑a ↓b」.
 * 브랜치 이름은 가운데를 「…」로 줄이고 줄 폭의 60%까지만 쓴다. 상태 글은 남은 폭에 한 줄로 놓여
 * 모자라면 끝에서부터 잘리고 「…」가 붙는다(↑↓ → 새 커밋 → 수정 순). 전체 글은 행 툴팁에 있다.
 */
export function RowSubline({ branch, parts = [], className }: RowSublineProps) {
  if (!branch && parts.length === 0) return null;
  return (
    <span className={cn(ROW_SUBLINE, className)}>
      {branch && (
        <>
          <GitBranch className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate shrink-0 max-w-[60%]">{middleEllipsis(branch, BRANCH_MAX_CHARS)}</span>
        </>
      )}
      {parts.length > 0 && (
        <span className="flex-1 min-w-0 truncate" data-testid="row-meta">
          {parts.map((part, i) => (
            <span key={part.kind} data-meta={part.kind}>
              {(i > 0 || branch) && <span aria-hidden="true">{" · "}</span>}
              <span className={PART_CLASS[part.kind]}>{part.text}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

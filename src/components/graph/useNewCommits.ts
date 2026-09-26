import { useEffect, useRef, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/**
 * 이미 본 커밋 목록 `seen`에 견줘 `ids`에 **새로 끼어든** 커밋. 마지막으로 본 커밋보다 위에 있는
 * 처음 보는 커밋만 센다 — 아래로 이어 붙은 것(다음 페이지)은 새 커밋이 아니다. 겹치는 커밋이 하나도
 * 없으면(다른 브랜치로 옮김 등) 아무것도 새 것으로 보지 않는다.
 */
export function insertedCommitIds(seen: ReadonlySet<string>, ids: readonly string[]): string[] {
  let lastSeen = -1;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (seen.has(ids[i])) {
      lastSeen = i;
      break;
    }
  }
  if (lastSeen < 0) return [];
  return ids.slice(0, lastSeen).filter((id) => !seen.has(id));
}

/**
 * 그래프에 새로 나타난 커밋(HEAD가 앞으로 나아감)을 한 번 비추기 위한 목록. 처음 받은 목록과
 * `resetKey`가 바뀐 뒤(다른 저장소·다른 브랜치 보기·함께 그리는 워크트리 변경) 처음 받은 목록은
 * 모두 「이미 본 것」이다. `enabled`가 아니면 기억만 하고 비추지 않는다.
 *
 * 돌려주는 집합은 마지막으로 새로 끼어든 커밋들이다. 그 행은 클래스가 그대로 남아(다시 마운트되지 않으니)
 * 다시 그려도 다시 비추지 않는다.
 */
export function useNewCommits(ids: readonly string[], resetKey: string, enabled: boolean): ReadonlySet<string> {
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  const [flash, setFlash] = useState<ReadonlySet<string>>(NONE);

  useEffect(() => {
    const prev = seen.current;
    if (prev === null || prev.key !== resetKey) {
      seen.current = { key: resetKey, ids: new Set(ids) };
      setFlash(NONE);
      return;
    }
    const inserted = insertedCommitIds(prev.ids, ids);
    // 본 것에 더하기만 한다 — 잠깐 사라졌다 돌아온 커밋(rebase 중)을 새 것으로 비추지 않는다.
    seen.current = { key: resetKey, ids: new Set([...prev.ids, ...ids]) };
    if (inserted.length > 0 && enabled) setFlash(new Set(inserted));
  }, [ids, resetKey, enabled]);

  return flash;
}

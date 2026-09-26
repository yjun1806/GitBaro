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
 * `historiesReady`가 거짓인 동안(함께 그리는 다른 워크트리의 이력을 아직 다 불러오지 못함)에도
 * 기록만 하고 비추지 않는다 — 자신의 이력이 먼저 오고 다른 워크트리 이력이 나중에 와 목록에
 * 끼어들면(시각순으로 이미 본 커밋들 사이에 놓인다), 그 워크트리 이력이 늦게 와서 낀 것일 뿐인데
 * 방금 생긴 커밋처럼 보이기 때문이다. `historiesReady`가 참이 된 뒤부터 끼어드는 커밋만 비춘다.
 *
 * 돌려주는 집합은 마지막으로 새로 끼어든 커밋들이다. 그 행은 클래스가 그대로 남아(다시 마운트되지 않으니)
 * 다시 그려도 다시 비추지 않는다.
 */
export function useNewCommits(
  ids: readonly string[],
  resetKey: string,
  enabled: boolean,
  historiesReady: boolean = true,
): ReadonlySet<string> {
  const seen = useRef<{ key: string; ids: Set<string>; ready: boolean } | null>(null);
  const [flash, setFlash] = useState<ReadonlySet<string>>(NONE);

  useEffect(() => {
    const prev = seen.current;
    if (prev === null || prev.key !== resetKey) {
      seen.current = { key: resetKey, ids: new Set(ids), ready: historiesReady };
      setFlash(NONE);
      return;
    }
    if (!prev.ready) {
      // 아직 다른 워크트리 이력을 불러오는 중 — 새로 채워지는 커밋은 기록만 한다. 이 동안에는
      // 한 번도 비추지 않았으니(flash는 reset 때 NONE으로 시작) 다시 지울 필요가 없다.
      seen.current = { key: resetKey, ids: new Set([...prev.ids, ...ids]), ready: historiesReady };
      return;
    }
    const inserted = insertedCommitIds(prev.ids, ids);
    // 본 것에 더하기만 한다 — 잠깐 사라졌다 돌아온 커밋(rebase 중)을 새 것으로 비추지 않는다.
    seen.current = { key: resetKey, ids: new Set([...prev.ids, ...ids]), ready: historiesReady };
    if (inserted.length > 0 && enabled) setFlash(new Set(inserted));
  }, [ids, resetKey, enabled, historiesReady]);

  return flash;
}

import { useState } from "react";

/**
 * `value`가 바뀔 때마다 1씩 늘어나는 수(처음 값은 0). 「처음 그릴 때가 아니라 바뀐 뒤에만 움직인다」를 정하는 데 쓴다:
 * `count > 0`이면 바뀐 적이 있고, `key={count}`로 걸면 바뀔 때마다 움직임이 처음부터 다시 돈다.
 * 렌더 중에 파생 상태를 갱신하는 React 권장 방식이라 ref나 effect가 필요 없다.
 */
export function useChangeCount(value: unknown): number {
  const [last, setLast] = useState(value);
  const [count, setCount] = useState(0);
  if (!Object.is(last, value)) {
    setLast(value);
    setCount(count + 1);
  }
  return count;
}

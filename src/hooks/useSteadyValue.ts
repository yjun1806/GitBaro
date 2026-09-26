import { useEffect, useState } from "react";

export interface SteadyTiming {
  /** 새로 시작한 일이 이보다 짧게 끝나면 보이지 않는다(ms). */
  showAfterMs: number;
  /** 일이 끝난 뒤 표시를 남겨 두는 시간(ms). 짧은 일이 이어질 때 사이사이 깜박이지 않게 한다. */
  holdMs: number;
}

/**
 * 줄 안에 붙는 작은 「일하는 중」 표시(상태 줄의 git 명령, 사이드바의 fetch)의 기본 박자.
 * 300ms보다 짧은 일은 보이지 않고, 끝난 뒤 800ms 남는다(워크스페이스의 저장소를 차례로 fetch할 때 깜박이지 않게).
 */
export const BUSY_TIMING: SteadyTiming = { showAfterMs: 300, holdMs: 800 };

/**
 * 도는 일(없으면 null)을 표시용으로 고르게 한다. 새로 시작한 일은 `showAfterMs`가 지나야 보이고,
 * 이미 보이는 중이면 다음 일로 바로 바뀌며, 모두 끝나도 `holdMs` 동안 남는다.
 * 켜짐·꺼짐만 필요하면 `useSteadyValue(busy ? true : null, timing) !== null`로 쓴다.
 */
export function useSteadyValue<T>(current: T | null, { showAfterMs, holdMs }: SteadyTiming): T | null {
  const [shown, setShown] = useState<T | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setShown(current), current !== null ? showAfterMs : holdMs);
    return () => clearTimeout(id);
  }, [current, showAfterMs, holdMs]);
  return shown !== null && current !== null ? current : shown;
}

/** 켜짐·꺼짐만 고르게 한다. `useSteadyValue`와 같은 박자다. */
export function useSteadyFlag(busy: boolean, timing: SteadyTiming = BUSY_TIMING): boolean {
  return useSteadyValue(busy ? true : null, timing) !== null;
}

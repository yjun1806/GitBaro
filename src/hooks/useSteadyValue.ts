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
 *
 * 같은 일이 내용만 바뀌며 이어질 때(진행률 갱신처럼 `current`가 매번 새 객체로 온다)는 `keyOf`로
 * 그 일의 정체성만 뽑아 준다. 타이머는 이 키가 바뀔 때만 다시 돌고, 보이는 동안에는 `current`의
 * 최신 값을 그대로 돌려준다 — 잦은 갱신이 `showAfterMs` 타이머를 매번 되돌리지 않는다.
 * 기본 `keyOf`는 `current` 자신이라 원시값(문자열·불리언)은 그대로 동작한다.
 */
export function useSteadyValue<T>(
  current: T | null,
  { showAfterMs, holdMs }: SteadyTiming,
  keyOf: (value: T) => unknown = (value) => value,
): T | null {
  const key = current !== null ? keyOf(current) : null;
  // 보이지 않게 된 뒤(holdMs 동안) 보여 줄 마지막 값. ref 대신 state로 두고, 렌더 중 값이 바뀌었을 때만
  // 그 자리에서 맞춘다(리액트가 안내하는 "prop이 바뀌면 그 렌더 안에서 상태를 맞추는" 패턴 — effect 없이
  // 다시 렌더하므로 한 타이밍 뒤처지지 않는다).
  const [lastValue, setLastValue] = useState<T | null>(current);
  if (current !== null && current !== lastValue) setLastValue(current);

  const [shownKey, setShownKey] = useState<unknown>(null);
  useEffect(() => {
    const id = setTimeout(() => setShownKey(key), key !== null ? showAfterMs : holdMs);
    return () => clearTimeout(id);
  }, [key, showAfterMs, holdMs]);

  if (shownKey === null) return null;
  return current !== null ? current : lastValue;
}

/** 켜짐·꺼짐만 고르게 한다. `useSteadyValue`와 같은 박자다. */
export function useSteadyFlag(busy: boolean, timing: SteadyTiming = BUSY_TIMING): boolean {
  return useSteadyValue(busy ? true : null, timing) !== null;
}

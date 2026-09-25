import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { TauriEventName, TauriEventPayloads } from "@/api/events";

/**
 * 백엔드 창 이벤트를 받는 동안 `handler`를 부른다. 구독은 이벤트 이름이 바뀔 때만 다시 하고,
 * `handler`는 늘 마지막 렌더의 것을 쓴다(그래서 부르는 쪽이 `useCallback`으로 감쌀 필요가 없다).
 * 구독이 끝나기 전에 컴포넌트가 사라지면 곧바로 해제한다. 구독에 실패하면 조용히 넘어간다 —
 * 이 이벤트를 쓰는 곳은 모두 주기적 갱신이 따로 있다. `enabled`가 false인 동안은 구독하지 않는다.
 */
export function useTauriEvent<K extends TauriEventName>(
  name: K,
  handler: (payload: TauriEventPayloads[K]) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    listen<TauriEventPayloads[K]>(name, (event) => {
      if (mounted) handlerRef.current(event.payload);
    })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 이벤트를 못 받아도 주기적 갱신이 대신한다 */
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [name, enabled]);
}

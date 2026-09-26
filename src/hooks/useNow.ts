import { useEffect, useState } from "react";

/** 초 단위 표시가 흐르도록 일정 주기로 다시 그리게 하는 지금 시각(epoch ms). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

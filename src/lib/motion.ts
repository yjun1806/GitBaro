/** 움직임을 보여 줄 수 없는 환경이다: 동작 줄이기가 켜졌거나, 미디어 쿼리가 없는 환경(jsdom 테스트 등). */
export function cannotAnimate(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

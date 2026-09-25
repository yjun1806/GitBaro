import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useUIStore } from "@/stores/ui";

/** diff 크게 보기·되돌리기 움직임의 길이(ms). */
export const MAXIMIZE_MS = 200;
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * 이 요소를 움직여도 되는가. 「동작 줄이기」를 켰거나 Web Animations가 없으면(jsdom 등) 움직이지 않고
 * 바로 새 배치로 넘어간다.
 */
export function canAnimate(el: Element | null): el is HTMLElement {
  if (el === null || typeof (el as HTMLElement).animate !== "function") return false;
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * diff 칸이 크게 보기로 커지거나 되돌아올 때 옛 자리에서 새 자리로 옮겨 가게 한다(FLIP).
 * 크기는 첫 프레임부터 새 크기라 가상 스크롤이 한 번만 다시 잰다 — 폭·높이를 프레임마다 바꾸면
 * diff가 흔들린다. 커질 때는 옛 크기만큼 잘라 보여 주다가 넓히고, 줄어들 때는 자리만 옮긴다.
 * 변형(transform)과 잘라내기(clip-path)는 배치를 바꾸지 않는다.
 */
export function useMaximizeFlip(ref: RefObject<HTMLElement | null>, radius: number): void {
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const before = useRef<DOMRect | null>(null);

  // 스토어가 바뀌는 그 순간(React가 다시 그리기 전)의 자리를 잰다.
  useEffect(
    () =>
      useUIStore.subscribe((state, prev) => {
        if (state.isDiffMaximized !== prev.isDiffMaximized && ref.current) {
          before.current = ref.current.getBoundingClientRect();
        }
      }),
    [ref],
  );

  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    const el = ref.current;
    if (from === null || !canAnimate(el)) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const round = radius > 0 ? ` round ${radius}px` : "";
    const keyframes = maximized
      ? [
          {
            transform: `translate(${dx}px, ${dy}px)`,
            clipPath: `inset(0px ${Math.max(0, to.width - from.width)}px ${Math.max(0, to.height - from.height)}px 0px${round})`,
          },
          { transform: "translate(0px, 0px)", clipPath: `inset(0px 0px 0px 0px${round})` },
        ]
      : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }];
    const animation = el.animate(keyframes, { duration: MAXIMIZE_MS, easing: EASE_OUT });
    return () => animation.cancel();
  }, [maximized, ref, radius]);
}

/**
 * 크게 보기로 숨는 칸(파일 목록·그래프). 숨을 때 바로 사라지지 않고 제자리에 떠서(`leaving`)
 * `offset` 쪽으로 밀리며 흐려진 뒤 숨는다. 떠 있는 동안 배치에서는 빠져 있어서 diff 칸은 곧바로
 * 새 크기를 갖는다. 다시 나타날 때는 흐린 데서 선명해진다.
 * 돌려주는 값이 참이면 칸을 숨기지 말고 떠 있는 모양으로 그린다.
 */
export function usePaneExit(
  ref: RefObject<HTMLElement | null>,
  hidden: boolean,
  offset: { x: number; y: number },
): boolean {
  const [leaving, setLeaving] = useState(false);
  const prev = useRef(hidden);
  const { x, y } = offset;

  useLayoutEffect(() => {
    if (prev.current === hidden) return;
    prev.current = hidden;
    const el = ref.current;
    if (hidden) {
      if (canAnimate(el)) setLeaving(true);
      return;
    }
    setLeaving(false);
    if (!canAnimate(el)) return;
    el.animate(
      [
        { opacity: 0, transform: `translate(${x}px, ${y}px)` },
        { opacity: 1, transform: "translate(0px, 0px)" },
      ],
      { duration: MAXIMIZE_MS, easing: EASE_OUT },
    );
  }, [hidden, ref, x, y]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || el === null) return;
    const animation = el.animate(
      [
        { opacity: 1, transform: "translate(0px, 0px)" },
        { opacity: 0, transform: `translate(${x}px, ${y}px)` },
      ],
      { duration: MAXIMIZE_MS, easing: EASE_OUT, fill: "forwards" },
    );
    animation.onfinish = () => setLeaving(false);
    return () => animation.cancel();
  }, [leaving, ref, x, y]);

  return leaving && hidden;
}

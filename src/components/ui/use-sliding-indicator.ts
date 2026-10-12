import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export interface IndicatorBox {
  left: number;
  width: number;
}

/**
 * 고른 조각 밑(탭 밑줄)이나 뒤(Segmented 알약)에서 표시가 미끄러져 옮겨 가게 한다 — transitions.dev: tabs-sliding.
 * 고른 조각의 자리와 너비를 재서 표시에 `translateX`·`width`로 쓰고, 옮기는 길이·곡선은 CSS(`motion-slide-indicator`)가
 * 맡는다. 처음 그릴 때와 창 크기가 바뀔 때는 전환 없이 제자리에 놓는다. 표시는 작은 요소(2px 줄, 조각 하나)라
 * 너비 전환이 다른 요소의 배치를 건드리지 않는다.
 *
 * @param activeSelector 고른 조각을 찾는 선택자(컨테이너 안).
 * @param box 고른 조각에서 표시의 자리를 뽑는다. 렌더마다 새로 만들어도 된다.
 */
export function useSlidingIndicator(
  containerRef: RefObject<HTMLElement | null>,
  indicatorRef: RefObject<HTMLElement | null>,
  activeSelector: string,
  box: (active: HTMLElement) => IndicatorBox,
): void {
  const boxRef = useRef(box);
  const lastKey = useRef<string | null>(null);

  const apply = useRef((snap: boolean) => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const active = container.querySelector<HTMLElement>(activeSelector);
    if (!active) {
      indicator.style.opacity = "0";
      return;
    }
    const { left, width } = boxRef.current(active);
    const key = `${left}|${width}`;
    indicator.style.opacity = "1";
    if (key === lastKey.current) return;
    const place = () => {
      indicator.style.transform = `translateX(${left}px)`;
      indicator.style.width = `${width}px`;
    };
    if (snap || lastKey.current === null) {
      indicator.style.transition = "none";
      place();
      void indicator.offsetWidth; // 전환 없이 놓은 값을 확정한 뒤 전환을 되살린다.
      indicator.style.transition = "";
    } else {
      place();
    }
    lastKey.current = key;
  });

  useLayoutEffect(() => {
    boxRef.current = box;
    apply.current(false);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => apply.current(true));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
}

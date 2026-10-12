import { useCallback, useEffect } from "react";
import type { RefObject } from "react";
import { cannotAnimate } from "./motion";

/** 이보다 노드가 많은 면은 복제하지 않는다(복제 비용이 닫히는 움직임보다 커진다). */
const MAX_GHOST_NODES = 1500;
/** `animationend`가 오지 않을 때를 위한 안전 제거 시간(ms). 가장 긴 닫힘(150ms)보다 넉넉하다. */
const GHOST_MAX_MS = 400;

/** 떼어진 `el`의 모양을 복제해 `parent`에 남기고 `exitClass`로 사라지게 한 뒤 지운다. */
function spawnGhost(el: HTMLElement, parent: Node, exitClass: string): void {
  // StrictMode가 효과를 다시 돌릴 때는 아직 붙어 있다 — 정말 떼어졌을 때만 만든다.
  if (el.isConnected || !parent.isConnected) return;
  if (cannotAnimate() || el.getElementsByTagName("*").length > MAX_GHOST_NODES) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("data-exit-ghost", "");
  ghost.inert = true;
  ghost.style.pointerEvents = "none";
  ghost.classList.add(exitClass);
  const remove = () => ghost.remove();
  ghost.addEventListener("animationend", (e) => {
    if (e.target === ghost) remove();
  });
  parent.appendChild(ghost);
  window.setTimeout(remove, GHOST_MAX_MS);
}

/**
 * 창·메뉴·툴팁이 떼어질 때 닫히는 움직임을 보이게 한다. 이런 요소는 호출하는 쪽이 `{open && <… />}`로
 * 바로 DOM에서 떼므로 안에서 퇴장 상태를 가질 수 없다. 그래서 떼어지는 순간 모양을 복제해 같은 부모에
 * 남기고 `exitClass`(globals.css의 `.exit-*`)로 사라지게 한 뒤 지운다.
 *
 * 복제본은 `inert`·`aria-hidden`이고 id를 지워서 포커스·접근성 트리·`label for`와 겹치지 않는다.
 * 부모째 사라지는 경우(화면 전환), 동작 줄이기, 노드가 너무 많은 면에서는 만들지 않는다.
 *
 * 컴포넌트가 늘 마운트돼 있고 그 안의 요소만 조건부로 그려지면 `useExitGhostRef`를 쓴다.
 */
export function useExitGhost(ref: RefObject<HTMLElement | null>, exitClass: string): void {
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentNode;
    if (!el || !parent) return;
    return () => spawnGhost(el, parent, exitClass);
  }, [ref, exitClass]);
}

/** `useExitGhost`의 콜백 ref 판: 조건부로 그려지는 요소의 `ref`에 건다. 떼어진 뒤(마이크로태스크)에 복제한다. */
export function useExitGhostRef(exitClass: string): (el: HTMLElement | null) => (() => void) | void {
  return useCallback(
    (el: HTMLElement | null) => {
      const parent = el?.parentNode;
      if (!el || !parent) return;
      return () => queueMicrotask(() => spawnGhost(el, parent, exitClass));
    },
    [exitClass],
  );
}

/**
 * 열리는 중(scale)이 아닌 레이아웃 크기를 잰다. 열리는 keyframes가 요소를 줄여 놓은 채로 시작하므로
 * `getBoundingClientRect()`를 그대로 쓰면 자리를 잡는 계산이 몇 px 어긋난다. 인라인 `!important`는
 * 애니메이션보다 앞서서 잠깐만 transform을 걷고, 애니메이션을 다시 시작시키지 않는다.
 */
export function unscaledRect(el: HTMLElement): DOMRect {
  el.style.setProperty("transform", "none", "important");
  const rect = el.getBoundingClientRect();
  el.style.removeProperty("transform");
  return rect;
}

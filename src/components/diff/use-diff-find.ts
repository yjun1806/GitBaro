import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { isEditableTarget } from "@/components/layout/useDiffMaximize";
import { isDialogOpen } from "@/lib/use-dialog-a11y";
import { compileFindRegex, stepMatch } from "./diff-find";

/** 입력을 멈추고 이만큼 지나면 찾는다. 5만 줄에서도 한 번 훑는 데 수 ms지만 글자마다 돌 필요는 없다. */
export const FIND_DEBOUNCE_MS = 150;

/** ⌘F를 받을 diff 뷰어 표시(DiffViewer가 바깥 칸에 단다). 뷰어가 하나뿐이면 포인터가 밖에 있어도 그 뷰어가 받는다. */
const DIFF_VIEWER_ATTR = "data-diff-viewer";

function isFindShortcut(e: KeyboardEvent): boolean {
  return e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";
}

/**
 * ⌘F가 이 뷰어의 것인가. 포커스가 안에 있거나 포인터가 올라가 있으면 이 뷰어다.
 * 둘 다 아니어도 화면에 diff 뷰어가 이것 하나이고 다른 입력 칸에서 누른 게 아니면 받는다 —
 * 파일 목록을 누른 직후처럼 포커스가 목록에 남아 있을 때도 찾기가 열리게.
 * 모달이 떠 있으면 그 뒤의 뷰어는 받지 않는다(모달 안의 뷰어만 받는다).
 */
function ownsShortcut(root: HTMLElement, e: KeyboardEvent): boolean {
  if (isDialogOpen() && !root.closest('[aria-modal="true"]')) return false;
  const doc = root.ownerDocument;
  if (root.contains(doc.activeElement) || root.matches(":hover")) return true;
  if (isEditableTarget(e.target)) return false;
  return doc.querySelectorAll(`[${DIFF_VIEWER_ATTR}]`).length === 1;
}

interface UseDiffFindOptions {
  /** 찾을 글이 있는 보기인지(바이너리·빈 diff면 false). */
  enabled: boolean;
  /** diff 뷰어 바깥 칸. `DIFF_VIEWER_ATTR`을 달아 둔다. */
  rootRef: RefObject<HTMLElement | null>;
  /** 바뀌면(다른 파일) 첫 일치부터 다시 센다. */
  resetKey: string;
}

/** diff 안 찾기의 상태: 찾기 칸 열기·닫기, 찾을 말, 지금 일치, ⌘F. */
export function useDiffFind({ enabled, rootRef, resetKey }: UseDiffFindOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [settledQuery, setSettledQuery] = useState("");
  const [active, setActive] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState({ count: 0, capped: false });
  const [focusSignal, setFocusSignal] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setSettledQuery(query), FIND_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const regex = useMemo(
    () => compileFindRegex({ query: settledQuery, caseSensitive }),
    [settledQuery, caseSensitive],
  );

  // 찾는 말이나 파일이 바뀌면 첫 일치로. 렌더 중에 맞춘다 — effect로 하면 한 프레임 동안
  // 이전 번호로 스크롤한다.
  const searchKey = `${resetKey}\u0000${regex?.source ?? ""}\u0000${regex?.flags ?? ""}`;
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey);
  if (prevSearchKey !== searchKey) {
    setPrevSearchKey(searchKey);
    setActive(0);
    setResult({ count: 0, capped: false });
  }

  const openFind = useCallback(() => {
    setOpen(true);
    setFocusSignal((n) => n + 1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // 찾기 칸이 사라지면 포커스가 body로 떨어진다 — diff에 남겨 ⌘F가 다시 이 뷰어로 오게 한다.
    rootRef.current?.focus();
  }, [rootRef]);

  const step = useCallback(
    (dir: 1 | -1) => {
      setActive((i) => stepMatch(i, result.count, dir));
      setNonce((n) => n + 1);
    },
    [result.count],
  );

  const onFindResult = useCallback((count: number, capped: boolean) => {
    setResult((prev) => (prev.count === count && prev.capped === capped ? prev : { count, capped }));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.defaultPrevented || !isFindShortcut(e) || !root || !ownsShortcut(root, e)) return;
      e.preventDefault();
      openFind();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, rootRef, openFind]);

  const shown = open && enabled;
  const clampedActive = Math.min(active, Math.max(0, result.count - 1));
  return {
    open: shown,
    openFind,
    /** 보기(`VirtualizedDiffView`·`MarkdownDiffView`)에 넘길 찾기. 닫혀 있거나 빈 말이면 null. */
    viewFind: shown && regex ? { regex, active: clampedActive, nonce } : null,
    onFindResult,
    bar: {
      query,
      caseSensitive,
      active: clampedActive,
      count: regex ? result.count : 0,
      capped: result.capped,
      pending: query !== settledQuery,
      focusSignal,
      onQueryChange: setQuery,
      onToggleCase: () => setCaseSensitive((v) => !v),
      onStep: step,
      onClose: close,
    },
  };
}

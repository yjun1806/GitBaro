/**
 * True while an IME (Korean, Japanese, ...) is composing text. The Enter that
 * confirms a composition must not also submit or select: WebKit reports it with
 * `isComposing` or, on some versions, only with the legacy keyCode 229.
 */
export function isImeComposing(e: { nativeEvent?: KeyboardEvent; isComposing?: boolean; keyCode?: number }): boolean {
  const native = e.nativeEvent ?? e;
  return Boolean(native.isComposing) || native.keyCode === 229;
}

/** Plain Enter that is not confirming an IME composition. */
export function isSubmitEnter(e: { key: string; nativeEvent?: KeyboardEvent; isComposing?: boolean; keyCode?: number }): boolean {
  return e.key === "Enter" && !isImeComposing(e);
}

/**
 * Stash entries are addressed by position (stash@{n}), so every change to the
 * list moves the entries below it. These keep the stash tab's selection on the
 * same entry, or clear it when that entry is gone.
 */

/** Selection after the entry at `removed` was popped or dropped. */
export function selectionAfterStashRemoved(
  selected: number | null,
  removed: number,
): number | null {
  if (selected === null || selected === removed) return null;
  return selected > removed ? selected - 1 : selected;
}

/** Selection after a new stash was pushed on top (stash@{0}). */
export function selectionAfterStashPushed(selected: number | null): number | null {
  return selected === null ? null : selected + 1;
}

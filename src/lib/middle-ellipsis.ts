/**
 * Shortens `text` to at most `maxLength` characters by cutting out its
 * middle and replacing it with a single "…", keeping both ends. Used for the
 * sidebar's worktree base label ("{{branch}}에서 갈라짐") — CSS `truncate`
 * cuts from the end, which can hide the fixed "에서 갈라짐" suffix behind a
 * long branch name; middle-ellipsis keeps the suffix visible instead.
 *
 * Splits the kept characters as evenly as possible between the head and
 * tail, favoring the head by one character when the split is odd (so a
 * branch name reads more like its start than its end).
 */
export function middleEllipsis(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength === 1) return "…";

  const keep = maxLength - 1; // one slot for "…"
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

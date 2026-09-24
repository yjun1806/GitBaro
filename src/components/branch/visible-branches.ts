/** Next highlighted branch name for an arrow key, wrapping at both ends. */
export function nextActiveName(
  visibleNames: string[],
  activeName: string | null,
  direction: "up" | "down",
): string | null {
  const total = visibleNames.length;
  if (total === 0) return null;
  const current = activeName === null ? -1 : visibleNames.indexOf(activeName);
  if (current < 0) return direction === "down" ? visibleNames[0] : visibleNames[total - 1];
  const next = direction === "down" ? (current + 1) % total : (current - 1 + total) % total;
  return visibleNames[next];
}

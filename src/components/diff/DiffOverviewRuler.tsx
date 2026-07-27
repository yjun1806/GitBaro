import { cn } from "@/lib/utils";
import type { ChangeBlock } from "./VirtualizedDiffView";

interface DiffOverviewRulerProps {
  blocks: ChangeBlock[];
  /**
   * 행 인덱스 → 문서 전체에서 그 행이 시작하는 지점(0~1).
   *
   * 인덱스 비율(`start / rowCount`)로는 안 된다 — 긴 줄이 접히면서 행 높이가 제각각이라
   * "몇 번째 행인가"와 "화면상 어디인가"가 어긋난다.
   */
  ratioOf: (rowIndex: number) => number;
  onJump: (rowIndex: number) => void;
}

const kindColor: Record<ChangeBlock["kind"], string> = {
  add: "bg-success",
  del: "bg-danger",
  mix: "bg-warning",
};

/**
 * Change-overview ruler pinned to the right edge of a long diff. Each changed
 * region is a colored tick positioned by its fraction of the whole file;
 * clicking a tick jumps the virtualized viewport to that region. The track
 * itself is click-through so it never blocks scrolling — only ticks are
 * interactive.
 */
export function DiffOverviewRuler({ blocks, ratioOf, onJump }: DiffOverviewRulerProps) {
  if (blocks.length === 0) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-2.5 pointer-events-none z-10">
      {blocks.map((b) => {
        const top = ratioOf(b.start) * 100;
        // 블록의 끝은 그다음 행이 시작하는 지점이다.
        const height = Math.max(0, ratioOf(b.end + 1) * 100 - top);
        return (
          <button
            key={b.start}
            type="button"
            aria-label={`Jump to change at row ${b.start + 1}`}
            onClick={() => onJump(b.start)}
            className={cn(
              "absolute right-0 w-full rounded-[1px] opacity-70 transition-opacity hover:opacity-100 pointer-events-auto",
              kindColor[b.kind],
            )}
            style={{ top: `${top}%`, height: `${height}%`, minHeight: 3 }}
          />
        );
      })}
    </div>
  );
}

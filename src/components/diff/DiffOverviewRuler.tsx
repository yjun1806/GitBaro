import { cn } from "@/lib/utils";
import type { ChangeBlock } from "./VirtualizedDiffView";

interface DiffOverviewRulerProps {
  blocks: ChangeBlock[];
  rowCount: number;
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
export function DiffOverviewRuler({ blocks, rowCount, onJump }: DiffOverviewRulerProps) {
  if (rowCount === 0 || blocks.length === 0) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-2.5 pointer-events-none z-10">
      {blocks.map((b) => {
        const top = (b.start / rowCount) * 100;
        const height = ((b.end - b.start + 1) / rowCount) * 100;
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

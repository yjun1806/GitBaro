import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface SplitHandleProps {
  /** `vertical`: 좌우를 나누는 세로 손잡이(↔). `horizontal`: 위아래를 나누는 가로 손잡이(↕). */
  orientation: "vertical" | "horizontal";
  "aria-label": string;
  /** 끌기를 시작할 때. 이때의 크기를 기억해 두고 `onDrag`의 이동량에 더한다. */
  onDragStart: () => void;
  /** 끌기 시작점에서 움직인 거리(px). 오른쪽·아래가 +다. */
  onDrag: (deltaPx: number) => void;
  /** 두 번 누르면 기본 크기로 되돌린다. */
  onReset: () => void;
  /**
   * `inline`: 카드 안의 1px 선. `gap`: 카드 사이 8px 간격 자체가 손잡이다(간격을 대신 차지한다).
   * `overlay`: 레이아웃 폭·높이를 전혀 차지하지 않는다 — 이미 그려진 경계(배경 하나 위의 1px
   * `--line`, 예: 사이드바와 본문 사이)에 겹쳐 뜬다. 자리는 `at`으로 받아 스스로 그 점에 가운데를
   * 맞춘다. 양쪽 안쪽 여백이 손잡이 폭만큼 밀리지 않아 두 칸의 여백이 같게 보인다.
   */
  variant?: "gap" | "inline" | "overlay";
  /** `gap`일 때 손잡이 두께(px). 없으면 패널 간격(`--g`, 8px). */
  size?: number;
  /** `overlay`일 때 손잡이 중심을 둘 위치(px). 호출부가 경계선 좌표를 계산해 넘긴다. */
  at?: number;
}

/**
 * 끌어서 두 칸의 크기를 바꾸는 손잡이. 포인터 이벤트와 pointer capture를 써서 WKWebView에서도
 * 손잡이 밖으로 포인터가 나가도 끌기가 이어진다. 평소에는 보이지 않고 올리면 색이 드러난다.
 */
export function SplitHandle({
  orientation,
  "aria-label": ariaLabel,
  onDragStart,
  onDrag,
  onReset,
  variant = "gap",
  size,
  at,
}: SplitHandleProps) {
  const start = useRef<number | null>(null);
  const vertical = orientation === "vertical";
  const overlay = variant === "overlay";

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start.current = vertical ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onDragStart();
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    onDrag((vertical ? e.clientX : e.clientY) - start.current);
  };
  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    start.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      title={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={onReset}
      style={
        overlay && at !== undefined
          ? vertical
            ? { left: at, transform: "translateX(-50%)" }
            : { top: at, transform: "translateY(-50%)" }
          : variant === "gap" && size !== undefined
            ? vertical
              ? { width: size }
              : { height: size }
            : undefined
      }
      className={cn(
        "group touch-none select-none flex items-center justify-center",
        vertical ? "cursor-col-resize" : "cursor-row-resize",
        overlay
          ? cn("absolute z-40", vertical ? "inset-y-0" : "inset-x-0")
          : cn(
              "relative shrink-0",
              variant === "gap"
                ? vertical
                  ? "w-(--g) self-stretch"
                  : "h-(--g) w-full"
                : vertical
                  ? "w-px self-stretch bg-(--line)"
                  : "h-px w-full bg-(--line)",
            ),
      )}
    >
      {/* 잡는 영역은 선보다 넓다(가는 선도 잡기 쉽게). */}
      <span
        aria-hidden="true"
        className={cn("absolute z-10", vertical ? "inset-y-0 -inset-x-1" : "inset-x-0 -inset-y-1")}
      />
      <span
        aria-hidden="true"
        className={cn(
          "rounded-full bg-transparent group-hover:bg-(--ln) group-active:bg-(--muted) transition-colors",
          vertical ? "w-[3px] h-10" : "h-[3px] w-10",
        )}
      />
    </div>
  );
}

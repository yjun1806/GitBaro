import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { cannotAnimate } from "@/lib/motion";

/** transitions.dev: text-states-swap — `--text-swap-dur`. 아래 keyframes도 같은 길이를 쓴다. */
const SWAP_MS = 150;

interface SwapTextProps {
  children: string;
  className?: string;
}

/**
 * 상태 글자를 제자리에서 바꾼다(transitions.dev: text-states-swap): 옛 글자가 위로 흐려지며 나가고,
 * 새 글자가 아래에서 올라온다. 글자 짧은 줄(버튼 이름·상태 칩)에만 쓴다. 움직일 수 없는 환경
 * (동작 줄이기·미디어 쿼리 없음)에서는 바로 바꾼다.
 */
export function SwapText({ children, className }: SwapTextProps) {
  const [shown, setShown] = useState(children);
  const [phase, setPhase] = useState<"idle" | "exit" | "enter">("idle");

  if (children !== shown && phase === "idle") {
    if (cannotAnimate()) setShown(children);
    else setPhase("exit");
  }

  useEffect(() => {
    if (phase === "idle") return;
    const timer = setTimeout(() => {
      if (phase === "exit") {
        setShown(children);
        setPhase("enter");
      } else {
        setPhase("idle");
      }
    }, SWAP_MS);
    return () => clearTimeout(timer);
  }, [phase, children]);

  return (
    <span
      className={cn(
        "inline-block",
        phase === "exit" && "animate-swap-out",
        phase === "enter" && "animate-swap-in",
        className,
      )}
    >
      {shown}
    </span>
  );
}

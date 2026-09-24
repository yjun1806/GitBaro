import { cn } from "@/lib/utils";

interface LiveDotProps {
  /** false면 실시간 감시 밖(20초 폴링으로만 채움)이라 흐리게 그린다. */
  watched: boolean;
  /** 툴팁·접근성 이름(예: 「지금 파일이 바뀌는 중 · 12초 전」) */
  label: string;
  className?: string;
}

/** 작업 중 점: 10분 안에 파일이 바뀐 곳. */
export function LiveDot({ watched, label, className }: LiveDotProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-watched={watched}
      className={cn("w-[7px] h-[7px] rounded-full bg-[var(--live)] shrink-0", !watched && "opacity-40", className)}
    />
  );
}

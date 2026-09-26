import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 회전 표시의 크기. 곁에 놓이는 글자 크기에 맞춘다(docs/loading-design.md).
 * - `sm` 12px: 11–12px 글자 곁(사이드바 줄, 칩, 목록 줄 안 상태)
 * - `md` 14px: 13–14px 글자 곁(버튼, 상태 줄, 칸 가운데 「불러오는 중」)
 * - `lg` 20px: 글자 없이 한 영역을 덮을 때(브랜치 전환 덮개)
 */
const SIZE_CLASS = {
  sm: "w-3 h-3",
  md: "w-3.5 h-3.5",
  lg: "w-5 h-5",
} as const;

export type SpinnerSize = keyof typeof SIZE_CLASS;

interface SpinnerProps {
  size?: SpinnerSize;
  /** 색 등 덧붙일 클래스. 색은 기본으로 둘레 글자색을 따른다(버튼 안이면 버튼 글자색). */
  className?: string;
  /** 곁에 글자가 없을 때 무엇을 하는 중인지(i18n). 있으면 그림으로 읽히고, 없으면 화면 읽기 프로그램에 숨긴다. */
  label?: string;
}

/**
 * 앱에서 쓰는 단 하나의 회전 표시. 뜻은 보통 곁의 글자나 감싼 요소의 `role="status"`·`aria-busy`가 전하므로
 * 화면 읽기 프로그램에는 숨긴다. 곁에 글자가 없으면 `label`을 준다.
 * 「동작 줄이기」에서도 돈다 — macOS의 진행 표시처럼, 멈추면 진행 중인지 알 수 없다.
 */
export function Spinner({ size = "md", className, label }: SpinnerProps) {
  return (
    <Loader2
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-spinner=""
      className={cn(SIZE_CLASS[size], "shrink-0 animate-spin", className)}
    />
  );
}

interface BusyIconProps {
  busy: boolean;
  /** 쉬는 동안의 아이콘. 없으면 쉬는 동안 아무것도 그리지 않는다. */
  icon?: ReactNode;
  size?: SpinnerSize;
}

/**
 * 버튼의 아이콘 자리. 일하는 동안 아이콘을 같은 크기의 회전 표시로 바꿔서 버튼 폭이 흔들리지 않는다.
 * 버튼 쪽에서는 `disabled`와 `aria-busy`를 함께 건다.
 */
export function BusyIcon({ busy, icon, size = "md" }: BusyIconProps) {
  if (busy) return <Spinner size={size} />;
  return <>{icon ?? null}</>;
}

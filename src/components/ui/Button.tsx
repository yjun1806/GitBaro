import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BusyIcon, type SpinnerSize } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-6 px-2.5 text-[11.5px] gap-1.5 font-semibold",
  // md의 굵기는 변형에 따라 갈린다(primary·secondary는 semibold, ghost는 medium) — 아래에서 더한다.
  md: "h-7 px-3 text-[12.5px] gap-1.5",
  lg: "h-9 px-4 text-[13px] gap-2 font-semibold",
};

const ICON_ONLY_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-6 w-6 p-0",
  md: "h-7 w-7 p-0",
  lg: "h-9 w-9 p-0",
};

const SPINNER_SIZE: Record<ButtonSize, SpinnerSize> = {
  sm: "sm",
  md: "sm",
  lg: "md",
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-(--chip) text-(--fg2) hover:bg-accent",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** secondary·ghost의 빨간 글자(목록 줄·설정 줄의 삭제). */
  tone?: "danger";
  iconOnly?: boolean;
}

/**
 * `Button`과 같은 모양을 `<button>`이 아닌 요소(`<a>`, `<label>`)에 낼 때 쓰는 클래스 계산.
 * 버튼 자체는 `Button` 컴포넌트를 쓴다.
 */
export function buttonClass({ variant = "secondary", size = "md", tone, iconOnly = false }: ButtonClassOptions = {}): string {
  const weight = size === "md" ? (variant === "ghost" ? "font-medium" : "font-semibold") : undefined;
  return cn(
    "inline-flex items-center justify-center shrink-0 rounded-(--radius-chip) whitespace-nowrap select-none outline-none",
    "transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/40",
    // pointer-events-none을 쓰면 hover가 버튼에 닿지 못해 title 풍선말도 함께 사라진다 — 끈 이유를
    // 보여야 하는 자리(커밋 버튼 등)가 있어서 마우스는 받되 cursor로만 「눌러도 소용없다」를 표시한다.
    "disabled:opacity-45 disabled:cursor-not-allowed",
    iconOnly ? ICON_ONLY_SIZE_CLASS[size] : SIZE_CLASS[size],
    weight,
    VARIANT_CLASS[variant],
    tone === "danger" && (variant === "secondary" || variant === "ghost") && "text-danger",
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** secondary·ghost의 빨간 글자(목록 줄·설정 줄의 삭제). */
  tone?: "danger";
  /** 앞 아이콘. `busy`면 회전 표시로 바뀐다. `iconOnly`면 이 자리가 버튼의 유일한 내용이다. */
  icon?: ReactNode;
  /** disabled + aria-busy + 회전 표시. */
  busy?: boolean;
  /** 정사각 버튼. `aria-label`이 있어야 한다. */
  iconOnly?: boolean;
}

/**
 * 앱의 모든 버튼이 쓰는 하나의 컴포넌트(3.1). 층 0(툴바·사이드바 머리) 전용 버튼은
 * `toolbarButtonClass`를 쓴다.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", tone, icon, busy = false, iconOnly = false, disabled, type = "button", className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(buttonClass({ variant, size, tone, iconOnly }), className)}
      {...props}
    >
      {iconOnly ? (
        <BusyIcon busy={busy} icon={icon ?? children} size={SPINNER_SIZE[size]} />
      ) : (
        <>
          {(icon || busy) && <BusyIcon busy={busy} icon={icon} size={SPINNER_SIZE[size]} />}
          {children}
        </>
      )}
    </button>
  );
});

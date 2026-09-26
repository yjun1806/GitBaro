import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { textInputClass } from "@/components/ui/TextInput";
import { useSettingsRowIds } from "./row-context";

export interface SettingsSelectOption {
  value: string;
  label: string;
}

interface SettingsSelectProps {
  value: string;
  options: readonly SettingsSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** 옵션 뒤에 덧붙일 묶음(`<optgroup>`). */
  children?: ReactNode;
}

/** 목록에서 하나 고르기. 키보드·스크린 리더를 위해 네이티브 `<select>`를 쓴다. */
export function SettingsSelect({ value, options, onChange, disabled, ariaLabel, className, children }: SettingsSelectProps) {
  const ids = useSettingsRowIds();
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : ids?.labelId}
      aria-describedby={ids?.descriptionId}
      onChange={(e) => onChange(e.target.value)}
      className={cn(textInputClass("md"), "pr-6 max-w-[240px]", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}

/** 한 줄 입력칸. 줄 이름에 연결된다. */
export const SettingsTextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SettingsTextInput({ className, ...props }, ref) {
    const ids = useSettingsRowIds();
    return (
      <input
        ref={ref}
        type="text"
        aria-labelledby={props["aria-label"] ? undefined : ids?.labelId}
        aria-describedby={ids?.descriptionId}
        {...props}
        className={cn(textInputClass("md"), className)}
      />
    );
  },
);

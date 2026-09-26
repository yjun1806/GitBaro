import { cn } from "@/lib/utils";
import { useSettingsRowIds } from "./row-context";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** 줄(`SettingsRow`) 밖에서 쓸 때의 이름. */
  ariaLabel?: string;
}

/** 켜고 끄는 스위치. 켜면 브랜드 색이다. Space·Enter로도 바꾼다(button). */
export function Switch({ checked, onChange, disabled = false, ariaLabel }: SwitchProps) {
  const ids = useSettingsRowIds();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : ids?.labelId}
      aria-describedby={ids?.descriptionId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex items-center w-[34px] h-5 shrink-0 rounded-full p-0.5 outline-none",
        "transition-colors duration-(--motion-base) motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1",
        checked ? "bg-primary" : "bg-(--line2)",
        disabled && "opacity-45 cursor-not-allowed",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block w-4 h-4 rounded-full bg-(--panel) shadow-(--shadow-sm)",
          // 손잡이는 트랙 색과 같은 길이(--motion-base)로 옮겨 간다.
          "transition-transform duration-(--motion-base) motion-reduce:transition-none",
          checked ? "translate-x-[14px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

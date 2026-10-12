import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsRowIds } from "./row-context";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** 줄(`SettingsRow`) 밖에서 쓸 때의 이름. */
  ariaLabel?: string;
}

/**
 * 켜고 끄는 스위치. 켜면 브랜드 색이다. Space·Enter로도 바꾼다(button).
 * transitions.dev: toggle — 손잡이가 목표를 살짝 넘었다 돌아오고, 트랙 색은 바로 바뀐다(`--toggle-track` 0ms).
 * 처음 그릴 때는 움직이지 않고, 한 번이라도 눌린 뒤부터 움직인다.
 */
export function Switch({ checked, onChange, disabled = false, ariaLabel }: SwitchProps) {
  const ids = useSettingsRowIds();
  const [toggled, setToggled] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : ids?.labelId}
      aria-describedby={ids?.descriptionId}
      disabled={disabled}
      onClick={() => {
        setToggled(true);
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex items-center w-[34px] h-5 shrink-0 rounded-full p-0.5 outline-none",
        "transition-colors duration-(--toggle-track) motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1",
        checked ? "bg-primary" : "bg-(--line2)",
        disabled && "opacity-45 cursor-not-allowed",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block w-4 h-4 rounded-full bg-(--panel) shadow-(--shadow-sm)",
          // 위치는 `translate`로 둔다(손잡이 keyframes가 같은 속성을 움직인다). 이동 거리는 --toggle-travel.
          checked ? "translate-x-(--toggle-travel)" : "translate-x-0",
          toggled && (checked ? "animate-switch-on" : "animate-switch-off"),
        )}
      />
    </button>
  );
}

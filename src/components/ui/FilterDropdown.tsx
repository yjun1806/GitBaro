import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContextMenu } from "./ContextMenu";

export interface FilterDropdownOption<T extends string> {
  value: T;
  /** 메뉴 항목의 글자이자, 고른 뒤 트리거에 보이는 값 글자다. */
  label: string;
  disabled?: boolean;
}

export interface FilterDropdownProps<T extends string> {
  /** 트리거 앞의 옅은 이름("상태" 등). */
  label: string;
  value: T;
  options: readonly FilterDropdownOption<T>[];
  onChange: (value: T) => void;
  /** 메뉴의 accessible name. 기본은 `label`. */
  ariaLabel?: string;
  className?: string;
}

/**
 * 여럿 중 하나를 고르는 필터(design-system.md 3.x 필터). 칩 모양 트리거에 「이름 값 ▾」(이름은
 * `--muted`)를 보이고, 누르면 `ContextMenu`의 `anchored` 자리가 트리거 아래에 붙는다 — 밖 클릭
 * 제외, 자리 잡은 뒤 첫 항목 포커스는 `ContextMenu`가 그대로 한다. 선택지가 둘이어도 필터면 이
 * 컴포넌트를 쓴다 — `Segmented`는 같은 데이터를 다르게 그리는 보기 방식에만 쓴다.
 */
export function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: FilterDropdownProps<T>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-foreground whitespace-nowrap shrink-0 transition-colors motion-reduce:transition-none hover:bg-accent",
          className,
        )}
      >
        <span className="text-muted-foreground font-medium">{label}</span>
        {current?.label ?? value}
        <ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <ContextMenu
          ariaLabel={ariaLabel ?? label}
          anchored={{ anchorRef: buttonRef }}
          onClose={() => setOpen(false)}
          sections={[
            {
              items: options.map((option) => ({
                label: option.label,
                checked: option.value === value,
                disabled: option.disabled,
                onClick: () => {
                  if (option.value !== value) onChange(option.value);
                },
              })),
            },
          ]}
        />
      )}
    </>
  );
}

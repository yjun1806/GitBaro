import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface FilterChipProps {
  children: ReactNode;
  /** 켜짐 여부. `onRemove`가 있는 변형(늘 켜진 채로 보이는 비교 중 칩)에서도 준다 — 채운 모양을 낸다. */
  pressed: boolean;
  /** 몸통을 누르면 켜고 끈다. `onRemove`가 있는 변형에서는 생략한다(몸통이 버튼이 아니게 된다). */
  onClick?: () => void;
  /** 10px 견본(레인·저장소 색). */
  swatchColor?: string;
  /** 이름 앞에 붙는 아이콘(브랜치 아이콘 등). */
  icon?: ReactNode;
  /** 수. `Count`처럼 알약 없이 글자 그대로 붙인다(예: `<Count value={3} tone="live" prefix="●" />`). */
  count?: ReactNode;
  /** 늘 켜져 있어야 해서 끌 수 없는 칩. 네이티브 `disabled` 대신 `aria-disabled`만 쓴다 — hover는
   * 그대로 받아 `title`(이유)이 풍선말로 뜬다. `onRemove`가 있는 변형에는 쓰지 않는다. */
  locked?: boolean;
  /** 마우스를 올렸을 때 보일 설명(잠긴 이유, 조용한 이유, 전체 이름 등). */
  title?: string;
  /** 주면 몸통 끝에 닫기(×)를 붙이고(비교 중 칩), 몸통 자체는 버튼이 아닌 고정 표시가 된다(중첩
   * 버튼을 피한다). 이 칩은 `onClick`이 아니라 이 버튼으로만 꺼진다. */
  onRemove?: () => void;
  /** ×의 접근성 이름. 기본은 `filters.removeChip`. */
  removeLabel?: string;
  className?: string;
}

const BODY_CLASS =
  "inline-flex items-center gap-1.5 h-6 pl-2 rounded-(--radius-chip) text-[11.5px] font-semibold whitespace-nowrap shrink-0 transition-colors motion-reduce:transition-none";

function toneClass(pressed: boolean): string {
  return pressed
    ? "bg-(--acc-sel) text-foreground border border-transparent"
    : "border border-(--line2) text-(--fg2) hover:bg-accent";
}

/**
 * 켜고 끄는 필터 칩(design-system.md 3.x 필터). 꺼짐 = 테두리(`--line2`) + `--fg2` 글자, 켜짐 =
 * `--acc-sel` 채움(테두리 없음) + `--fg` 글자. 왼쪽 막대는 쓰지 않는다 — 선택은 채움으로만 말한다.
 */
export function FilterChip({
  children,
  pressed,
  onClick,
  swatchColor,
  icon,
  count,
  locked = false,
  title,
  onRemove,
  removeLabel,
  className,
}: FilterChipProps) {
  const { t } = useTranslation();
  const content = (
    <>
      {swatchColor && (
        <span
          aria-hidden="true"
          data-testid="filter-chip-swatch"
          className="w-2.5 h-2.5 rounded-[3px] shrink-0"
          style={{ background: swatchColor }}
        />
      )}
      {icon}
      <span className="truncate min-w-0">{children}</span>
      {count}
    </>
  );

  if (onRemove) {
    return (
      <span title={title} className={cn(BODY_CLASS, toneClass(pressed), "pr-1", className)}>
        {content}
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? t("filters.removeChip")}
          title={removeLabel ?? t("filters.removeChip")}
          className="flex items-center justify-center w-4 h-4 shrink-0 rounded-[4px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors motion-reduce:transition-none"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-disabled={locked || undefined}
      title={title}
      onClick={() => {
        if (!locked) onClick?.();
      }}
      className={cn(BODY_CLASS, toneClass(pressed), "pr-2", locked && "cursor-default", className)}
    >
      {content}
    </button>
  );
}

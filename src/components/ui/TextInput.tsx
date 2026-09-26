import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useSettingsRowIds } from "@/components/settings/ui/row-context";
import { Button } from "./Button";

export type TextInputSize = "md" | "sm";

const FIELD_SIZE_CLASS: Record<TextInputSize, string> = {
  md: "h-7 text-[12.5px]",
  sm: "h-6 text-[11.5px]",
};

const FIELD_BASE =
  "w-full rounded-(--radius-item) border border-border bg-card px-2.5 text-foreground outline-none transition-colors motion-reduce:transition-none hover:border-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-45 disabled:cursor-not-allowed";

/** `TextInput`과 같은 모양이 필요한 곳(네이티브 `<select>` 등)에 쓰는 클래스 계산. */
export function textInputClass(size: TextInputSize = "md"): string {
  return cn(FIELD_BASE, FIELD_SIZE_CLASS[size]);
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: TextInputSize;
}

/** 한 줄 입력칸(3.12). `md` 28px / `sm` 24px. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = "md", className, ...props },
  ref,
) {
  const ids = useSettingsRowIds();
  return (
    <input
      ref={ref}
      type="text"
      aria-labelledby={props["aria-label"] ? undefined : ids?.labelId}
      aria-describedby={ids?.descriptionId}
      {...props}
      className={cn(textInputClass(size), className)}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** 여러 줄 입력칸(커밋 본문 등). `TextInput`과 같은 테두리·모서리, 줄 높이 18px. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...props }, ref) {
  const ids = useSettingsRowIds();
  return (
    <textarea
      ref={ref}
      aria-labelledby={props["aria-label"] ? undefined : ids?.labelId}
      aria-describedby={ids?.descriptionId}
      {...props}
      className={cn(
        "w-full rounded-(--radius-item) border border-border bg-card px-2.5 py-1.5 text-[12.5px] leading-[18px] text-foreground outline-none transition-colors motion-reduce:transition-none hover:border-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-45 disabled:cursor-not-allowed",
        className,
      )}
    />
  );
});

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: TextInputSize;
  /** 층 2(패널) 위는 `panel`(테두리 없이 `--chip` 채움), 층 0(바탕) 위는 `frame`(흰 바탕 + 테두리). */
  surface?: "panel" | "frame";
  /** 주면 값이 있을 때 지우기 버튼을 보인다. */
  onClear?: () => void;
}

/** 검색 입력칸(3.12). `md` 28px(패널 머리, 사이드바) / `sm` 24px(찾기 줄). */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { size = "md", surface = "panel", onClear, className, value, ...props },
  ref,
) {
  const { t } = useTranslation();
  const ids = useSettingsRowIds();
  const showClear = Boolean(onClear && typeof value === "string" && value.length > 0);
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 rounded-(--radius-item)",
        FIELD_SIZE_CLASS[size],
        surface === "frame" ? "bg-card border border-(--line2)" : "bg-(--chip)",
      )}
    >
      <Search className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={ref}
        type="text"
        value={value}
        aria-labelledby={props["aria-label"] ? undefined : ids?.labelId}
        aria-describedby={ids?.descriptionId}
        {...props}
        className={cn("flex-1 min-w-0 bg-transparent outline-none placeholder:text-muted-foreground", className)}
      />
      {showClear && (
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          onClick={onClear}
          aria-label={t("common.clearSearch")}
          title={t("common.clearSearch")}
          className="h-4 w-4 -mr-1"
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
});

import { cn } from "@/lib/utils";

/** 설정 화면의 보조 버튼. */
export const SETTINGS_BUTTON =
  "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 shrink-0 rounded-(--radius-item) border border-border bg-card text-[12.5px] font-medium text-foreground whitespace-nowrap outline-none transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-card";

/** 되돌릴 수 없거나 목록을 바꾸는 버튼(빨강 글자). */
export const SETTINGS_BUTTON_DANGER = cn(SETTINGS_BUTTON, "text-destructive hover:bg-destructive/10");

/** 아이콘만 있는 작은 버튼(복사·Finder에서 보기). */
export const SETTINGS_ICON_BUTTON =
  "inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-[6px] text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40";

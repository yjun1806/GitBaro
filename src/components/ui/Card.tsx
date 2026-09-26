import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL_SURFACE } from "./layers";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/** 층 2(패널)의 카드: 흰 바탕 + 옅은 그림자 + 14px 모서리(2.5). 본문 칸의 모든 덩어리가 이것이다. */
export function Card({ children, className }: CardProps) {
  return (
    <section className={cn("relative flex flex-col min-w-0 min-h-0 overflow-hidden", PANEL_SURFACE, className)}>
      {children}
    </section>
  );
}

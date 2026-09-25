import { useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMenuActions } from "@/hooks/useMenuActions";
import { cn } from "@/lib/utils";
import { renderPrMarkdown } from "./pr-markdown";
import "./pr-markdown.css";

interface PrMarkdownProps {
  source: string;
  /** 본문이 비었을 때 보일 글. 없으면 아무것도 그리지 않는다(본문 없는 승인 리뷰 등). */
  placeholder?: string;
  className?: string;
  /** 이 글의 GitHub 주소(PR·코멘트). 앱이 그릴 수 없는 그림은 이 주소로 가는 링크가 된다. */
  sourceUrl?: string;
}

/**
 * PR 본문·코멘트. 살균한 HTML만 넣는다(`renderPrMarkdown`). 링크를 누르면 앱 창이 그 주소로 넘어가지
 * 않게 막고 브라우저에서 연다.
 */
export function PrMarkdown({ source, placeholder, className, sourceUrl }: PrMarkdownProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const imageLabel = t("pr.imageOnGitHub");
  const html = useMemo(
    () => renderPrMarkdown(source, { href: sourceUrl ?? "", label: imageLabel }),
    [source, sourceUrl, imageLabel],
  );

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = e.target instanceof Element ? e.target.closest("a") : null;
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href");
    if (href && /^(https?:|mailto:)/i.test(href)) actions.openInBrowser(href);
  };

  if (source.trim() === "") {
    return placeholder ? <p className={cn("text-xs italic text-muted-foreground", className)}>{placeholder}</p> : null;
  }
  return (
    // 살균한 HTML이다(`pr-markdown.ts`). 링크 누름만 가로챈다.
    <div className={cn("pr-md", className)} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

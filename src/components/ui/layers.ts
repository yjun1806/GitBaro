/**
 * 층 2(패널)의 공통 겉모습: 흰 바탕 + 옅은 그림자 + 패널 모서리(14px).
 * 본문 칸의 카드와 사이드바의 섬(「지금 바뀌는 중」, 계정 묶음)이 같은 모양을 쓴다.
 */
export const PANEL_SURFACE = "bg-card rounded-(--radius-panel) shadow-(--shadow)";

/**
 * 층 3(떠 있는 요소: 메뉴·팝오버·확인 창·툴팁)의 공통 겉모습.
 * 흰 바탕 + 진한 그림자 + 1px 테두리(plans/design/README.md 「색 체계 결정」).
 * 모서리는 요소마다 달라서 여기 넣지 않는다.
 */
export const FLOATING_SURFACE =
  "bg-popover text-popover-foreground border border-border shadow-(--shadow-float)";

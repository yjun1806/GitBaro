/**
 * 사이드바 공통 모양. 행마다 따로 적지 않고 여기서 가져다 쓴다.
 */

/** 앞 아이콘 자리: 모든 행이 20px 둥근 타일을 쓴다(저장소 아바타와 같은 크기). */
export const LEADING_TILE = "w-5 h-5 shrink-0 rounded-[var(--radius-chip)] flex items-center justify-center";

/** 저장소가 아닌 행(계정·조직·워크스페이스·워크트리)의 타일: 회색 채움 + 가운데 13px 아이콘. */
export const NEUTRAL_TILE = `${LEADING_TILE} bg-foreground/[0.07] text-(--fg2)`;

/** 타일 안 아이콘 크기 */
export const TILE_ICON = "w-[13px] h-[13px]";

/** 사이드바 아이콘 버튼(모두 접기·정렬·새 워크스페이스): 흰 상자 없이 hover에만 옅은 채움. */
export const SIDEBAR_ICON_BUTTON =
  "w-6 h-6 shrink-0 flex items-center justify-center rounded-[var(--radius-chip)] text-muted-foreground hover:text-foreground hover:bg-(--frame-hover) outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** 행 첫 줄(이름) */
export const ROW_TITLE = "text-[12.5px] text-foreground truncate";

/** 행 둘째 줄(브랜치 아이콘 + 고정폭 브랜치 이름 + 상태 글) */
export const ROW_SUBLINE = "flex items-center gap-1 min-w-0 text-[10.5px] text-muted-foreground";

/** 둘째 줄 브랜치 이름을 가운데 「…」로 줄이는 길이 */
export const BRANCH_MAX_CHARS = 26;

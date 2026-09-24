import { PANEL_SURFACE } from "@/components/ui/layers";

/**
 * 사이드바 공통 모양. 행마다 따로 적지 않고 여기서 가져다 쓴다.
 */

/**
 * 저장소·워크스페이스 카드: 본문 카드와 같은 흰 섬(층 2). 안쪽 여백은 사방 4px이고,
 * 행(좌우 8px)과 선택 막대는 그 안에 놓인다.
 */
export const SIDEBAR_CARD = `flex flex-col p-1 ${PANEL_SURFACE}`;

/** 앞 아이콘 자리: 18px 둥근 타일(저장소 아바타, 워크스페이스 아이콘). */
export const LEADING_TILE = "w-[18px] h-[18px] shrink-0 rounded-[5px] flex items-center justify-center";

/** 저장소가 아닌 머리 줄(워크스페이스)의 타일: 회색 채움 + 가운데 12px 아이콘. */
export const NEUTRAL_TILE = `${LEADING_TILE} bg-foreground/[0.07] text-(--fg2)`;

/** 작업 폴더·브랜치 줄의 앞 아이콘 칸. 타일과 같은 폭이라 아이콘이 아바타와 한 세로줄에 선다. */
export const ROW_ICON_SLOT = "w-[18px] shrink-0 flex items-center justify-center text-muted-foreground";

/** 타일 안 아이콘 크기 */
export const TILE_ICON = "w-3 h-3";

/** 사이드바 아이콘 버튼(모두 접기·정렬·새 워크스페이스): 흰 상자 없이 hover에만 옅은 채움. */
export const SIDEBAR_ICON_BUTTON =
  "w-6 h-6 shrink-0 flex items-center justify-center rounded-[var(--radius-chip)] text-muted-foreground hover:text-foreground hover:bg-(--frame-hover) outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** 행 이름 */
export const ROW_TITLE = "flex-1 min-w-0 text-[12.5px] text-foreground truncate";

/** 작업 폴더 줄의 브랜치 이름(고정폭) */
export const ROW_BRANCH = "flex-1 min-w-0 font-mono text-[11.5px] truncate";

/** 브랜치 이름을 가운데 「…」로 줄이는 길이. 좁은 사이드바에서도 앞뒤(접두어와 끝 이름)가 보이게 한다. */
export const BRANCH_MAX_CHARS = 30;

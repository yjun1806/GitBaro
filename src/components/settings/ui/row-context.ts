import { createContext, useContext } from "react";

export interface RowIds {
  labelId: string;
  descriptionId: string | undefined;
}

export const RowContext = createContext<RowIds | null>(null);

/**
 * 줄 안의 컨트롤(스위치·세그먼트·선택·입력)이 자기 이름과 설명을 찾는 데 쓴다.
 * 줄 밖에서 쓰면 null이라 컨트롤이 직접 받은 `aria-label`을 쓴다.
 */
export function useSettingsRowIds(): RowIds | null {
  return useContext(RowContext);
}

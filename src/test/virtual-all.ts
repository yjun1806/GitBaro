import { vi } from "vitest";

/**
 * jsdom은 레이아웃이 없어 `@tanstack/react-virtual`이 행을 하나도 그리지 않는다. 이 대역은 모든 항목을
 * 그리고, `scrollToIndex` 호출을 기록한다. 테스트 파일에서
 * `vi.mock("@tanstack/react-virtual", async () => (await import("@/test/virtual-all")).virtualAllModule)`.
 */
export const scrollToIndex = vi.fn();

export const virtualAllModule = {
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (index: number) => number }) => {
    let start = 0;
    const items = Array.from({ length: count }, (_, index) => {
      const item = { index, key: index, start };
      start += estimateSize(index);
      return item;
    });
    return {
      getVirtualItems: () => items,
      getTotalSize: () => start,
      measureElement: () => {},
      scrollToIndex,
    };
  },
};

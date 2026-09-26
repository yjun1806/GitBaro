// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useToastStore } from "@/stores/toast";
import { ErrorToast } from "@/components/error/ErrorToast";

afterEach(() => {
  cleanup();
  useToastStore.setState({ toasts: [] });
});

// D-low #7: 알림이 하나도 없을 때 칸 전체가 사라졌다가 다시 생기면, 스크린리더가 그 칸을 라이브
// 리전으로 다시 등록하지 못해 새로 뜨는 알림을 놓칠 수 있었다. 칸 자체는 항상 DOM에 남긴다.
describe("ErrorToast live region", () => {
  it("keeps the live-region container mounted even with no toasts", () => {
    const { container } = render(<ErrorToast />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();
  });

  it("announces an error toast as role=alert and a success toast as role=status", () => {
    render(<ErrorToast />);
    act(() => {
      useToastStore.getState().addToast("something broke", "error");
      useToastStore.getState().addToast("saved", "success");
    });
    expect(screen.getByRole("alert").textContent).toContain("something broke");
    expect(screen.getByRole("status").textContent).toContain("saved");
  });
});

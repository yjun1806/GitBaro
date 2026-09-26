// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import type { GitCommandEntry } from "@/types";
import { HOLD_MS, SHOW_AFTER_MS, StatusActivity } from "../StatusActivity";

const op = (id: string, percent?: number): GitCommandEntry => ({
  id,
  command: "git fetch",
  operation: "fetch",
  repoPath: `/r/${id}`,
  startedAt: 1,
  ...(percent !== undefined ? { progress: { message: "", percent } } : {}),
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  setOnline(true);
  useUIStore.setState({ isActivityLogOpen: false });
  useActivityStore.setState({ activeOperations: {} });
});

afterEach(cleanup);

describe("StatusActivity", () => {
  it("opens and closes the activity log from its button", () => {
    render(<StatusActivity />);
    const button = screen.getByRole("button", { name: "Activity Log" });
    fireEvent.click(button);
    expect(useUIStore.getState().isActivityLogOpen).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(useUIStore.getState().isActivityLogOpen).toBe(false);
  });

  it("shows the running git command and its progress in place of the icon", () => {
    vi.useFakeTimers();
    try {
      useActivityStore.setState({ activeOperations: { a: op("a", 40) } });
      render(<StatusActivity />);
      act(() => void vi.advanceTimersByTime(SHOW_AFTER_MS));
      const button = screen.getByRole("button", { name: "Activity Log" });
      // 명령 이름(fetch)이 아니라 사람이 읽는 말로 보인다.
      expect(screen.getByTestId("running-op").textContent).toContain("Fetching");
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.textContent).toContain("40%");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not flicker for short commands run one after another", () => {
    vi.useFakeTimers();
    try {
      render(<StatusActivity />);
      // 짧게 끝나는 명령은 보이지 않는다.
      act(() => useActivityStore.setState({ activeOperations: { a: op("a") } }));
      act(() => void vi.advanceTimersByTime(SHOW_AFTER_MS - 50));
      act(() => useActivityStore.setState({ activeOperations: {} }));
      act(() => void vi.advanceTimersByTime(HOLD_MS));
      expect(screen.queryByTestId("running-op")).toBeNull();

      // 한 번 보이면, 명령 사이의 짧은 빈틈에도 계속 보인다.
      act(() => useActivityStore.setState({ activeOperations: { b: op("b") } }));
      act(() => void vi.advanceTimersByTime(SHOW_AFTER_MS));
      expect(screen.getByTestId("running-op")).toBeTruthy();
      act(() => useActivityStore.setState({ activeOperations: {} }));
      act(() => void vi.advanceTimersByTime(HOLD_MS - 100));
      expect(screen.getByTestId("running-op")).toBeTruthy();
      act(() => useActivityStore.setState({ activeOperations: { c: op("c") } }));
      expect(screen.getByTestId("running-op")).toBeTruthy();

      // 모두 끝나고 HOLD_MS가 지나면 아이콘으로 돌아간다.
      act(() => useActivityStore.setState({ activeOperations: {} }));
      act(() => void vi.advanceTimersByTime(HOLD_MS));
      expect(screen.queryByTestId("running-op")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says offline only while offline", () => {
    render(<StatusActivity />);
    expect(screen.queryByTestId("offline")).toBeNull();
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline").textContent).toBe("Offline");
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import { StatusActivity } from "../StatusActivity";

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
    useActivityStore.setState({
      activeOperations: {
        a: { id: "a", command: "git fetch", operation: "fetch", repoPath: "/r", startedAt: 1, progress: { message: "", percent: 40 } },
      },
    });
    render(<StatusActivity />);
    const button = screen.getByRole("button", { name: "Activity Log" });
    expect(screen.getByTestId("running-op").textContent).toBe("fetch");
    expect(button.textContent).toContain("40%");
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

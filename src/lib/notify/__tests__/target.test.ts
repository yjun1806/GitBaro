import { describe, expect, it } from "vitest";
import {
  deliveryChannel,
  notificationSettingsOf,
  PENDING_TARGET_MAX_AGE_MS,
  targetToOpenOnFocus,
  type NotificationTarget,
} from "../target";

const target: NotificationTarget = { kind: "commit", repoPath: "/r", worktreePath: "/wt", commitOid: "abc" };

describe("notification delivery", () => {
  it("shows an in-app toast while the app is in front unless the user asked for system notifications", () => {
    expect(deliveryChannel(true, { whenFocused: false })).toBe("toast");
    expect(deliveryChannel(true, { whenFocused: true })).toBe("system");
    expect(deliveryChannel(false, { whenFocused: false })).toBe("system");
  });

  it("fills missing settings with the defaults", () => {
    expect(notificationSettingsOf(undefined)).toEqual({ newCommits: true, ciFailures: true, whenFocused: false });
    expect(notificationSettingsOf({ ciFailures: false })).toEqual({ newCommits: true, ciFailures: false, whenFocused: false });
  });

  it("opens the last notification's target on focus only while it is recent", () => {
    expect(targetToOpenOnFocus(null, 0)).toBeNull();
    expect(targetToOpenOnFocus({ target, sentAt: 0 }, PENDING_TARGET_MAX_AGE_MS)).toBe(target);
    expect(targetToOpenOnFocus({ target, sentAt: 0 }, PENDING_TARGET_MAX_AGE_MS + 1)).toBeNull();
  });
});

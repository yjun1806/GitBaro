import type { NotificationSettings } from "@/types";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  newCommits: true,
  ciFailures: true,
  whenFocused: false,
};

/** 설정 파일에 알림 설정이 없거나 일부만 있으면 기본값으로 채운다. */
export function notificationSettingsOf(saved: Partial<NotificationSettings> | undefined): NotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...saved };
}

/** 알림을 누르면 열 곳. */
export type NotificationTarget =
  | { kind: "commit"; repoPath: string; worktreePath: string; commitOid: string }
  | { kind: "ci"; repoPath: string; worktreePath: string; runId: number };

/** 보낸 시스템 알림 중 아직 열지 않은 마지막 것. */
export interface PendingTarget {
  target: NotificationTarget;
  sentAt: number;
}

/**
 * macOS 에서 알림을 누르면 앱이 앞으로 오지만, 이 Tauri 알림 플러그인은 데스크톱에서 누른 알림을
 * 앱에 알려 주지 않는다. 그래서 알림을 보낸 뒤 이 시간 안에 창이 포커스를 얻으면 그 알림을 누른
 * 것으로 보고 마지막 알림의 대상을 연다.
 */
export const PENDING_TARGET_MAX_AGE_MS = 5 * 60_000;

/** 창이 포커스를 얻었을 때 열 대상. 너무 오래된 알림이면 열지 않는다. */
export function targetToOpenOnFocus(
  pending: PendingTarget | null,
  now: number,
  maxAgeMs = PENDING_TARGET_MAX_AGE_MS,
): NotificationTarget | null {
  if (!pending || now - pending.sentAt > maxAgeMs) return null;
  return pending.target;
}

/**
 * 알림을 어디로 보낼지. 앱이 앞에 있고 「앱이 앞에 있을 때도 알림」이 꺼져 있으면 앱 안 토스트로,
 * 그 밖에는 시스템 알림으로 보낸다.
 */
export function deliveryChannel(focused: boolean, settings: Pick<NotificationSettings, "whenFocused">): "system" | "toast" {
  return focused && !settings.whenFocused ? "toast" : "system";
}

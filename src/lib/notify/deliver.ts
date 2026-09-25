import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useNotifyStore } from "@/stores/notify";
import { useToastStore } from "@/stores/toast";
import { deliveryChannel, type NotificationTarget } from "./target";

export interface AppNotification {
  title: string;
  body: string;
  target: NotificationTarget | null;
}

/**
 * 알림 권한을 확인하고, 아직 정하지 않았으면 그때 묻는다(처음 알림을 보낼 때, 또는 설정의 「알림 테스트」).
 * 거절했거나 물을 수 없으면 false.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

async function isAppFocused(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return document.hasFocus();
  }
}

/**
 * 알림을 보낸다. 앱이 앞에 있고 「앱이 앞에 있을 때도 알림」이 꺼져 있으면 앱 안 토스트로 대신한다.
 * 앱이 뒤에 있을 때 시스템 알림을 보냈으면 그 대상을 기억해, 알림을 눌러 창이 앞으로 오면 연다(`useOpenNotificationOnFocus`).
 * 권한이 없으면 아무것도 하지 않는다. 보낸 경로를 돌려준다.
 */
export async function deliverNotification(
  notification: AppNotification,
  { force = false }: { force?: boolean } = {},
): Promise<"system" | "toast" | "denied"> {
  const { settings, setPending } = useNotifyStore.getState();
  const focused = await isAppFocused();
  const channel = force ? "system" : deliveryChannel(focused, settings);
  if (channel === "toast") {
    useToastStore.getState().addToast(`${notification.title} — ${notification.body}`, "info");
    return "toast";
  }
  if (!(await ensureNotificationPermission())) return "denied";
  sendNotification({ title: notification.title, body: notification.body });
  // 앱이 앞에 있을 때 보낸 알림은 포커스 이동으로 누른 것을 가릴 수 없다. 기억하지 않는다.
  if (!focused) setPending(notification.target ? { target: notification.target, sentAt: Date.now() } : null);
  return "system";
}

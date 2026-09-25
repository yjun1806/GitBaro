import { useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSettings } from "@/api/commands";
import { useNotifyStore } from "@/stores/notify";
import { useRepositoryStore } from "@/stores/repository";
import { isNotifyNeeded } from "@/lib/notify/repo-override";
import { notificationSettingsOf, targetToOpenOnFocus } from "@/lib/notify/target";
import { openNotificationTarget } from "@/lib/notify/open-target";
import { useCommitNotifications } from "./useCommitNotifications";
import { useCiFailureNotifications } from "./useCiFailureNotifications";

/**
 * macOS 알림(새 커밋, CI 실패). `MainLayout`에서 한 번 마운트한다.
 *
 * 알림 플러그인은 데스크톱에서 알림을 누른 것을 앱에 알려 주지 않는다. macOS 는 알림을 누르면 앱을
 * 앞으로 가져오므로, 뒤에 있을 때 보낸 마지막 알림 뒤로 창이 처음 포커스를 얻으면 그 대상을 연다
 * (`targetToOpenOnFocus`, 5분 안). 알림 없이 창을 앞으로 가져와도 그 5분 안이면 같은 곳이 열린다.
 */
export function useNotifications(): void {
  const settings = useNotifyStore((s) => s.settings);
  const setSettings = useNotifyStore((s) => s.setSettings);

  useEffect(() => {
    getSettings()
      .then((saved) => setSettings(notificationSettingsOf(saved.notifications)))
      .catch(() => {
        /* 기본값(새 커밋·CI 실패 알림 켬)으로 둔다 */
      });
  }, [setSettings]);

  // 앱 설정을 꺼도 알림을 켠 저장소가 있으면 감시는 돌아야 한다(저장소 설정 › 알림).
  const repos = useRepositoryStore((s) => s.repos);
  const repoPrefs = useRepositoryStore((s) => s.repoPrefs);
  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  useCommitNotifications(isNotifyNeeded(settings, repoPrefs, repoPaths, "newCommits"));
  useCiFailureNotifications(isNotifyNeeded(settings, repoPrefs, repoPaths, "ciFailures"));

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        const { pending, setPending } = useNotifyStore.getState();
        const target = targetToOpenOnFocus(pending, Date.now());
        if (pending) setPending(null);
        if (target) openNotificationTarget(target);
      })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 포커스를 못 받으면 알림을 눌러도 앱만 앞으로 온다 */
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
}

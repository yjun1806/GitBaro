import { create } from "zustand";
import type { NotificationSettings } from "@/types";
import { DEFAULT_NOTIFICATION_SETTINGS, type PendingTarget } from "@/lib/notify/target";

interface NotifyState {
  /** 설정 파일에서 읽은 알림 설정. 설정 화면에서 바꾸면 여기도 바꾼다. */
  settings: NotificationSettings;
  /** 보낸 시스템 알림 중 아직 열지 않은 마지막 것(`targetToOpenOnFocus`). */
  pending: PendingTarget | null;
  setSettings: (settings: NotificationSettings) => void;
  setPending: (pending: PendingTarget | null) => void;
}

/** 알림 설정과 마지막 알림. 저장하지 않는다 — 설정은 설정 파일이 원본이다. */
export const useNotifyStore = create<NotifyState>()((set) => ({
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  pending: null,
  setSettings: (settings) => set({ settings }),
  setPending: (pending) => set({ pending }),
}));

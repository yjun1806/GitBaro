import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import { AUTO_SYNC_INTERVALS, AUTO_SYNC_MODES, DEFAULT_AUTO_SYNC } from "@/lib/auto-sync";
import type { AutoSyncSetting } from "@/types";

/** diff 코드 글자 크기(px) 범위. */
export const CODE_FONT_SIZES: readonly number[] = [11, 12, 13, 14, 15];
export const DEFAULT_CODE_FONT_SIZE = 12;

/** 사이드바가 저장소를 「조용한 저장소」로 접기까지 기다리는 시간(분). */
export const QUIET_MINUTES_OPTIONS: readonly number[] = [5, 10, 30, 60];
export const DEFAULT_QUIET_MINUTES = 10;

/**
 * 이 기기에만 두는 앱 설정. 설정 파일(`settings.json`, 백엔드)에 둘 필요가 없는 화면 동작만 담는다.
 */
export interface Preferences {
  /** 따로 정하지 않은 저장소의 원격 자동 최신화. */
  defaultAutoSync: AutoSyncSetting;
  /** diff 코드 글자 크기(px). */
  codeFontSize: number;
  /** 사이드바: 이 시간(분) 동안 변화가 없으면 조용한 저장소로 본다. */
  quietMinutes: number;
  /** 사이드바: 조용한 저장소를 계정 맨 아래 한 줄로 접는다. 끄면 다른 저장소와 같이 늘어놓는다. */
  collapseQuietRepos: boolean;
  /** 새 워크트리를 만들 기본 폴더. null이면 저장소 폴더 옆. */
  worktreeParentDir: string | null;
}

interface PreferencesState extends Preferences {
  setPreferences: (patch: Partial<Preferences>) => void;
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultAutoSync: DEFAULT_AUTO_SYNC,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  quietMinutes: DEFAULT_QUIET_MINUTES,
  collapseQuietRepos: true,
  worktreeParentDir: null,
};

export const PREFERENCES_STORAGE_KEY = "gitbaro-prefs";

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function sanitizeAutoSync(value: unknown): AutoSyncSetting | undefined {
  if (!isPlainRecord(value)) return undefined;
  const mode = AUTO_SYNC_MODES.find((m) => m === value.mode);
  const intervalMinutes = AUTO_SYNC_INTERVALS.find((m) => m === value.intervalMinutes);
  return mode && intervalMinutes ? { mode, intervalMinutes } : undefined;
}

/** 저장값에서 모양이 맞는 필드만 남긴다. 깨진 필드는 빼서 기본값을 쓰게 한다. */
export function sanitizePreferences(persisted: unknown): Partial<Preferences> {
  if (!isPlainRecord(persisted)) return {};
  const out: Partial<Preferences> = {};
  const autoSync = sanitizeAutoSync(persisted.defaultAutoSync);
  if (autoSync) out.defaultAutoSync = autoSync;
  if (typeof persisted.codeFontSize === "number" && CODE_FONT_SIZES.includes(persisted.codeFontSize)) {
    out.codeFontSize = persisted.codeFontSize;
  }
  if (typeof persisted.quietMinutes === "number" && QUIET_MINUTES_OPTIONS.includes(persisted.quietMinutes)) {
    out.quietMinutes = persisted.quietMinutes;
  }
  if (typeof persisted.collapseQuietRepos === "boolean") out.collapseQuietRepos = persisted.collapseQuietRepos;
  if (persisted.worktreeParentDir === null) out.worktreeParentDir = null;
  if (typeof persisted.worktreeParentDir === "string" && persisted.worktreeParentDir.trim()) {
    out.worktreeParentDir = persisted.worktreeParentDir.trim();
  }
  return out;
}

/**
 * 저장 형식 버전. 새로 만든 저장소라 0(zustand 기본값)이다. 필드를 더할 때는 버전을 올리지 않고
 * `sanitizePreferences`에서 없으면 기본값을 쓴다.
 */
export const PREFERENCES_STORAGE_VERSION = 0;

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      // 모양이 틀린 값은 버리고 지금 값을 둔다.
      setPreferences: (patch) => set(() => sanitizePreferences(patch)),
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      version: PREFERENCES_STORAGE_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      migrate: (persisted) => persisted as Preferences,
      merge: (persisted, current) => ({ ...current, ...sanitizePreferences(persisted) }),
      partialize: (state): Preferences => pickPreferences(state),
    },
  ),
);

function pickPreferences(state: Preferences): Preferences {
  return {
    defaultAutoSync: state.defaultAutoSync,
    codeFontSize: state.codeFontSize,
    quietMinutes: state.quietMinutes,
    collapseQuietRepos: state.collapseQuietRepos,
    worktreeParentDir: state.worktreeParentDir,
  };
}

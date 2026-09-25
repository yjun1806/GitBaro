import type { ActivityEvent, FsChangePayload } from "@/types";

/** 백엔드가 보내는 창 이벤트 이름. 문자열을 흩어 쓰지 않고 여기서 가져다 쓴다. */
export const TAURI_EVENTS = {
  /** 감시 중인 경로의 파일이 바뀌었다(작업 트리 또는 git 동작, `kind`로 구분). */
  repoActivity: "repo:activity",
  /** 지금 연 저장소의 작업 트리가 바뀌었다. */
  fsChange: "fs:change",
  /** 지금 연 저장소의 git 폴더(HEAD·index·refs 등)가 바뀌었다. */
  fsGitDirChange: "fs:git-dir-change",
} as const;

/** 이벤트 이름 → 실어 오는 값. */
export interface TauriEventPayloads {
  "repo:activity": ActivityEvent;
  "fs:change": FsChangePayload;
  "fs:git-dir-change": FsChangePayload;
}

export type TauriEventName = keyof TauriEventPayloads;

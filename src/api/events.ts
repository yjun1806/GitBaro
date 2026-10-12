import type {
  ActivityEvent,
  FsChangePayload,
  GitCommandCompletePayload,
  GitCommandProgressPayload,
  GitCommandStartPayload,
} from "@/types";

/** 백엔드가 보내는 창 이벤트 이름. 문자열을 흩어 쓰지 않고 여기서 가져다 쓴다. */
export const TAURI_EVENTS = {
  /** 감시 중인 경로의 파일이 바뀌었다(작업 트리 또는 git 동작, `kind`로 구분). */
  repoActivity: "repo:activity",
  /** 지금 연 저장소의 작업 트리가 바뀌었다. */
  fsChange: "fs:change",
  /** 지금 연 저장소의 git 폴더(HEAD·index·refs 등)가 바뀌었다. */
  fsGitDirChange: "fs:git-dir-change",
  /** git 명령이 시작됐다(활동 기록). */
  gitCommandStart: "git:command-start",
  /** git 명령이 끝났다. */
  gitCommandComplete: "git:command-complete",
  /** 오래 걸리는 git 명령의 진행 상황. */
  gitCommandProgress: "git:command-progress",
} as const;

/** 이벤트 이름 → 실어 오는 값. */
export interface TauriEventPayloads {
  "repo:activity": ActivityEvent;
  "fs:change": FsChangePayload;
  "fs:git-dir-change": FsChangePayload;
  "git:command-start": GitCommandStartPayload;
  "git:command-complete": GitCommandCompletePayload;
  "git:command-progress": GitCommandProgressPayload;
}

export type TauriEventName = keyof TauriEventPayloads;

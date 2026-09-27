import { createContext, useContext, type ReactNode } from "react";
import type { FileStatus } from "@/types";

/** 크게 보는 diff 옆 파일 목록의 행 하나. 원래 목록의 행을 그대로 옮긴 것이다. */
export interface MaximizedFileItem {
  /** 원래 목록 안에서 이 행을 가리키는 값(스테이징 쪽·저장소까지 구분). */
  key: string;
  path: string;
  status: FileStatus;
  additions?: number | null;
  deletions?: number | null;
  /** 원래 목록의 묶음(스테이징됨·저장소 이름 등). 바뀌는 자리에 묶음 이름을 한 줄 넣는다. */
  group?: string;
}

/**
 * diff를 연 목록(작업 중인 변경, 커밋의 파일 …)을 크게 보기에서도 쓰게 넘기는 값.
 * 새로 조회하지 않는다 — 원래 목록의 데이터와 선택을 그대로 쓴다.
 */
export interface MaximizedFiles {
  items: MaximizedFileItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 행 우클릭. 원래 목록의 메뉴를 그대로 연다. */
  onContextMenu?: (key: string, e: React.MouseEvent) => void;
  /** 행 더블클릭. 원래 목록과 같은 동작(편집기에서 열기)을 그대로 부른다. */
  onDoubleClick?: (key: string) => void;
}

/** 지금 diff를 감싼 `ListDiffSplit`이 크게 보기용 파일 목록을 가졌는지. diff 머리의 목록 버튼이 쓴다. */
export const MaximizedFilesContext = createContext(false);

export function useHasMaximizedFiles(): boolean {
  return useContext(MaximizedFilesContext);
}

/**
 * 크게 보는 동안 diff 카드 맨 위 머리 줄(`MaximizedOriginHeader`)이 보일 「어디서 왔는지」. 이 diff가
 * 무엇의 것인지(커밋·따라가는 중인 작업 중인 변경·스태시·PR·올릴 내용·파일별 보기) 한 줄로 말한다.
 * 부르는 화면이 이미 가진 값으로 만든다 — 새로 조회하지 않는다.
 */
export interface MaximizedOrigin {
  kind: "working" | "follow" | "commit" | "stash" | "range" | "pr" | "fileTouches";
  /** 출처를 구체화하는 것(SHA는 `Code`, 브랜치·워크트리는 `RefLabel`, PR은 「#42」, 따라가는 중이면 `FollowBadge`도). */
  label: ReactNode;
  /** 제목(커밋 요약, PR 제목) 한 줄. 제목이랄 게 없는 출처(따라가는 중, 올릴 내용)는 비운다. */
  title?: string;
  /** 보조 정보(작성자 · 시각 · 상태 같은 것) 한 줄. */
  meta?: string;
}

/** 지금 diff를 감싼 `ListDiffSplit`이 크게 보기 머리 줄(`origin`)을 가졌는지. `DiffHeader`의 축소 아이콘이 쓴다. */
export const MaximizedOriginContext = createContext(false);

export function useHasMaximizedOrigin(): boolean {
  return useContext(MaximizedOriginContext);
}

/** 경로를 폴더와 파일 이름으로 나눈다. */
export function splitFilePath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at === -1 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

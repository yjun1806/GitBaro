import { createContext, useContext } from "react";
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
}

/** 지금 diff를 감싼 `ListDiffSplit`이 크게 보기용 파일 목록을 가졌는지. diff 머리의 목록 버튼이 쓴다. */
export const MaximizedFilesContext = createContext(false);

export function useHasMaximizedFiles(): boolean {
  return useContext(MaximizedFilesContext);
}

/** 경로를 폴더와 파일 이름으로 나눈다. */
export function splitFilePath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at === -1 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

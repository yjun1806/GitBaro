import type { StateStorage } from "zustand/middleware";

/**
 * zustand persist가 쓰는 localStorage 래퍼.
 *
 * persist 미들웨어는 `setItem` 실패를 잡지 않고 그대로 던진다
 * (zustand/esm/middleware.mjs의 `api.setState`). 그래서 localStorage 쿼터가 차면
 * `addRepo()` 같은 스토어 액션 호출 자체가 예외를 던지고, 호출부의 그 다음 줄
 * (다이얼로그 닫기, 화면 전환)이 통째로 실행되지 않는다. 사용자에게는 "버튼 먹통"으로 보인다.
 *
 * 이 래퍼는 저장 실패를 앱 로직에서 분리한다. 저장은 실패하되 UI는 계속 동작하고,
 * 실패 사실은 리스너를 통해 사용자에게 전달된다.
 */

type StorageFailureListener = (key: string) => void;

const listeners = new Set<StorageFailureListener>();

/**
 * 쿼터가 찬 상태에서는 상태가 바뀔 때마다 저장이 실패한다. 억제하지 않으면
 * 알림이 초당 수십 개 발생하므로 세션당 한 번만 알린다.
 */
let alreadyNotified = false;

/** 저장 실패를 구독한다. 반환된 함수를 호출하면 구독이 해제된다. */
export function onStorageFailure(listener: StorageFailureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 모듈 전역 상태(구독자 + 알림 억제)를 초기화한다. 테스트 격리용. */
export function resetSafeStorageState(): void {
  listeners.clear();
  alreadyNotified = false;
}

function notifyFailure(key: string): void {
  if (alreadyNotified) return;
  alreadyNotified = true;

  for (const listener of listeners) {
    try {
      listener(key);
    } catch {
      // 알림 실패가 저장 경로로 새어나가면 애초에 막으려던 문제가 그대로 재현된다.
    }
  }
}

export function createSafeStorage(
  backing: Storage = window.localStorage,
): StateStorage {
  return {
    getItem: (name) => backing.getItem(name),

    removeItem: (name) => backing.removeItem(name),

    setItem: (name, value) => {
      try {
        backing.setItem(name, value);
      } catch {
        // 쿼터 초과든 저장소 비활성화든, 저장 실패가 앱 흐름을 끊게 두지 않는다.
        notifyFailure(name);
      }
    },
  };
}

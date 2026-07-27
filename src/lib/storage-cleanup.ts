/**
 * 부팅 시 1회 도는 localStorage 정리.
 *
 * 활동 로그에는 오랫동안 개수 상한이 없었고 3분 주기 백그라운드 fetch가 저장소 수만큼
 * 기록을 남겼다. 그 결과 5 MiB인 origin 쿼터를 로그 하나가 99.7%(8,586건 / 5.2MB)까지
 * 채웠고, 다른 스토어의 저장이 전부 실패했다(저장소 추가 불가).
 *
 * 상한이 적용된 뒤에도 이미 비대해진 데이터는 저절로 줄어들지 않는다. 부팅 때마다
 * 크기를 확인해 임계값을 넘으면 걷어낸다. 정상 크기에서는 아무 일도 하지 않으므로
 * 몇 번을 실행해도 안전하다.
 */

export const ACTIVITY_LOG_KEY = "gitbaro-activity-log";

/**
 * 활동 로그가 차지해도 되는 최대 문자 수. 1,000건 상한이 걸린 로그는 60만 자
 * 안팎이므로 정상 상태에서는 걸리지 않는다. 5 MiB 쿼터의 30% 수준으로, 나머지
 * 스토어에 충분한 여유를 남긴다.
 */
export const MAX_ACTIVITY_LOG_CHARS = 1_500_000;

/** 로그를 걷어냈으면 true. */
export function purgeOversizedActivityLog(storage: Storage): boolean {
  try {
    const raw = storage.getItem(ACTIVITY_LOG_KEY);
    if (raw === null || raw.length <= MAX_ACTIVITY_LOG_CHARS) {
      return false;
    }

    storage.removeItem(ACTIVITY_LOG_KEY);
    return true;
  } catch {
    // 부팅 경로다. 저장소를 못 읽든 못 지우든 앱 시작을 막아서는 안 된다.
    return false;
  }
}

// main.tsx가 App보다 먼저 이 모듈을 import한다. 스토어가 hydrate되기 전에 실행되어야
// 하므로 모듈 평가 시점에 바로 돈다.
if (typeof window !== "undefined") {
  purgeOversizedActivityLog(window.localStorage);
}

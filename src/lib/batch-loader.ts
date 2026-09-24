/**
 * 같은 순간에 들어온 요청을 모아 한 번에 묻는 로더. 캐시는 키마다 따로 두면서(React Query
 * 쿼리 하나 = 키 하나) 백엔드 호출은 묶고 싶을 때 쓴다. 요청은 `group`(예: 저장소 경로)별로
 * 모이고, 한 번에 `maxBatch`개까지 `fetchMany`로 넘어간다. 응답에 없는 키는 `undefined`로 끝난다.
 */
export function createBatchLoader<T>(
  fetchMany: (group: string, keys: string[]) => Promise<ReadonlyMap<string, T>>,
  maxBatch: number,
): (group: string, key: string) => Promise<T | undefined> {
  interface Waiter {
    resolve: (value: T | undefined) => void;
    reject: (reason: unknown) => void;
  }
  const pending = new Map<string, Map<string, Waiter[]>>();

  const flush = (group: string) => {
    const waitersByKey = pending.get(group);
    pending.delete(group);
    if (!waitersByKey) return;
    const keys = [...waitersByKey.keys()];
    for (let i = 0; i < keys.length; i += maxBatch) {
      const chunk = keys.slice(i, i + maxBatch);
      fetchMany(group, chunk).then(
        (result) => chunk.forEach((k) => waitersByKey.get(k)?.forEach((w) => w.resolve(result.get(k)))),
        (err: unknown) => chunk.forEach((k) => waitersByKey.get(k)?.forEach((w) => w.reject(err))),
      );
    }
  };

  return (group, key) =>
    new Promise<T | undefined>((resolve, reject) => {
      let waitersByKey = pending.get(group);
      if (!waitersByKey) {
        waitersByKey = new Map();
        pending.set(group, waitersByKey);
        // 한 번의 렌더·무효화에서 시작된 쿼리들이 모두 줄을 선 뒤에 묻는다.
        setTimeout(() => flush(group), 0);
      }
      waitersByKey.set(key, [...(waitersByKey.get(key) ?? []), { resolve, reject }]);
    });
}

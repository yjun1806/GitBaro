/**
 * 동시에 `max`개까지만 돌리는 제한기. 넘치는 작업은 줄을 서 있다가 앞 작업이 끝나면(성공이든 실패든) 시작한다.
 * 저장소가 많을 때 GitHub 요청이 한꺼번에 몰리지 않게 한다.
 */
export function createConcurrencyLimit(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const queue: (() => void)[] = [];
  const release = () => {
    running -= 1;
    queue.shift()?.();
  };
  return <T,>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        running += 1;
        task().then(resolve, reject).finally(release);
      };
      if (running < max) start();
      else queue.push(start);
    });
}

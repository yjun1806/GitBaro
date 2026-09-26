/**
 * 방금 바뀐 자리를 한 번 비추는 막(따라가기). 작업 중 색의 옅은 막(`--live-soft`)이 잠깐 덮였다가
 * 걷힌다(`animate-focus-flash`). 기본 투명도가 0이라 끝나면 투명해져 아래의 남는 표시(diff 줄의 조용한
 * 바탕과 주황 줄 번호)만 보인다. 흐려지기만 하는 움직임이라 「동작 줄이기」에서도 그대로 돈다.
 *
 * 부모가 `relative isolate`(또는 같은 인라인 스타일)여야 한다 — 막은 부모의 바탕 위, 글자 아래에 깔린다.
 * 같은 자리를 다시 비추려면 `key`를 바꿔 새로 마운트한다. 왼쪽 세로 막대 같은 표시는 두지 않는다.
 */
export function FocusFlash({ testId }: { testId?: string }) {
  return (
    <span
      aria-hidden="true"
      data-focus-flash=""
      data-testid={testId}
      className="pointer-events-none absolute inset-0 -z-10 bg-(--live-soft) opacity-0 animate-focus-flash"
    />
  );
}

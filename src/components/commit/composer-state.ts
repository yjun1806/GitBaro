/**
 * 커밋하지 않은 변경이 하나도 없으면 커밋 입력을 접고 「변경 없음」만 보여 준다. 다만 병합·되돌리기가
 * 멈춰 있으면(merge 상태) 파일이 없어도 커밋으로 마무리할 수 있어야 하므로 접지 않는다.
 * 변경 수를 아직 모르면(null) 접지 않는다(불러오는 동안 입력이 사라졌다 나타나지 않게).
 */
export function isComposerCollapsed(entryCount: number | null, merging: boolean): boolean {
  return entryCount === 0 && !merging;
}

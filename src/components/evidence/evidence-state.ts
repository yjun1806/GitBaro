import type { TestEvidence, TestEvidenceStatus } from "@/types";

// V11 / spec P7 — "증거는 아티팩트에 붙어 다녀야 한다".
//
// 테스트를 돌렸다는 사실 자체는 증거가 아니다. **어떤 워킹트리 상태에서** 돌았는지가
// 증거다. 그래서 백엔드는 실행 결과를 트리 해시에 결합해 기록하고, 트리가 바뀌면
// 그 증거는 자동으로 만료된다.
//
// 이 파일은 백엔드가 준 `TestEvidenceStatus`를 화면이 그릴 수 있는 **한 가지 상태**로
// 접는 순수 로직만 담는다. 렌더링은 `TestEvidenceBadge.tsx`가 한다.

/**
 * 배지가 그릴 수 있는 상태는 정확히 셋뿐이다. 넷째("괜찮음")는 존재하지 않는다 —
 * 통과한 증거조차 "이 트리에서 이 명령이 통과했다"는 사실일 뿐, 안전 보증이 아니다.
 */
export type EvidenceDisplayState =
  | { kind: "neverRun" }
  | { kind: "stale"; passed: boolean; changedFiles: number | null; evidence: TestEvidence }
  | { kind: "fresh"; passed: boolean; evidence: TestEvidence };

/**
 * 기록이 없으면 무조건 `neverRun`이다. `freshness`가 fresh라고 말해도 보여줄 증거
 * 본문이 없으면 그렇게 렌더하지 않는다 — 근거 없는 "통과" 표시가 이 기능의 가장 나쁜
 * 실패 모드이기 때문이다.
 */
export function deriveEvidenceState(
  status: TestEvidenceStatus | null | undefined,
): EvidenceDisplayState {
  const evidence = status?.evidence ?? null;
  if (!status || !evidence) return { kind: "neverRun" };

  switch (status.freshness.type) {
    case "fresh":
      return { kind: "fresh", passed: evidence.passed, evidence };
    case "stale":
      return {
        kind: "stale",
        passed: evidence.passed,
        changedFiles: status.freshness.changedFiles,
        evidence,
      };
    case "absent":
      return { kind: "neverRun" };
  }
}

export type EvidenceTone = "success" | "warning" | "danger";

/**
 * 만료된 통과 증거는 경고지 실패가 아니다. 반대로 **기록된 실패는 만료돼도 실패**로
 * 보여준다 — 트리가 바뀌었다는 사실이 그 실패를 없던 일로 만들지는 않는다.
 */
export function evidenceTone(state: EvidenceDisplayState): EvidenceTone {
  if (state.kind === "neverRun") return "warning";
  if (!state.passed) return "danger";
  return state.kind === "fresh" ? "success" : "warning";
}

export const EVIDENCE_TONE_CLASS: Record<EvidenceTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * 실행할 명령을 정한다. 우선순위: 호출자가 아는 명령 → 마지막으로 실제 실행된 명령.
 * 둘 다 없으면 `null`이고, 그때 UI는 "저장소에서 자동으로 찾는다"고 **말한 뒤**
 * 빈 문자열을 보낸다(백엔드 `resolve_test_command`가 매니페스트에서 탐지한다).
 * 어떤 경로로도 에이전트가 만든 텍스트가 명령이 되지 않는다.
 */
export function resolveRunCommand(
  detected: string | null | undefined,
  evidence: TestEvidence | null,
): string | null {
  const explicit = detected?.trim();
  if (explicit) return explicit;
  const previous = evidence?.command.trim();
  if (previous) return previous;
  return null;
}

/** `verify.evidence.duration`에 넣을 초 단위 문자열. */
export function formatDurationSeconds(durationMs: number): string {
  return (Math.max(0, durationMs) / 1000).toFixed(1);
}

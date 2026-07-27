import { describe, expect, it } from "vitest";
import type { TestEvidence, TestEvidenceStatus } from "@/types";
import {
  EVIDENCE_TONE_CLASS,
  deriveEvidenceState,
  evidenceTone,
  formatDurationSeconds,
  resolveRunCommand,
} from "../evidence-state";

function makeEvidence(overrides: Partial<TestEvidence> = {}): TestEvidence {
  return {
    worktreeHash: "a".repeat(40),
    manifest: ["HEAD\t" + "b".repeat(40)],
    command: "pnpm test",
    exitCode: 0,
    passed: true,
    ranAt: 1_700_000_000_000,
    durationMs: 4_200,
    outputTail: "",
    ...overrides,
  };
}

function makeStatus(overrides: Partial<TestEvidenceStatus> = {}): TestEvidenceStatus {
  return {
    evidence: makeEvidence(),
    freshness: { type: "fresh" },
    currentWorktreeHash: "a".repeat(40),
    ...overrides,
  };
}

describe("deriveEvidenceState", () => {
  it("상태가 없으면 미실행이다", () => {
    expect(deriveEvidenceState(undefined)).toEqual({ kind: "neverRun" });
    expect(deriveEvidenceState(null)).toEqual({ kind: "neverRun" });
  });

  it("freshness=absent는 미실행이다", () => {
    const state = deriveEvidenceState(
      makeStatus({ evidence: null, freshness: { type: "absent" } }),
    );
    expect(state).toEqual({ kind: "neverRun" });
  });

  it("freshness=fresh는 통과 여부와 함께 fresh로 접힌다", () => {
    const state = deriveEvidenceState(makeStatus());
    expect(state.kind).toBe("fresh");
    expect(state.kind === "fresh" && state.passed).toBe(true);
  });

  it("freshness=stale은 변경 파일 수를 함께 싣는다", () => {
    const state = deriveEvidenceState(
      makeStatus({ freshness: { type: "stale", changedFiles: 7 } }),
    );
    expect(state).toMatchObject({ kind: "stale", passed: true, changedFiles: 7 });
  });

  it("변경 파일 수를 모르는 stale은 null을 그대로 전달한다", () => {
    const state = deriveEvidenceState(
      makeStatus({ freshness: { type: "stale", changedFiles: null } }),
    );
    expect(state.kind === "stale" && state.changedFiles).toBeNull();
  });

  it("실패한 실행도 증거다 — passed=false로 보존된다", () => {
    const state = deriveEvidenceState(
      makeStatus({ evidence: makeEvidence({ passed: false, exitCode: 1 }) }),
    );
    expect(state).toMatchObject({ kind: "fresh", passed: false });
  });

  // 근거 없는 "통과" 표시가 이 기능의 최악의 실패 모드다.
  it("freshness가 fresh여도 증거 본문이 없으면 미실행으로 떨어진다", () => {
    const state = deriveEvidenceState(makeStatus({ evidence: null }));
    expect(state).toEqual({ kind: "neverRun" });
  });
});

describe("evidenceTone", () => {
  it("미실행은 경고다", () => {
    expect(evidenceTone({ kind: "neverRun" })).toBe("warning");
  });

  it("현재 트리와 일치하는 통과만 success다", () => {
    expect(evidenceTone({ kind: "fresh", passed: true, evidence: makeEvidence() })).toBe("success");
  });

  it("만료된 통과는 success가 아니라 warning이다", () => {
    expect(
      evidenceTone({ kind: "stale", passed: true, changedFiles: 3, evidence: makeEvidence() }),
    ).toBe("warning");
  });

  it("기록된 실패는 만료돼도 danger로 남는다", () => {
    const evidence = makeEvidence({ passed: false });
    expect(evidenceTone({ kind: "fresh", passed: false, evidence })).toBe("danger");
    expect(evidenceTone({ kind: "stale", passed: false, changedFiles: 1, evidence })).toBe("danger");
  });

  it("모든 tone은 시맨틱 색상 토큰으로만 매핑된다", () => {
    expect(EVIDENCE_TONE_CLASS).toEqual({
      success: "text-success",
      warning: "text-warning",
      danger: "text-danger",
    });
  });
});

describe("resolveRunCommand", () => {
  it("호출자가 준 명령이 최우선이고 앞뒤 공백을 제거한다", () => {
    expect(resolveRunCommand("  pnpm test  ", makeEvidence({ command: "cargo test" }))).toBe(
      "pnpm test",
    );
  });

  it("호출자 명령이 없으면 마지막으로 실행된 명령을 쓴다", () => {
    expect(resolveRunCommand(null, makeEvidence({ command: "cargo test" }))).toBe("cargo test");
  });

  it("공백뿐인 값은 없는 것으로 본다", () => {
    expect(resolveRunCommand("   ", makeEvidence({ command: "   " }))).toBeNull();
  });

  it("아무 근거도 없으면 null — UI가 '자동 탐지'라고 말해야 한다", () => {
    expect(resolveRunCommand(undefined, null)).toBeNull();
  });
});

describe("formatDurationSeconds", () => {
  it("밀리초를 소수 첫째 자리 초로 바꾼다", () => {
    expect(formatDurationSeconds(4_200)).toBe("4.2");
    expect(formatDurationSeconds(0)).toBe("0.0");
  });

  it("음수는 0으로 눌러 붙인다", () => {
    expect(formatDurationSeconds(-1)).toBe("0.0");
  });
});

// Per-rule importance weights (IA decision §2.4).
//
// These decide *which* rule gets to speak in the one-line risk summary when a
// commit trips several rules at the same severity. They never override
// severity — `severityRank` is compared first, always — so a single `danger`
// still beats a hundred `info`s. This table only breaks ties inside one
// severity band.
//
// Three design rules produced the numbers:
//   1. What a human demonstrably did **not** look at ranks highest
//      (V19·V22·V23 — only the session log can tell us this).
//   2. Traces of verification being *disabled* rank above code smells
//      (V2·V5·V20·V21).
//   3. `v1.structuralDiff` is last. It is the one rule whose finding is *good
//      news* — it proves what a reviewer may skip — so it must never be the
//      reason a commit is shown as risky.
//
// Planned rules carry `0`: they cannot emit findings, but they must exist here
// so `rule-weights.test.ts` can prove this table and the backend registry hold
// exactly the same 45 ids. A rule added to the registry without a weight would
// silently fall to 0 and never surface — see spec §7-①.

/** ruleId → importance, 0–100. Higher speaks first inside one severity band. */
export const RULE_IMPORTANCE: Readonly<Record<string, number>> = {
  // Verification actively defeated — the strongest "look here" signal there is.
  "v20.testFailureThenTestEdited": 98,
  "v21.hookBypassCommand": 95,
  "v11.testEvidenceFailed": 90,
  "v2.testFileDeleted": 88,
  "v4.hallucinatedDependency": 85,

  // Test coverage weakened, or the commit cannot be undone cleanly.
  "v2.testSkipAdded": 80,
  "v2.assertionRemoved": 78,
  "v5.verificationBypassed": 76,
  "v20.testsNeverRunInSession": 74,
  "v32.revertUnsafe": 70,
  "v31.tangledCommit": 68,
  "v6.scopeDrift": 66,
  "v17.invariantViolation": 64,
  "v22.unrewindableChange": 62,
  "v11.testEvidenceStale": 58,
  "v11.testEvidenceMissing": 56,
  "v12.uncoveredNewLines": 52,

  // Code-level smells. Real, but a reviewer can find these by reading.
  "v7.reinventedFunction": 48,
  "v5.emptyCatchAdded": 46,
  "v5.unsafeUnwrapAdded": 44,
  "v5.typeEscapeHatchAdded": 42,
  "v4.suspiciousNewDependency": 40,
  "v3.vacuousAssertion": 36,
  "v3.mockOnlyAssertion": 34,
  "v3.noAssertionTest": 32,
  "v3.broadExceptionAssertion": 30,

  // Session-derived attention signals. Top of the `info` band on purpose
  // (§7-⑨): "nobody read this file" is the cheapest useful thing we know.
  "v19.readLessEdit": 28,
  "v23.subagentEdit": 24,
  "v24.postCompactionEdit": 22,
  "v25.repeatedEdit": 20,

  // Deletions and reachability.
  "v10.errorHandlingDeleted": 18,
  "v10.validationDeleted": 17,
  "v10.publicExportDeleted": 16,
  "v9.blastRadius": 14,
  "v35.agentTrailerMismatch": 10,
  "v8.orphanCode": 8,
  "v3.assertionRoulette": 6,

  // Good news. Never a reason to look.
  "v1.structuralDiff": 2,

  // Planned — cannot emit findings yet.
  "v15.mutationScore": 0,
  "v16.claimMismatch": 0,
  "v18.blindReviewMode": 0,
  "v26.promptScopeDrift": 0,
  "v27.staleRulesInjected": 0,
  "v28.hookCollector": 0,
  "v36.subCommitBisect": 0,
};

/**
 * Unknown ids weigh `0` — a rule the frontend cannot explain must not outrank
 * one it can. It still gets ranked by severity and count, so it is never
 * dropped, only pushed behind the rules we have words for.
 */
export function ruleImportance(ruleId: string): number {
  return RULE_IMPORTANCE[ruleId] ?? 0;
}

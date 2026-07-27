# AI 산출물 검증 UX — 최종 IA 결정서

> **이 문서의 지위**: 교정 패스(corrective pass)의 단일 진실 원천. 4개 병렬 빌드 에이전트는
> 이 문서의 §6 파일 소유권 표를 따르고, 표에 없는 파일은 건드리지 않는다.
>
> **선행 문서**: `docs/verify-contract.md` (백엔드 계약), `docs/verify-treesitter-design.md`,
> `GitBaro/docs/local/ai-output-verification-report.md` (원 리서치 — P5·P6·§7-①·§7-②).
>
> **백엔드는 동결**이다. `src-tauri/**`는 타입과 커맨드 시그니처를 **읽기 위해서만** 연다.

---

## 0. 이 패스가 존재하는 이유

이전 패스는 45개 룰과 118개 커맨드를 정확히 구현했고, UI로는 **못 쓸 물건**을 만들었다.
사용자 판정:

> "탭이 5개가 되면서 사이즈가 깨지는 것도 별로고, 봤을 때 도대체 뭘 봐야 하는 건지 딱 감이 안 온다."

원인은 두 가지고, 둘 다 기능 결함이 아니라 **정보 배치 결함**이다.

**원인 1 — 기능 카탈로그를 1:1로 화면에 옮겼다.**
스펙의 P6("검증 노력을 균일이 아니라 위험에 비례 배분하라")은 백엔드에서 `Severity` 필드로만
구현됐고 **UI에는 한 번도 구현되지 않았다**. 그 결과 모든 정보가 동등한 시각적 무게로,
우선순위 없이, 서사 없이 쌓였다. P6이 요구하는 나머지 절반 — *"여기는 안 봐도 된다"를
말해주는 것* — 은 화면 어디에도 없다.

**원인 2 — 세션을 5번째 형제 탭으로 만들었다.**
사이드바 기본 너비 500px에서 `Tab`은 `flex-1`이라 탭 하나가 100px가 되는데, 아이콘 + 한글
라벨 + 카운트 배지가 그 안에 안 들어간다(`components/ui/Tabs.tsx`에 truncate 없음). 그리고
스펙 V30은 세션을 **리뷰의 자연스러운 단위**라고 결론냈다 — 즉 히스토리를 *보는 방식*이지
별도의 *장소*가 아니다.

### 이번 패스의 성공 기준

1. 히스토리 탭을 열었을 때 **3초 안에** "지금 뭘 봐야 하는지" 한 줄로 읽힌다.
2. 검증 UI의 **기본 상태는 접힘**이다. 펼침은 사용자가 요청할 때만.
3. 화면에서 **없어지는 표면이 새로 생기는 표면보다 많다**.
4. §7-① 불변식이 깨지지 않는다: 빈 결과가 "안전"으로 읽히는 지점이 0곳.

---

## 1. STEP 1 — 현행 표면 인벤토리

### 1.1 마운트 지점 지도

```
Sidebar.tsx
 └ TabGroup  ← 탭 5개 (여기가 깨진다)
    ├ changes  → ChangesView
    │            ├ ReviewProgress          (staged 헤더 안, 1줄)
    │            └ TestEvidenceBadge       (커밋 박스 위, 1줄 + 접힘)
    ├ history  → HistoryView
    │            ├ ReviewQueue             (핀 고정, max-h-56 ≈ 224px)
    │            └ CommitItem[] + SessionCommitBadge
    ├ stash    → StashView
    ├ actions  → ActionsView
    └ sessions → SessionList               ← 삭제 대상 탭

ContentArea.tsx
 ├ changes  → DiffContent
 │            ├ FileReviewToggle + FindingBadge  (헤더 스트립, 1줄)
 │            └ DiffViewer
 │           + WorkingTreeVerification            (하단 스택, max-h-[40%])  ★
 ├ history  → CommitDetailView → CommitDetail
 │            └ 파일 목록 컬럼(320px) 하단에 CommitVerification (max-h-[50%]) ★
 ├ stash    → StashDetailView
 ├ actions  → ActionsDetailView
 └ sessions → SessionDetail                       (6개 패널 수직 스택)      ★

SyncZone.tsx → SyncDropdown
 └ PushGateBanner  (제목 + 칩 5개 + 문단 2개)
```

★ = 세로 공간을 크게 점유하면서 기본 펼침인 지점. 이 셋이 "뭘 봐야 할지 모르겠다"의 물리적 원인이다.

### 1.2 표면별 렌더 내용과 점유 공간

| 파일 | 렌더 내용 | 세로 점유 (기본) | 마운트 |
|---|---|---|---|
| `verify/VerificationPanel.tsx` | 헤더(제목+재검사+범위요약+생성시각 3줄) + `UncheckedSummary` + 심각도 그룹 + `FindingItem[]` | **무제한**(컨테이너 max-h에만 의존) | 3곳 |
| `verify/UncheckedSummary.tsx` | 경고색 카드: 헤더+카운트, 부분검사 줄, "왜" 문단, 사유 그룹 7개(각 접힘) | 카드 최소 **5줄**, 전개 시 수십 줄 | VerificationPanel |
| `verify/FindingItem.tsx` | 제목+심각도칩+스코프칩 / 파일링크 / message / description / 근거 토글 / ruleId | **발견 1건당 5~7줄** | VerificationPanel |
| `verify/FindingBadge.tsx` | 칩 1개 | 인라인 | ContentArea |
| `verify/CommitVerification.tsx` | VerificationPanel 래퍼 | `max-h-[50%]` | CommitDetail |
| `verify/WorkingTreeVerification.tsx` | VerificationPanel 래퍼 | `max-h-[40%]` | ContentArea |
| `verify/RiskSortToggle.tsx` | 경로/위험 정렬 토글 | — | **0곳 (죽은 코드)** |
| `verify/RuleSettings.tsx` | 45룰 전체 목록 + 토글 | 설정 화면 전용 | SettingsPanel |
| `verify/{severity,scan-scope,rules,risk-sort}.ts` | 순수 로직 | — | 다수 |
| `review/ReviewQueue.tsx` | 접이식 헤더 + 행(제목/작성자/시각/칩4개/상태/버튼) | `max-h-56` (224px) | HistoryView |
| `review/ReviewProgress.tsx` | 진행 바 + "N/M 검토" | 1줄 | ChangesView |
| `review/FileReviewToggle.tsx` | 검토 체크 | 인라인 | ContentArea |
| `review/PushGateBanner.tsx` | 제목 + 칩 ≤5 + 문단 2 | **4~5줄** | SyncDropdown |
| `review/review-model.ts` | 순수 파생 | — | ReviewQueue 외 |
| `session/SessionPanel.tsx` | 리스트+상세 합본 | — | **0곳 (죽은 코드)** |
| `session/SessionList.tsx` | 라벨 + `SessionListItem[]` | 사이드바 전체 | Sidebar |
| `session/SessionListItem.tsx` | 소스+브랜치+부분관측 / 프롬프트 2줄 / 메타 4개 | **행당 4~5줄** | SessionList |
| `session/SessionDetail.tsx` | 헤더 + 부분관측 + Prompt + FileEdits + Bash + CumulativeDiff + Findings | **패널 6개 전개** | ContentArea |
| `session/SessionCommitBadge.tsx` | 칩 1개 (`low`는 렌더 안 함) | 인라인 | HistoryView |
| `session/session-signals.ts` | 순수 로직 | — | 다수 |
| `evidence/TestEvidenceBadge.tsx` | 1줄 + 접힘 상세 | 1줄 | ChangesView |
| `evidence/CoverageGutter.tsx` | 커버리지 거터 | — | **0곳 (배럴만, 렌더 안 됨)** |
| `evidence/{evidence-state,coverage-map}.ts` | 순수 로직 | — | 배지 |

### 1.3 `stores/ui.ts` 현행

```ts
activeTab: "changes" | "history" | "stash" | "actions" | "sessions";  // 5개
```
`partialize`는 `railMode`만 영속화한다. `activeTab`은 휘발성이다.

### 1.4 인벤토리에서 나온 사실

- **죽은 코드 3개**: `RiskSortToggle`(0 마운트), `SessionPanel`(0 마운트),
  `CoverageGutter`(배럴에서만 export, 렌더 경로 없음).
- **미배선 훅 2개**: `useDependencyCheck`(V4), `useEvidenceLedger`(V33) — 훅은 있는데
  소비하는 컴포넌트가 없다.
- **미사용 export 1개**: `review-model.ts`의 `requiresDangerConfirmation` — P5 표적 마찰
  로직인데 `SyncZone`도 `SyncDropdown`도 호출하지 않는다.
- **`VerificationPanel`이 3곳에서 동일하게 펼쳐진다.** 커밋 상세·워킹트리·세션 상세가
  전부 같은 무게로 같은 것을 보여준다. 이것이 "우선순위 없음"의 코드 상 실체다.

---

## 2. STEP 2 — 한 줄 위험 요약 (이번 패스의 핵심)

### 2.1 무엇을 만드는가

`VerificationReport` 하나(+가능하면 세션 파생 findings)를 받아서, **왜 봐야 하는지**를
1~2절로 말하는 짧은 한 문장의 **데이터**를 만든다. 렌더가 아니라 데이터다 —
i18n 키와 숫자만 돌려주고 `t()`는 컴포넌트가 호출한다. 그래야 순수 함수로 테스트된다.

```
"테스트 3개 skip · 읽지 않고 수정 2파일"
"--no-verify 로 커밋됨"
"깨끗한 revert 불가 · 15개 파일"
"신호 없음 · 룰 22개 미검사"        ← 발견 0건일 때
```

### 2.2 시그니처 (확정)

파일: `src/components/verify/risk-summary.ts`

```ts
import type { Finding, Severity, VerificationReport } from "@/types";

/** 요약이 필요한 최소 입력. 커밋 리포트와 세션 리포트가 같은 모양이라 하나로 받는다. */
export type RiskSummaryInput = Pick<VerificationReport, "findings" | "unchecked">;

export interface RiskSummaryClause {
  ruleId: string;
  severity: Severity;
  /** 이 룰로 묶인 finding 개수. i18n 보간용. */
  count: number;
  /** `verify.summary.clause.<ruleId>` — `{{count}}`를 보간한다. */
  i18nKey: string;
}

export interface RiskSummary {
  /** 전체 finding 중 최고 심각도. 발견이 없으면 `null` — 이것은 "안전"이 아니다. */
  severity: Severity | null;
  /** 순위가 매겨진 0~2개 절. 비었으면 `zeroKey`를 렌더한다. */
  clauses: RiskSummaryClause[];
  /** `clauses`에 담기지 못한 **finding 개수**(룰 개수 아님). */
  overflowCount: number;
  /** 실행되지 못한 룰 수. 발견 유무와 무관하게 **항상** 렌더한다 (§7-①). */
  uncheckedCount: number;
  /** `clauses`가 비었을 때 쓸 키. 항상 이 값이며, "통과"류 키는 존재하지 않는다. */
  zeroKey: "verify.summary.noSignal" | null;
}

/**
 * 커밋 리포트(+세션 리포트)를 한 줄 위험 요약으로 접는다.
 *
 * 순수 함수다 — i18n·시각·시간에 의존하지 않는다. `session`을 주면 두 리포트의
 * finding을 합치고 `unchecked`는 **룰 id 합집합**으로 센다(중복 계상 방지).
 */
export function summarizeRisk(
  commit: RiskSummaryInput,
  session?: RiskSummaryInput | null,
): RiskSummary;
```

### 2.3 결정론적 순위 규칙

풀링된 finding을 `ruleId`로 그룹핑한 뒤, 그룹을 다음 **전순서**로 정렬한다.
동률이 남지 않으므로 결과는 입력에 대해 완전히 결정적이다.

| 우선순위 | 기준 | 방향 |
|---|---|---|
| 1 | `severityRank(severity)` (`danger` 3 > `warn` 2 > `info` 1) | 내림 |
| 2 | `RULE_IMPORTANCE[ruleId]` (§2.4 표, 미등록 id는 `0`) | 내림 |
| 3 | `count` | 내림 |
| 4 | `ruleId` 사전순 | 오름 |

> **심각도가 항상 먼저다.** 중요도 가중치는 *같은 심각도 안에서만* 순서를 바꾼다.
> `danger` 하나가 `info` 100개를 항상 이긴다. 이것이 P6의 기계적 표현이다.

그룹의 `severity`는 그 그룹 finding들의 **최대 심각도**를 쓴다(백엔드 `escalate()`로
동일 룰이 다른 심각도로 올 수 있다).

### 2.4 45개 룰 중요도 가중치 (전량 확정)

파일: `src/components/verify/rule-weights.ts`

가중치 설계 원칙 세 가지:
1. **사람이 확실히 안 본 것**이 위로 온다 (V19·V22·V23 — 세션 로그로만 알 수 있는 것).
2. **검증을 무력화한 흔적**이 코드 냄새보다 위다 (V2·V5·V20·V21).
3. **V1은 최하위다.** V1은 유일하게 *좋은 소식*인 룰이다 — "여기는 안 봐도 된다"를
   증명한다. 봐야 할 이유를 대는 문장에 절대 올라오면 안 된다.

| # | ruleId | V | 기본 심각도 | 기본 | 가중치 |
|---:|---|---|---|:--:|---:|
| 1 | `v20.testFailureThenTestEdited` | V20 | danger | on | **98** |
| 2 | `v21.hookBypassCommand` | V21 | danger | on | **95** |
| 3 | `v11.testEvidenceFailed` | V11 | danger | on | **90** |
| 4 | `v2.testFileDeleted` | V2 | danger | on | **88** |
| 5 | `v4.hallucinatedDependency` | V4 | danger | off | **85** |
| 6 | `v2.testSkipAdded` | V2 | warn | on | **80** |
| 7 | `v2.assertionRemoved` | V2 | warn | on | **78** |
| 8 | `v5.verificationBypassed` | V5 | warn | on | **76** |
| 9 | `v20.testsNeverRunInSession` | V20 | warn | on | **74** |
| 10 | `v32.revertUnsafe` | V32 | warn | on | **70** |
| 11 | `v31.tangledCommit` | V31 | warn | on | **68** |
| 12 | `v6.scopeDrift` | V6 | warn | on | **66** |
| 13 | `v17.invariantViolation` | V17 | warn | on | **64** |
| 14 | `v22.unrewindableChange` | V22 | warn | on | **62** |
| 15 | `v11.testEvidenceStale` | V11 | warn | on | **58** |
| 16 | `v11.testEvidenceMissing` | V11 | warn | on | **56** |
| 17 | `v12.uncoveredNewLines` | V12 | warn | off | **52** |
| 18 | `v7.reinventedFunction` | V7 | warn | off | **48** |
| 19 | `v5.emptyCatchAdded` | V5 | warn | on | **46** |
| 20 | `v5.unsafeUnwrapAdded` | V5 | warn | off | **44** |
| 21 | `v5.typeEscapeHatchAdded` | V5 | warn | off | **42** |
| 22 | `v4.suspiciousNewDependency` | V4 | warn | off | **40** |
| 23 | `v3.vacuousAssertion` | V3 | warn | off | **36** |
| 24 | `v3.mockOnlyAssertion` | V3 | warn | off | **34** |
| 25 | `v3.noAssertionTest` | V3 | warn | off | **32** |
| 26 | `v3.broadExceptionAssertion` | V3 | warn | off | **30** |
| 27 | `v19.readLessEdit` | V19 | info | on | **28** |
| 28 | `v23.subagentEdit` | V23 | info | on | **24** |
| 29 | `v24.postCompactionEdit` | V24 | info | off | **22** |
| 30 | `v25.repeatedEdit` | V25 | info | off | **20** |
| 31 | `v10.errorHandlingDeleted` | V10 | info | on | **18** |
| 32 | `v10.validationDeleted` | V10 | info | on | **17** |
| 33 | `v10.publicExportDeleted` | V10 | info | on | **16** |
| 34 | `v9.blastRadius` | V9 | info | on | **14** |
| 35 | `v35.agentTrailerMismatch` | V35 | info | off | **10** |
| 36 | `v8.orphanCode` | V8 | info | off | **8** |
| 37 | `v3.assertionRoulette` | V3 | info | off | **6** |
| 38 | `v1.structuralDiff` | V1 | info | on | **2** |
| 39 | `v15.mutationScore` | V15 | *planned* | — | **0** |
| 40 | `v16.claimMismatch` | V16 | *planned* | — | **0** |
| 41 | `v18.blindReviewMode` | V18 | *planned* | — | **0** |
| 42 | `v26.promptScopeDrift` | V26 | *planned* | — | **0** |
| 43 | `v27.staleRulesInjected` | V27 | *planned* | — | **0** |
| 44 | `v28.hookCollector` | V28 | *planned* | — | **0** |
| 45 | `v36.subCommitBisect` | V36 | *planned* | — | **0** |

> **레지스트리 동기화 테스트 필수.** `rule-weights.test.ts`는 이 표의 키 집합이
> `getVerifyRules()`가 돌려주는 45개 `ruleId` 집합과 **정확히 일치**함을 검증한다.
> 백엔드가 룰을 추가했는데 가중치가 없으면 조용히 `0`으로 밀려나 §7-①이 무너진다.
> 이 테스트가 그것을 막는 유일한 장치다.

### 2.5 절단 규칙 (확정)

- **최대 절 수**: `MAX_CLAUSES = 2`. 세 개부터는 문장이 아니라 목록이 된다.
- **구분자**: `" · "` (양쪽 공백 + 가운뎃점). 코드베이스 기존 관례
  (`TestEvidenceBadge.summaryLine`, `SessionCommitBadge` 툴팁)와 동일.
- **오버플로**: `overflowCount > 0`이면 마지막 절 뒤에
  `t("verify.summary.more", { count })` → `"외 3건"`을 **한 절 더** 붙인다.
  `overflowCount`는 남은 **finding 개수**지 룰 개수가 아니다.
- **미검사 카운트**: 발견 유무와 무관하게 **항상** 줄 끝에
  `t("verify.badge.unchecked", { count: uncheckedCount })` → `"미검사 22"`를 붙인다.
  이 절은 절단 대상이 아니다 — 이것이 §7-①의 마지막 방어선이다.

최종 렌더 형태:

```
[절1] · [절2] · [외 N건] · [미검사 M]
   ↑ 최대 2개    ↑ 조건부      ↑ 항상
```

### 2.6 발견 0건 텍스트 (확정 — 협상 불가)

```
key: verify.summary.noSignal
ko : "신호 없음 · 룰 {{count}}개 미검사"
en : "No signal · {{count}} rules not checked"
```

이 문자열이 지켜야 하는 것:
- **"안전"·"통과"·"클린"·"이상 없음"·체크마크·초록색을 쓰지 않는다.**
- 두 가지를 **동시에** 말한다: ① 실행된 룰이 아무것도 못 잡았다 ② 실행되지 않은 룰이 N개다.
- ①만 말하면 거짓 안심이고(§7-① 최대 위험), ②만 말하면 정보가 없다.

> 기본 설정에서 이 숫자는 **22**다(구현 38개 중 기본 on 23 / off 15, + planned 7 = 미검사 22).
> 이 불편한 숫자가 화면에 상시 떠 있는 것이 의도다.

### 2.7 절 문구 표 (`verify.summary.clause.<ruleId>`)

짧은 명사구다. 문장으로 쓰지 않는다 — 두 개가 `·`로 이어져도 읽혀야 한다.
`{{count}}`는 의미가 있을 때만 넣는다(커밋 단위 1회성 신호는 개수를 안 쓴다).

| ruleId | ko | en |
|---|---|---|
| `v20.testFailureThenTestEdited` | 테스트 실패 후 테스트를 수정함 | test failed, then test edited |
| `v21.hookBypassCommand` | 검증 훅을 우회함 | verification hook bypassed |
| `v11.testEvidenceFailed` | 마지막 테스트 실행 실패 | last test run failed |
| `v2.testFileDeleted` | 테스트 파일 {{count}}개 삭제 | {{count}} test files deleted |
| `v4.hallucinatedDependency` | 존재하지 않는 패키지 {{count}}개 | {{count}} nonexistent packages |
| `v2.testSkipAdded` | 테스트 {{count}}개 skip | {{count}} tests skipped |
| `v2.assertionRemoved` | 단언 {{count}}개 제거 | {{count}} assertions removed |
| `v5.verificationBypassed` | `--no-verify` 로 커밋됨 | committed with `--no-verify` |
| `v20.testsNeverRunInSession` | 세션 중 테스트 미실행 | tests never run in session |
| `v32.revertUnsafe` | 깨끗한 revert 불가 | cannot revert cleanly |
| `v31.tangledCommit` | 관련 없는 변경이 섞임 | unrelated changes mixed in |
| `v6.scopeDrift` | 커밋 메시지 범위 밖 파일 {{count}}개 | {{count}} files outside stated scope |
| `v17.invariantViolation` | refactor 주장과 다른 동작 변경 | behaviour changed despite `refactor:` |
| `v22.unrewindableChange` | `/rewind` 로 못 되돌림 {{count}}파일 | {{count}} files outside `/rewind` |
| `v11.testEvidenceStale` | 테스트 증거 만료 | test evidence stale |
| `v11.testEvidenceMissing` | 테스트 실행 기록 없음 | no test run recorded |
| `v12.uncoveredNewLines` | 실행 안 된 추가 라인 {{count}}줄 | {{count}} new lines never executed |
| `v7.reinventedFunction` | 기존 함수 재구현 {{count}}건 | {{count}} functions reinvented |
| `v5.emptyCatchAdded` | 빈 catch {{count}}개 | {{count}} empty catch blocks |
| `v5.unsafeUnwrapAdded` | unwrap {{count}}개 추가 | {{count}} unsafe unwraps added |
| `v5.typeEscapeHatchAdded` | 타입 우회 {{count}}개 | {{count}} type escape hatches |
| `v4.suspiciousNewDependency` | 의심스러운 새 의존성 {{count}}개 | {{count}} suspicious dependencies |
| `v3.vacuousAssertion` | 무의미한 단언 {{count}}개 | {{count}} vacuous assertions |
| `v3.mockOnlyAssertion` | mock만 검증하는 테스트 {{count}}개 | {{count}} mock-only tests |
| `v3.noAssertionTest` | 단언 없는 테스트 {{count}}개 | {{count}} tests without assertions |
| `v3.broadExceptionAssertion` | 광범위 예외 단언 {{count}}개 | {{count}} broad exception assertions |
| `v19.readLessEdit` | 읽지 않고 수정 {{count}}파일 | {{count}} files edited unread |
| `v23.subagentEdit` | 서브에이전트가 수정 {{count}}파일 | {{count}} files edited by subagent |
| `v24.postCompactionEdit` | 압축 이후 수정 {{count}}파일 | {{count}} files edited after compaction |
| `v25.repeatedEdit` | 반복 수정 {{count}}파일 | {{count}} files repeatedly re-edited |
| `v10.errorHandlingDeleted` | 에러 처리 삭제 {{count}}건 | {{count}} error handlers deleted |
| `v10.validationDeleted` | 검증 로직 삭제 {{count}}건 | {{count}} validations deleted |
| `v10.publicExportDeleted` | public export 삭제 {{count}}건 | {{count}} public exports deleted |
| `v9.blastRadius` | 시그니처 변경 미반영 호출부 {{count}}곳 | {{count}} callers not updated |
| `v35.agentTrailerMismatch` | 에이전트 트레일러 불일치 | agent trailer mismatch |
| `v8.orphanCode` | 도달 불가 코드 {{count}}건 | {{count}} unreachable definitions |
| `v3.assertionRoulette` | 이름 없는 단언 {{count}}개 | {{count}} unlabelled assertions |
| `v1.structuralDiff` | 구조 변경 없음 (포맷만) | formatting only, no structural change |

> planned 7개는 finding을 만들 수 없으므로 절 문구가 없다. 가중치 표에는 `0`으로 존재해야
> 하지만 (§2.4 동기화 테스트), i18n 키는 필요 없다.

### 2.8 데이터 소스 제약 — **읽고 넘어가지 말 것**

`CommitVerificationSummary`(= `verify_commit_range`의 반환)는 **카운트만 있고 ruleId가 없다**:

```rust
pub struct CommitVerificationSummary {
    pub commit_id: String,
    pub max_severity: Option<Severity>,
    pub danger_count: usize,
    pub warn_count: usize,
    pub info_count: usize,
    pub unchecked_count: usize,
}
```

즉 **배치 요약만으로는 "왜"를 만들 수 없다.** `summarizeRisk`는 전체
`VerificationReport`(= `verify_commit`)를 필요로 하는데, `verify_commit`은 V32가
후속 히스토리를 걷기 때문에 커밋당 비싸다.

**해결(백엔드 변경 없음) — 2단계 페치:**

1. **랭킹 단계** — `useCommitVerificationSummaries(repoPath, oids)` 1회 호출로 로드된
   히스토리 전체의 카운트를 받는다. 싸고 배치다. 이걸로 **순위만** 매긴다.
2. **설명 단계** — 상위 `DIGEST_ROWS = 5`개에 대해서만 `useCommitVerification(oid)`를
   호출해 전체 리포트를 받고 `summarizeRisk`를 돌린다. 즉 비싼 호출은 **최대 5회**.
3. 이 5개는 `["verifyCommit", repoPath, oid]` 캐시를 `CommitDetail`과 **공유**한다.
   다이제스트 행을 클릭해 상세로 들어가면 재요청이 없다.
4. 2단계가 로딩 중인 행은 심각도 점 + oid + 제목 + `verify.summary.loading`("확인 중…")로
   렌더한다. **빈 줄로 두지 않는다** — 빈 줄은 "깨끗함"으로 읽힌다.

> **백엔드에 제안(이번 패스에서는 하지 않음)**: `CommitVerificationSummary`에
> `top_rule_ids: Vec<String>`(심각도·개수 상위 2~3개)을 추가하면 2단계 페치가 사라지고
> 다이제스트 행 수 제한도 풀린다. 현재는 프론트 2단계로 충분히 동작하므로 **필수 아님**.
> 다이제스트를 5행 이상으로 넓히고 싶어지는 순간 이 변경이 필요해진다.

---

## 3. STEP 3 — 최종 IA

### 3.1 탭 (확정)

```
┌─────────────────────────────────────────┐
│ Changes 4 │ History │ Stash │ Actions   │   ← 정확히 4개
└─────────────────────────────────────────┘
```

`stores/ui.ts`:
```ts
export type ActiveTab = "changes" | "history" | "stash" | "actions";
export type HistoryViewMode = "commits" | "sessions";

activeTab: ActiveTab;                 // "sessions" 제거
historyViewMode: HistoryViewMode;     // 신규, 기본 "commits"
setHistoryViewMode: (mode: HistoryViewMode) => void;
```

`historyViewMode`는 `partialize`에 **추가하지 않는다**. 나머지 UI 상태와 동일하게 휘발성이다.

`selection.ts`의 `selectedSessionPath` / `selectSession`은 **남긴다** — 세션별 모드에서
어느 세션 그룹이 펼쳐졌는지를 그대로 쓴다.

### 3.2 History 탭 레이아웃 (확정)

```
┌─────────────────────────────────────────┐
│ [브랜치 비교 셀렉터]              (기존)  │
├─────────────────────────────────────────┤
┏━ 검토 필요 5건 ━━━━━━━━━━━━━━━━━━━━━━┓ │  ← RiskDigest (신규)
┃ 🔴 a1b2c3 feat(auth): 로그인 리팩터링  ┃ │     기본 펼침, 최대 5행
┃    테스트 3개 skip · 읽지 않고 수정 2  ┃ │     행 높이 2줄 고정
┃ 🟠 d4e5f6 fix(api): 응답 파싱          ┃ │
┃    --no-verify 로 커밋됨               ┃ │
┃ ⚪ g7h8i9 docs: README                 ┃ │
┃    신호 없음 · 룰 22개 미검사          ┃ │
┃                                        ┃ │
┃ 검사 23 / 미검사 22       [범위 보기]  ┃ │  ← 항상 존재
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
├─────────────────────────────────────────┤
│  ◉ 커밋별   ○ 세션별                     │  ← HistoryViewModeToggle (신규)
├─────────────────────────────────────────┤
│  (커밋별)  CommitItem[]         (기존)    │
│  (세션별)  SessionGroup[]        (신규)   │
└─────────────────────────────────────────┘
```

**브랜치 비교 모드에서는 다이제스트와 토글을 둘 다 숨긴다.** 브랜치를 비교하는 중에는
"내 에이전트 산출물 검토"라는 과업이 아니다.

#### RiskDigest 알고리즘 (결정론적)

1. 후보 = **미검토 커밋만** (`useReviewQueue`). 이미 검토한 커밋은 자리를 차지하지 않는다.
2. 정렬: `maxSeverity` 내림 → `dangerCount` 내림 → `warnCount` 내림 → `infoCount` 내림
   → 히스토리 인덱스 오름(최신 우선). 전순서다.
3. 상위 5개 절단. `queue.totalUnreviewed > 5`이면 헤더 카운트는 전체 수를 쓰고
   `verify.digest.truncated`로 "상위 5건만 표시"를 명시한다.
4. 각 행: 심각도 점 + `shortId` + `summary`(1줄 truncate) / `summarizeRisk` 한 줄.
5. 클릭 → `selectCommit(oid)` → `CommitDetail`이 그 커밋의 검증 상세를 연다.
6. 푸터 `검사 N / 미검사 M`은 **룰 구성**에서 온다(`useVerifyRules` → `countRuleStatuses`).
   커밋별 값이 아니라 설정의 성질이므로 커밋을 바꿔도 흔들리지 않고, 추가 IPC가 없다.
7. 큐가 비면 **컴포넌트를 통째로 숨기지 않는다.** 한 줄로 줄인다:
   `verify.digest.empty` = "미검토 커밋 없음 · 룰 22개 미검사". 헤더가 사라지면
   "다 봤다 = 안전하다"로 읽힌다.

#### 세션별 모드

- 소스: `useSessionList` **∪** `list_hook_sessions` (§4-6), `sessionId`로 중복 제거.
- 커밋 귀속: `useSessionCommitBadges`(V30). `high`/`medium`만 그룹에 넣고 `low`는 버린다
  (§7-⑧ — 오귀속은 무귀속보다 나쁘다).
- 어느 세션에도 귀속되지 않은 커밋은 맨 아래 `history.session.unlinked`
  ("세션에 연결되지 않은 커밋") 그룹으로 모은다. **버리지 않는다.**
- 그룹 헤더(3줄 고정):
  ```
  ▸ 세션 · "로그인 리팩터링 해줘"
      3 커밋 · 12 파일 · 47분
      🔴 테스트 skip 3 · 읽지않고수정 2      ← summarizeRisk(세션 리포트)
  ```
- 펼치면 소속 `CommitItem[]`이 그대로 나온다. 기존 컴포넌트를 재사용한다.
- 세션이 하나도 없으면 **토글 자체를 숨긴다**(§7-⑥ progressive enhancement).
  세션 로그는 이 기기의 선택적 아티팩트다.

### 3.3 표면별 판정 (keep / compress / relocate / delete)

| 표면 | 판정 | 근거와 지시 |
|---|---|---|
| `verify/VerificationPanel.tsx` | **COMPRESS** | 기본 상태를 **1줄 접힘**으로. 접힌 줄 = `summarizeRisk` 결과. `defaultOpen?: boolean` prop 추가(기본 `false`). 펼친 몸통은 현행 유지. 헤더 3줄(제목/범위/생성시각)을 1줄로 합치고 생성시각은 툴팁으로. |
| `verify/UncheckedSummary.tsx` | **COMPRESS + RELOCATE** | 세로 공간 최대 도둑. 경고색 카드(`border-warning/40 bg-warning/5`)를 버린다 — 미검사는 *경고*가 아니라 *범위*다. 펼친 패널 안에서는 평범한 인라인 행 1줄. 전체 목록은 다이제스트 푸터의 `[범위 보기]`가 여는 `ScanScopePopover`로 이전. |
| `verify/FindingItem.tsx` | **COMPRESS** | 현행 발견 1건당 5~7줄 → **2줄**. 1줄: 아이콘 + 제목 + `파일:줄`(클릭 시 점프). 2줄: `message`. `description`·`ruleId`·`detail`은 기존 "근거" 토글 안으로 전부 이동. 스코프 칩(`커밋 단위`/`세션 단위`)은 파일이 없을 때만. |
| `verify/CommitVerification.tsx` | **KEEP (래퍼) + RELOCATE** | 코드는 유지. 마운트를 320px 파일목록 컬럼 하단(`max-h-[50%]`)에서 **커밋 헤더 바로 아래 1줄 스트립**으로 옮긴다. |
| `verify/WorkingTreeVerification.tsx` | **KEEP (래퍼) + RELOCATE** | 코드 유지. `ContentArea`의 `max-h-[40%]` 스택 마운트를 제거하고 `ChangesView` 커밋 박스 위 1줄로. `TestEvidenceBadge` 바로 위에 붙어 "이 변경에 대해 아는 것" 2줄이 된다. |
| `verify/FindingBadge.tsx` | **KEEP** | 이미 압축적이고 이미 정직하다. 손대지 않는다. |
| `verify/severity.ts` · `scan-scope.ts` · `rules.ts` · `risk-sort.ts` | **KEEP** | 순수·테스트됨·재사용됨. `risk-sort.ts`는 `buildFileRisk`가 `useFileVerification`에서 쓰인다. |
| `verify/RiskSortToggle.tsx` | **DELETE** | 마운트 0곳. 요청되지 않은 정렬 결정을 사용자에게 하나 더 떠넘기는 컨트롤이다. 이 패스의 목적과 정반대. |
| `verify/RuleSettings.tsx` | **KEEP** | 이미 설정 화면에 있다. 45룰 전량 목록의 올바른 유일한 집. |
| `review/ReviewQueue.tsx` | **DELETE** | `RiskDigest`가 대체한다. 결정적 차이: 큐는 **최신순**, 다이제스트는 **위험순**. P6이 요구하는 것은 후자다. `review-model.ts`의 `deriveReviewQueue`는 살려서 다이제스트가 재사용한다. 마크/언마크 버튼은 `CommitDetail` 헤더로 이동 — 읽은 다음에 표시하는 것이 정직한 위치다. |
| `review/ReviewProgress.tsx` | **KEEP** | 1줄. 이미 맞다. |
| `review/FileReviewToggle.tsx` | **KEEP** | 인라인. 이미 맞다. |
| `review/PushGateBanner.tsx` | **COMPRESS** | 제목줄 + 칩만 남긴다. `verify.pushGate.displayOnly` 문단은 제목의 `title=` 툴팁으로. 발견 0건일 때의 `verify.scope.noFindings` 문단은 **삭제** — 다이제스트가 그 메시지의 주인이다. 4~5줄 → 2줄. |
| `review/review-model.ts` | **KEEP** | 순수. `requiresDangerConfirmation`은 현재 미사용 — §7 참조. |
| `session/SessionPanel.tsx` | **DELETE** | 마운트 0곳. 세션별 모드가 이 역할을 흡수한다. |
| `session/SessionList.tsx` | **DELETE (relocate)** | `history/SessionGroupList.tsx`로 대체. |
| `session/SessionListItem.tsx` | **DELETE (relocate + compress)** | `history/SessionGroupHeader.tsx`로 대체. 4~5줄 → 3줄 고정, 셋째 줄은 `summarizeRisk`. |
| `session/SessionDetail.tsx` | **COMPRESS** | 패널 6개 전개 → 헤더 + `SessionPromptAnchor`(펼침 유지) + 위험 한 줄. `SessionFileEdits`·`SessionBashCommands`·`SessionCumulativeDiff`·`SessionFindings`는 **전부 기본 접힘**. 프롬프트만 펼치는 이유: V26/P8 — 원 프롬프트가 유일한 외부 명세 앵커다. |
| `session/SessionPromptAnchor.tsx` | **KEEP** | 세션 표면에서 가장 값진 것. 손대지 않는다. |
| `session/SessionFileEdits.tsx` · `SessionBashCommands.tsx` · `SessionCumulativeDiff.tsx` | **KEEP** | 컴포넌트 자체는 그대로. 호출부에서 `<Disclosure>`로 감싼다. |
| `session/SessionFindings.tsx` | **KEEP** | 이미 `VerificationPanel`에 위임한다. 압축을 자동 상속. |
| `session/SessionCommitBadge.tsx` · `session-signals.ts` | **KEEP** | 이미 §7-⑧을 정확히 지킨다. |
| `evidence/TestEvidenceBadge.tsx` | **KEEP** | 1줄 + 접힘 + 사용자 요청 시에만 실행. 이 패스가 지향하는 형태의 모범 사례다. |
| `evidence/CoverageGutter.tsx` | **WIRE (조건부 DELETE)** | 한 번도 렌더된 적 없다. **거터는 세로 공간을 0 소모**하고 §7-③이 말한 "읽는 행위 자체의 개선"에 정확히 해당하므로 `DiffViewer`에 배선한다. 단, `DiffViewer`의 라인 모델과 맞지 않아 렌더러를 새로 만들어야 한다면 **배선하지 말고 삭제**한다. 병렬 diff 렌더러는 금지. |
| `evidence/evidence-state.ts` · `coverage-map.ts` | **KEEP** | 순수·테스트됨. |
| `layout/ContentArea.tsx` | **EDIT** | `sessions` 분기 제거, `WorkingTreeVerification` 스택 마운트 제거, `activeTab` 타입 축소. |
| `layout/Sidebar.tsx` | **EDIT** | 5번째 `Tab`과 `sessions` 분기 제거, `useSessionList` import 제거. |
| `history/HistoryView.tsx` | **EDIT** | `ReviewQueue` → `RiskDigest`, 뷰모드 토글 추가, 세션별 분기 추가. |
| `history/CommitDetail.tsx` | **EDIT** | `CommitVerification`을 파일목록 컬럼에서 커밋 헤더 아래 스트립으로 이동. 마크/언마크 버튼 추가. |
| `commit/ChangesView.tsx` | **EDIT** | `TestEvidenceBadge` 위에 `WorkingTreeVerification` 1줄 추가. |
| `toolbar/SyncDropdown.tsx` | **EDIT** | 압축된 `PushGateBanner` 반영. |
| `stores/ui.ts` | **EDIT** | §3.1 참조. |

**집계: 신규 표면 7 · 삭제 표면 6 · 압축 8 · 이동 4.**
화면에 상시 떠 있는 세로 픽셀은 히스토리 기준 약 **224px(큐) → 약 150px(다이제스트, 5행)**,
커밋 상세 기준 **컬럼 높이의 50% → 1줄**, 워킹트리 기준 **높이의 40% → 1줄**로 줄어든다.

### 3.4 §7-① 불변식 체크리스트 (모든 빌드 에이전트 공통 수용 기준)

- [ ] 전역 초록 체크마크·"안전"·"통과"·"검증됨" 문자열이 **0개**다.
- [ ] 발견 0건인 모든 지점이 미검사 카운트를 **함께** 표시한다.
- [ ] 표면이 숨겨지는 경우(`return null`)는 **선택적 아티팩트 부재**일 때뿐이다
      (세션 로그 없음, gh 없음). "발견이 없어서" 숨기는 경우는 없다.
- [ ] 다이제스트가 비어도 푸터의 `검사 N / 미검사 M`은 남는다.
- [ ] `summarizeRisk`의 `zeroKey`는 `"verify.summary.noSignal"` 하나뿐이며
      타입 수준에서 다른 값을 가질 수 없다.

---

## 4. STEP 4 — 미배선 백엔드 12개 커맨드 배치

| # | 커맨드 | 배치 결정 | 근거 |
|---:|---|---|---|
| 1 | `get_structural_diff` | **DiffViewer 안의 접기 어포던스** (뷰 모드 **아님**) | §4.1 |
| 2 | `verify_syntax` | **펼친 VerificationPanel의 "심층 검사" 버튼** — 온디맨드 | §4.2 |
| 3 | `build_symbol_index` | 설정 → 검증 → 고급 → 심볼 인덱스 | §4.3 |
| 4 | `cancel_symbol_index` | 동상, 빌드 중에만 노출 | §4.3 |
| 5 | `get_symbol_index_status` | 동상 + `verify_syntax` 버튼의 사전 안내 | §4.3 |
| 6 | `get_blast_radius` | **DEFER (배선하지 않음)** | §4.4 |
| 7 | `get_hook_status` | 설정 → 검증 → 고급 → 에이전트 훅 | §4.5 |
| 8 | `preview_hook_install` | 동상 — 설치 버튼 앞의 **필수** 모달 | §4.5 |
| 9 | `install_verify_hooks` | 동상 — 미리보기 확인 후에만 | §4.5 |
| 10 | `uninstall_verify_hooks` | 동상 | §4.5 |
| 11 | `list_hook_sessions` | **세션 소스에 합집합으로 병합** (새 UI 0) | §4.6 |
| 12 | `run_sub_commit_bisect` | **DEFER (배선하지 않음)** | §4.7 |

### 4.1 `get_structural_diff` (V1) — 최고 레버리지

스펙이 V1을 최우선이라 부른 이유는 "구조 diff 뷰"가 멋져서가 아니라
**2,800줄에 면제를 줘서 나머지 200줄을 제대로 보게 만들기** 때문이다(P6). 그러므로:

> **뷰 모드로 만들지 않는다.** 세 번째 diff 렌더링 엔진을 만들고 유지하는 비용을 치르고
> 사용자에게 "어느 모드로 볼지"라는 결정을 하나 더 떠넘긴다. 요청된 적 없다.

**대신 기존 텍스트 diff 안의 접기 바로 만든다:**

```
  42 │  export function parseResponse(raw: string) {
─────┤ ▸ 포맷 변경만 · 128줄 접힘                      [펼치기]
 171 │    if (!raw) throw new ApiError("empty");
```

- 열린 파일에 대해서만 `get_structural_diff(repoPath, oid, path, staged)` 호출.
- 결과가 "구조 변경 없음(포맷·리네임·이동만)"인 hunk 구간을 접는다. 기본 접힘.
- `StructuralOutcome`이 `Degraded`면 **아무것도 렌더하지 않는다** — 토글도 에러도 없다
  (design §5.3). 텍스트 diff가 그대로 유일한 진실이 된다.
- 접힌 것은 **언제나 펼칠 수 있다.** 숨기는 게 아니라 미루는 것이다.

### 4.2 `verify_syntax` (V1+V7+V8+V9+V17 단일 스캔)

**언제 도는가: 사용자가 버튼을 눌렀을 때만.**

커밋 선택 시 자동 실행은 금지한다 — 히스토리를 방향키로 훑으면 커밋마다 트리시터
전체 스캔이 돈다. `TestEvidenceBadge`가 이미 확립한 "요청할 때만 실행" 패턴을 그대로 쓴다.

- 위치: **펼친** `VerificationPanel` 하단의 `verify.syntax.run`("심층 검사 실행") 버튼.
  접힌 상태에서는 보이지 않는다.
- 진행: 이 커맨드에는 진행 이벤트가 없다. 버튼이 `verify.syntax.running`("심층 검사 중…")
  + 스피너로 바뀐다. 그 이상 만들지 않는다.
- 취소: **없다.** 취소 가능한 것은 심볼 인덱스뿐이고 그것은 설정에 있다.
  여기서 취소 UI를 만들면 취소할 수 없는 것에 취소 버튼을 붙이는 거짓말이 된다.
- 인덱스 없음 처리: `get_symbol_index_status`가 `ready`가 아니면 버튼 아래
  `verify.syntax.needsIndex`("심볼 인덱스가 없어 V7·V8·V9는 미검사로 남는다") +
  설정으로 가는 링크. 이 경우에도 버튼은 **동작한다** — V1·V17은 인덱스 없이 돌고,
  V7·V8·V9는 `unchecked`로 정직하게 돌아온다.
- 결과는 표시 중인 리포트에 머지한다. `checked`/`unchecked` 회계는 백엔드가
  이미 한 번만 채우므로(design §9.2) 프론트에서 다시 합치지 않는다.

### 4.3 심볼 인덱스 3종

**설정 → 검증 → 고급**의 한 행. 자동 시작 절대 금지 — §7-④가 지적한 대로 대형 저장소
첫 인덱싱이 수 분 걸리면 앱이 죽은 것으로 보인다.

```
심볼 인덱스                    상태: 없음 / 빌드 중 1,204 파일 / 준비됨 (8,431 심볼)
V7·V8·V9 검사에 필요하다. 만들지 않으면 그 룰은 미검사로 남는다.
                                          [인덱스 만들기] / [취소]
```

- `get_symbol_index_status`로 상태 폴링(빌드 중일 때만, 1초 간격).
- `build_symbol_index`는 `AppHandle`로 진행 이벤트를 emit하므로 그것을 구독한다.
- `cancel_symbol_index`는 `building`일 때만 노출.

### 4.4 `get_blast_radius` (V9) — **DEFER**

배선하지 않는다. V9는 이미 `verify_syntax`를 통해 `v9.blastRadius` finding으로
패널에 들어온다. 별도 blast-radius 패널을 만드는 것은 **"기능 하나 = 표면 하나"** —
이 패스가 되돌리려는 바로 그 실수다.

커맨드는 등록된 채 프론트 참조 0으로 남는다. 이것을 결함으로 기록하지 않는다.
V9 finding을 클릭했을 때 영향 받는 호출부 목록을 보여줄 필요가 실제로 생기면
그때 `FindingItem`의 "근거" 토글 안에서 호출한다.

### 4.5 훅 설치 4종 — 사용자 홈 디렉터리를 건드린다

`~/.claude/settings.json`을 수정하므로 **설정 화면 전용, 엄격한 옵트인, 미리보기 필수**다.

```
에이전트 훅                                        상태: 설치되지 않음
Claude Code가 무엇을 했는지 GitBaro가 직접 기록하게 한다.
세션 로그 포맷 변경에 영향받지 않는 대신, ~/.claude/settings.json 을 수정한다.
                                              [설치 내용 미리보기]
```

`[설치 내용 미리보기]` → `preview_hook_install` → **모달**이 세 가지를 그대로 보여준다:
1. `settings.json`에 추가될 **정확한** 조각
2. 설치될 스크립트 **본문 전체**
3. 로그에 기록될 **필드 목록**

모달 안에서만 `[설치]`가 활성화된다. 미리보기를 건너뛰는 경로는 존재하지 않는다.
설치 후에는 같은 행이 `[제거]`(= `uninstall_verify_hooks`)를 노출한다.

**금지**: 설정 밖 어디서도 이 기능을 광고하지 않는다. 배너·토스트·"훅을 설치하면
더 정확해집니다" 유도 문구를 만들지 않는다.

### 4.6 `list_hook_sessions` — 새 UI 0

`listSessionsForRepo`(파일 리더)와 `list_hook_sessions`(훅 로그)는 **의도적으로 같은
`SessionSummary` 모양**을 돌려준다. 그러므로 세션별 모드의 소스에서 합집합을 만든다:

```
sessions = unionBySessionId(fileSessions, hookSessions)   // 충돌 시 hook 우선
```

훅 기록을 우선하는 이유: 포맷이 안정적이고 GitBaro가 직접 쓴 것이다(V28, §7-⑥의 정공법).
훅이 설치되지 않았으면 `list_hook_sessions`는 빈 배열을 돌려주고 아무 일도 일어나지 않는다.

### 4.7 `run_sub_commit_bisect` (V36) — **DEFER**

배선하지 않는다. 이유 셋:
1. 사용자가 검증 **명령 문자열**을 직접 입력해야 한다 — 새 입력 폼.
2. 실행이 수 분 단위다 — 자체 진행/취소 모델이 필요한 새 표면.
3. 레지스트리에서 `v36.subCommitBisect`가 **`Planned`**다. 즉 이 룰은 지금
   `unchecked`에 나타나는 것이 **정확한 상태**다.

지금 배선하면 아무도 요청하지 않은 패널이 하나 더 생긴다. 미검사 목록에
"V36 커밋 내부 이등분 — 미구현"으로 남아 있는 것이 정직하고 충분하다.

---

## 5. 신규 i18n 키 (en + ko 동시 — `findings-summary` 에이전트가 일괄 투입)

§2.7 절 문구 38개(`verify.summary.clause.*`)에 더해:

| 키 | ko | en |
|---|---|---|
| `verify.summary.noSignal` | 신호 없음 · 룰 {{count}}개 미검사 | No signal · {{count}} rules not checked |
| `verify.summary.more` | 외 {{count}}건 | +{{count}} more |
| `verify.summary.loading` | 확인 중… | checking… |
| `verify.digest.title` | 검토 필요 {{count}}건 | {{count}} need review |
| `verify.digest.empty` | 미검토 커밋 없음 · 룰 {{count}}개 미검사 | Nothing unreviewed · {{count}} rules not checked |
| `verify.digest.scope` | 검사 {{checked}} / 미검사 {{unchecked}} | checked {{checked}} / not checked {{unchecked}} |
| `verify.digest.scopeOpen` | 범위 보기 | view scope |
| `verify.digest.truncated` | 상위 {{count}}건만 표시 | showing top {{count}} |
| `verify.digest.toggle` | 접기·펼치기 | collapse / expand |
| `history.viewMode.commits` | 커밋별 | by commit |
| `history.viewMode.sessions` | 세션별 | by session |
| `history.session.group` | 세션 · "{{prompt}}" | session · "{{prompt}}" |
| `history.session.stats` | {{commits}} 커밋 · {{files}} 파일 · {{duration}} | {{commits}} commits · {{files}} files · {{duration}} |
| `history.session.unlinked` | 세션에 연결되지 않은 커밋 | commits with no linked session |
| `verify.syntax.run` | 심층 검사 실행 | run deep scan |
| `verify.syntax.running` | 심층 검사 중… | deep scan running… |
| `verify.syntax.needsIndex` | 심볼 인덱스가 없어 V7·V8·V9는 미검사로 남는다 | without a symbol index, V7·V8·V9 stay unchecked |
| `verify.syntax.openSettings` | 인덱스 설정 열기 | open index settings |
| `verify.settings.advanced.title` | 고급 | Advanced |
| `verify.settings.symbolIndex.title` | 심볼 인덱스 | Symbol index |
| `verify.settings.symbolIndex.note` | V7·V8·V9 검사에 필요하다. 만들지 않으면 그 룰은 미검사로 남는다. | Required by V7·V8·V9. Without it those rules stay unchecked. |
| `verify.settings.symbolIndex.status.idle` | 없음 | none |
| `verify.settings.symbolIndex.status.building` | 빌드 중 {{count}} 파일 | building · {{count}} files |
| `verify.settings.symbolIndex.status.ready` | 준비됨 · 심볼 {{count}}개 | ready · {{count}} symbols |
| `verify.settings.symbolIndex.build` | 인덱스 만들기 | build index |
| `verify.settings.symbolIndex.cancel` | 취소 | cancel |
| `verify.settings.hooks.title` | 에이전트 훅 | Agent hooks |
| `verify.settings.hooks.note` | Claude Code가 무엇을 했는지 GitBaro가 직접 기록한다. 세션 로그 포맷 변경에 영향받지 않는 대신 ~/.claude/settings.json 을 수정한다. | GitBaro records what Claude Code did, directly. Immune to session-log format changes, but it modifies ~/.claude/settings.json. |
| `verify.settings.hooks.status.installed` | 설치됨 | installed |
| `verify.settings.hooks.status.absent` | 설치되지 않음 | not installed |
| `verify.settings.hooks.preview` | 설치 내용 미리보기 | preview what gets installed |
| `verify.settings.hooks.install` | 설치 | install |
| `verify.settings.hooks.uninstall` | 제거 | remove |
| `verify.settings.hooks.dialog.title` | 설치될 내용 | What will be installed |
| `verify.settings.hooks.dialog.settingsFragment` | settings.json 에 추가되는 내용 | added to settings.json |
| `verify.settings.hooks.dialog.script` | 설치될 스크립트 | script to be installed |
| `verify.settings.hooks.dialog.fields` | 기록되는 항목 | fields recorded |
| `verify.settings.hooks.installed` | 훅을 설치했다 | hooks installed |
| `verify.settings.hooks.removed` | 훅을 제거했다 | hooks removed |
| `verify.settings.hooks.failed` | 훅 작업에 실패했다: {{error}} | hook operation failed: {{error}} |
| `diff.structural.formattingOnly` | 포맷 변경만 · {{count}}줄 접힘 | formatting only · {{count}} lines folded |
| `diff.structural.expand` | 펼치기 | expand |
| `diff.structural.collapse` | 접기 | collapse |

---

## 6. 파일 소유권 표 — 4개 병렬 빌드 에이전트

> **규칙 1**: 표에 없는 파일은 **동결**이다. 손대야 한다고 판단되면 코드를 바꾸지 말고 보고한다.
> **규칙 2**: 한 파일은 정확히 한 에이전트가 소유한다. 아래에 중복은 없다.
> **규칙 3**: `src-tauri/**`는 전원 **읽기 전용**이다.
> **규칙 4**: **A는 1단계, B·C·D는 2단계다.** B·C·D는 A가 i18n 키를 넣은 뒤 시작한다.

### A. `findings-summary` — 1단계 (단독 선행)

| 파일 | 동작 |
|---|---|
| `src/components/verify/risk-summary.ts` | 신규 — `summarizeRisk` (§2.2) |
| `src/components/verify/rule-weights.ts` | 신규 — 45룰 가중치 표 (§2.4) |
| `src/components/verify/__tests__/risk-summary.test.ts` | 신규 |
| `src/components/verify/__tests__/rule-weights.test.ts` | 신규 — 레지스트리 45개 동기화 검증 |
| `src/i18n/locales/ko/translation.json` | **단독 소유** — §2.7 + §5 키 **전량** 투입 |
| `src/i18n/locales/en/translation.json` | **단독 소유** — 동상 |

> A는 §2.7과 §5의 키를 **하나도 빠짐없이** 넣는다. B·C·D는 로케일 파일을 **읽기만** 한다.
> 키가 빠지면 B·C·D가 멈춘다.

### B. `history-ia` — 탭 구조와 히스토리 셸

| 파일 | 동작 |
|---|---|
| `src/stores/ui.ts` | 편집 — `activeTab` 4개로, `historyViewMode` 추가 |
| `src/components/layout/Sidebar.tsx` | 편집 — 5번째 탭·`sessions` 분기 제거 |
| `src/components/layout/ContentArea.tsx` | 편집 — `sessions` 분기 제거, `WorkingTreeVerification` 스택 마운트 **제거만** |
| `src/components/history/HistoryView.tsx` | 편집 — 다이제스트·토글·세션별 분기 |
| `src/components/history/RiskDigest.tsx` | 신규 |
| `src/components/history/risk-digest-model.ts` | 신규 — 순수 랭킹 (§3.2) |
| `src/components/history/HistoryViewModeToggle.tsx` | 신규 |
| `src/components/history/SessionGroupList.tsx` | 신규 |
| `src/components/history/SessionGroupHeader.tsx` | 신규 |
| `src/components/history/session-groups.ts` | 신규 — 순수 그룹핑 |
| `src/components/history/__tests__/risk-digest-model.test.ts` | 신규 |
| `src/components/history/__tests__/session-groups.test.ts` | 신규 |
| `src/hooks/useRiskDigest.ts` | 신규 — 2단계 페치 (§2.8) |
| `src/hooks/useSessionGroups.ts` | 신규 — 파일∪훅 세션 병합 (§4.6) |
| `src/components/review/ReviewQueue.tsx` | **삭제** |
| `src/components/review/index.ts` | 편집 — `ReviewQueue` export 제거 |
| `src/components/session/SessionPanel.tsx` | **삭제** |
| `src/components/session/SessionList.tsx` | **삭제** |
| `src/components/session/SessionListItem.tsx` | **삭제** |

### C. `panel-compaction` — 패널 본문 압축

| 파일 | 동작 |
|---|---|
| `src/components/ui/Disclosure.tsx` | 신규 — 공용 접기 프리미티브 |
| `src/components/verify/VerificationPanel.tsx` | 압축 — 기본 접힘 + `defaultOpen` |
| `src/components/verify/UncheckedSummary.tsx` | 압축 — 카드 → 인라인 행 |
| `src/components/verify/ScanScopePopover.tsx` | 신규 — `[범위 보기]` 대상 |
| `src/components/verify/FindingItem.tsx` | 압축 — 5~7줄 → 2줄 |
| `src/components/verify/CommitVerification.tsx` | 편집 — `defaultOpen={false}` |
| `src/components/verify/WorkingTreeVerification.tsx` | 편집 — 동상 |
| `src/components/verify/RiskSortToggle.tsx` | **삭제** |
| `src/components/history/CommitDetail.tsx` | 편집 — 검증 스트립 이동 + 마크 버튼 |
| `src/components/commit/ChangesView.tsx` | 편집 — `WorkingTreeVerification` 1줄 **추가** |
| `src/components/session/SessionDetail.tsx` | 압축 — 4개 패널 기본 접힘 |
| `src/components/review/PushGateBanner.tsx` | 압축 — 4~5줄 → 2줄 |
| `src/components/toolbar/SyncDropdown.tsx` | 편집 — 압축 배너 반영 |

> **B/C 경계 주의**: `WorkingTreeVerification`의 **마운트 제거**는 B(`ContentArea`),
> **마운트 추가**는 C(`ChangesView`)다. 두 에이전트가 같은 파일을 열지 않는다.
> `RiskDigest`가 `[범위 보기]`로 여는 `ScanScopePopover`는 **C가 만들고 B가 소비**한다.

### D. `advanced-wiring` — 미배선 12커맨드 + diff

| 파일 | 동작 |
|---|---|
| `src/types/index.ts` | 편집 — `StructuralOutcome` `SymbolIndexStatus` `BlastRadiusEntry` `HookStatus` `HookPreview` `HookChange` 추가 |
| `src/api/verify.ts` | 편집 — invoke 래퍼 추가 |
| `src/api/queries.ts` | 편집 — `useSyntaxVerification` `useSymbolIndexStatus` `useStructuralDiff` `useHookStatus` `useHookSessions` + 뮤테이션 |
| `src/hooks/useSymbolIndex.ts` | 신규 — 상태 폴링 + 진행 이벤트 |
| `src/hooks/useStructuralDiff.ts` | 신규 |
| `src/components/settings/SettingsPanel.tsx` | 편집 — 고급 섹션 마운트 |
| `src/components/settings/VerifyAdvancedSettings.tsx` | 신규 — 심볼 인덱스 + 훅 |
| `src/components/settings/HookInstallDialog.tsx` | 신규 — 미리보기 모달 |
| `src/components/diff/DiffViewer.tsx` | 편집 — 구조 접기 바 + 커버리지 거터 |
| `src/components/diff/StructuralCollapse.tsx` | 신규 |
| `src/components/evidence/CoverageGutter.tsx` | 편집 — 배선(또는 §3.3 조건 해당 시 삭제) |

> **C/D 경계 주의**: `verify_syntax`를 호출하는 **훅은 D**가 만들고
> **버튼은 C**가 `VerificationPanel`에 놓는다. D는 `VerificationPanel`을 열지 않는다.

### 동결 파일 (누구도 편집 금지)

`src-tauri/**` 전체 · `verify/severity.ts` · `verify/scan-scope.ts` · `verify/rules.ts` ·
`verify/risk-sort.ts` · `verify/FindingBadge.tsx` · `verify/RuleSettings.tsx` ·
`review/ReviewProgress.tsx` · `review/FileReviewToggle.tsx` · `review/review-model.ts` ·
`session/SessionPromptAnchor.tsx` · `session/SessionFileEdits.tsx` ·
`session/SessionBashCommands.tsx` · `session/SessionCumulativeDiff.tsx` ·
`session/SessionFindings.tsx` · `session/SessionCommitBadge.tsx` · `session/session-signals.ts` ·
`evidence/TestEvidenceBadge.tsx` · `evidence/evidence-state.ts` · `evidence/coverage-map.ts` ·
`hooks/useFileVerification.ts` · `hooks/useSessionCommitBadges.ts` · `stores/selection.ts`

---

## 7. 이 계획의 약점 5가지 (정직하게)

1. **`summarizeRisk`의 가중치 45개는 튜닝된 값이 아니라 내 판단이다.**
   실제 저장소 데이터로 검증된 적이 없다. 상위 2절이 계속 엉뚱한 것을 고르면 다이제스트는
   ReviewQueue보다 나쁜 것이 된다 — 최신순은 최소한 예측 가능하기라도 했다.
   완화책은 §2.4 표가 한 파일에 모여 있어 재조정이 값싸다는 것뿐이다. 근본 해결은 아니다.

2. **2단계 페치는 `verify_commit`을 5번 부른다. V32는 후속 히스토리를 걷는다.**
   커밋이 많은 저장소에서 히스토리 탭을 열 때마다 5회의 히스토리 워크가 발생한다.
   `staleTime: 60_000`이 반복은 막지만 **첫 진입 지연**은 막지 못한다. 다이제스트가
   느리게 채워지면 "뭘 봐야 하는지 3초 안에"라는 성공 기준이 그대로 무너진다.
   측정 없이 `DIGEST_ROWS = 5`를 정했다 — 실측 후 3으로 줄여야 할 수 있다.

3. **세션↔커밋 귀속이 틀리면 세션별 모드는 없느니만 못하다.**
   §7-⑧이 명시한 위험이고, worktree 병렬 세션에서 실제로 발생한다. `low`를 버리는 것으로는
   `medium` 오귀속을 막지 못한다. 세션별 모드가 "내가 안 한 일"을 내 세션에 묶어 보여주면
   사용자는 이 기능 전체를 불신하게 되고, 그 불신은 다이제스트로 번진다.

4. **접기를 기본값으로 만든 것은 §7-①과 정면으로 긴장 관계다.**
   "미검사 22"를 한 줄로 압축해 넣는 순간, 그 줄은 배경 소음이 되어 **읽히지 않게 될**
   가능성이 크다. 정직한 정보가 화면에 존재하는 것과 그것이 인지되는 것은 다르다.
   나는 이 트레이드오프를 압축 쪽으로 결정했지만, 이전 패스가 실패한 이유가 "정보가
   너무 많아서"였다는 것 외에 근거가 없다. 반대 방향의 실패(아무도 미검사를 안 보게 됨)를
   측정할 계획이 이 문서에는 없다.

5. **삭제 6건 중 3건은 이전 패스가 만든 지 며칠 안 된 코드다.**
   `ReviewQueue`는 마운트되어 동작 중이고 테스트도 있다. 이것을 지우고 `RiskDigest`로
   대체하는 것은 검증된 것을 미검증인 것으로 바꾸는 일이다. `RiskDigest`가 §2.8의 2단계
   페치 때문에 ReviewQueue보다 복잡해진다는 점도 불리하다. 되돌릴 수 있게 하려면
   `deriveReviewQueue`를 반드시 남겨야 하고, 그래서 §3.3에 그렇게 적었다.

### 추가 관찰 (이번 패스 범위 밖 — 삭제하지 않고 보고만)

- `review-model.ts`의 `requiresDangerConfirmation`은 export되어 있으나 호출되지 않는다.
  P5(표적 마찰)의 유일한 구현체인데 `SyncZone`이 쓰지 않는다. 배선하면 danger 발견이
  있을 때만 push 전에 1회 확인을 띄우게 된다 — 스펙 의도에 맞지만 **이번 패스 범위가 아니다**.
- `useDependencyCheck`(V4)와 `useEvidenceLedger`(V33)는 훅만 있고 소비처가 없다.
  V4는 네트워크를 타므로 설정 옵트인이 필요하고, V33은 git notes를 쓴다. 둘 다
  §4.4·§4.7과 같은 이유로 이번에는 배선하지 않는다.
- `CommitVerificationSummary`에 `top_rule_ids`가 없어 §2.8의 2단계 페치가 필요하다.
  백엔드 동결 해제 시 최우선 후보다.

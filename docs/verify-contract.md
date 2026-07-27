# `verify` 서브시스템 계약 (Contract)

> **Status**: AUTHORITATIVE. 구현자는 이 문서를 문자 그대로 따른다.
> **Source spec**: `docs/ai-output-verification-report.md` (V-번호는 그 문서 §4 정의를 따른다)
> **Scope**: Milestone 1 + Milestone 2 + Milestone 3 일부 (V2·V3·V4·V5·V6·V10·V11·V12·V13·V19~V27·V29·V30·V31·V32·V33·V34·V35)
> **Out of scope (이번 계약 아님)**: V1(AST diff)·V7·V8·V9·V14·V15·V16·V17·V18·V28·V36 — **단, 레지스트리에는 `Planned`로 등재되어 항상 `unchecked`에 나타나야 한다** (§7-① 요구).

---

## 0. 이 계약이 강제하는 5가지 불변식

구현 중 어떤 판단이 애매하면 아래로 되돌아온다.

1. **빈 findings는 절대 "안전"을 뜻하지 않는다** (spec §7-①). 모든 `VerificationReport`는 `checked` / `unchecked`를 동시에 반환하고, 레지스트리의 모든 룰은 둘 중 **최소 한쪽에는 반드시** 등장한다. 전역 초록 체크마크 UI 금지.
2. **LLM 재질의 금지** (P1). 이 서브시스템의 모든 신호는 결정론적 정적 분석 · 파일 파싱 · 실제 프로세스 실행 결과에서만 나온다.
3. **세션 로그 파싱 실패는 에러가 아니라 기능 숨김이다** (§7-⑥). `gh` 미설치 시 기능을 숨기는 기존 패턴과 동일하게 progressive enhancement로 처리한다. 파싱 실패를 토스트로 띄우지 않는다.
4. **세션 파일 전체 로드 금지** (§7-⑦). 스트리밍 + 라인 바이트 상한 + 파일 바이트 예산 + 벽시계 예산 + 요약 캐시가 전부 필수다.
5. **차단하지 않는다** (§V34, P5). push 게이트를 포함해 모든 지점은 **표시만** 한다. 차단하면 사용자는 우회를 학습한다.

언어 범위는 **TypeScript/JavaScript + Rust로 한정**한다 (§7-⑤). 다른 언어 파일은 룰을 돌리지 않고 `unchecked`에 사유와 함께 기록한다.

---

## 1. 모듈 레이아웃

```
src-tauri/src/verify/
├── mod.rs                       # 모듈 선언 + `pub use types::*` 재수출 (그 외 로직 없음)
├── types.rs                     # §2의 공유 타입 전체. 다른 파일은 여기에 타입을 추가하지 않는다
├── registry.rs                  # 전 룰(구현·미구현 포함) 정적 테이블 + rule_id ↔ FindingKind 매핑
├── config.rs                    # 룰 on/off 영속화 (§7-② 개별 토글) — verify-rules.json 로드/저장
├── paths.rs                     # `.git/gitbaro/` 경로 해석 (worktree common-dir 처리 포함)
├── digest.rs                    # worktree_hash / diff_hash — git2 Oid 기반 콘텐츠 다이제스트
├── deps.rs                      # V4 환각 의존성: 오프라인 매니페스트·락파일 대조 우선, 레지스트리 조회는 opt-in
├── review.rs                    # V13 파일별 / V29 커밋별 검토 상태, V34 push 게이트 요약, V33 git-notes 원장
├── evidence.rs                  # V11 트리해시 결합 테스트 실행 증거, V12 lcov 파싱 및 diff 커버리지
├── hygiene.rs                   # V31 엉킴 커밋, V32 revert 안전성, V35 트레일러 파싱·교차검증
├── rules/
│   ├── mod.rs                   # 정적 diff 룰 러너: DiffContext → (findings, limits). 룰 등록 지점
│   ├── context.rs               # DiffContext / FileChange / ChangedLine 조립 (DiffOutput → 룰 입력)
│   ├── patterns.rs              # 전 룰이 공유하는 리터럴 토큰 테이블 (skip 마커·공허 단언·우회 프라그마)
│   ├── test_disabling.rs        # V2 테스트 무력화 (skip 추가 / 테스트 파일 삭제 / 단언 순감소)
│   ├── test_quality.rs          # V3 테스트 안티패턴 (공허 단언·mock 전용·단언 0개·광범위 예외·roulette)
│   ├── bypass.rs                # V5 검증 우회 흔적 (@ts-ignore·eslint-disable·as any·빈 catch·unwrap)
│   ├── scope.rs                 # V6 스코프 이탈 (conventional commit scope vs 실제 변경 경로)
│   └── deletion.rs              # V10 삭제 분류 (public export / 에러 처리 / 검증 로직 삭제 격리)
└── session/
    ├── mod.rs                   # 세션 파일 탐색(discover) + 어댑터 디스패치 + 요약 캐시 진입점
    ├── jsonl.rs                 # 예산 제한 스트리밍 JSONL 리더 (§7-⑦ 방어선). 어댑터가 공유
    ├── claude_code.rs           # Claude Code 어댑터 — ~/.claude/projects/<enc-cwd>/<uuid>.jsonl
    ├── codex.rs                 # Codex 어댑터 — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    ├── summary.rs               # 어댑터 중립 fold: 원시 이벤트 → SessionSummary (V19·V22~V25·V27)
    ├── rules.rs                 # SessionSummary → Finding (V19·V20·V21·V22·V23·V24·V26)
    └── correlate.rs             # V30 세션 ↔ 커밋 상관 (신뢰도 등급 필수, §7-⑧)

src-tauri/src/commands/
├── verify.rs                    # 정적 스캔 + 룰 설정 커맨드 (§3.1)
├── review.rs                    # 검토 상태 / push 게이트 / 원장 커맨드 (§3.2)
├── session.rs                   # 세션 커맨드 (§3.3)
└── evidence.rs                  # 테스트 증거 / 커버리지 커맨드 (§3.4)
```

**파일 크기 규칙**: 400줄 초과가 예상되면 같은 phase 소유자가 하위 디렉터리로 분할한다 (예: `hygiene.rs` → `hygiene/{tangle,revert,trailer}.rs`). 이 분할은 **사전 승인**되어 있으므로 별도 협의 없이 진행한다. 단 파일 소유 phase는 그대로 유지된다.

**의도적 관례 이탈 2건 (근거 포함)**

- `CLAUDE.md`는 "공유 타입은 `git/engine.rs`에 둔다"고 하지만, verify 타입은 git 도메인이 아니고 `engine.rs`는 통합 소유 파일이라 병렬 편집 충돌원이다. → **`verify/types.rs`에 둔다.**
- `CLAUDE.md`는 "shared 타입은 `types/index.ts`에 한 번만" / "모든 `invoke()`는 `api/commands.ts`에"라고 하지만, verify 타입·래퍼는 각각 ~250줄이라 두 파일을 800줄 상한 밖으로 밀어낸다. → **`src/types/verify.ts` · `src/api/verify.ts`를 신설하고 각각 `export * from "./verify";` 한 줄로 재수출**한다. 컴포넌트의 import 경로 관례(`@/types`, `@/api/commands`)는 그대로 유지된다.

---

## 2. 공유 Rust 타입 (`verify/types.rs`)

아래는 **문자 그대로 작성할 정의**다. 필드 추가·이름 변경 금지. 모든 직렬화 타입은 `#[serde(rename_all = "camelCase")]`.

**시각 단위 규약**: verify 서브시스템의 모든 타임스탬프(`generated_at`, `reviewed_at`, `ran_at`, `started_at` …)는 **epoch 밀리초 `i64`** 다 (`chrono::Utc::now().timestamp_millis()`). 기존 `CommitInfo::timestamp`는 **초**이므로, 커밋 시각을 verify 타입에 넣을 때는 `* 1000` 변환이 필요하다. 이 경계를 헷갈리지 말 것.

### 2.1 심각도와 룰 종류

```rust
use serde::{Deserialize, Serialize};

/// 낮음 → 높음 순으로 선언되어 있다. `Ord`로 정렬 후 역순 표시한다.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Info,
    Warn,
    Danger,
}

/// 구현된 룰 하나당 한 변종. 변종 이름은 camelCase로 직렬화되어 TS 유니온이 된다.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum FindingKind {
    // ── V2: 테스트 무력화 ────────────────────────────────────────────────
    TestSkipAdded,
    TestFileDeleted,
    AssertionRemoved,
    // ── V3: 테스트 품질 안티패턴 ─────────────────────────────────────────
    VacuousAssertion,
    MockOnlyAssertion,
    NoAssertionTest,
    BroadExceptionAssertion,
    AssertionRoulette,
    // ── V4: 환각 의존성 ──────────────────────────────────────────────────
    HallucinatedDependency,
    SuspiciousNewDependency,
    // ── V5: 검증 우회 흔적 (정적) ────────────────────────────────────────
    VerificationBypassed,
    TypeEscapeHatchAdded,
    EmptyCatchAdded,
    UnsafeUnwrapAdded,
    // ── V6: 스코프 이탈 ──────────────────────────────────────────────────
    ScopeDrift,
    // ── V10: 삭제 분류 ───────────────────────────────────────────────────
    PublicExportDeleted,
    ErrorHandlingDeleted,
    ValidationDeleted,
    // ── V11 / V12: 실행 증거 ─────────────────────────────────────────────
    TestEvidenceMissing,
    TestEvidenceStale,
    TestEvidenceFailed,
    UncoveredNewLines,
    // ── V19~V27: 세션 로그 ───────────────────────────────────────────────
    ReadLessEdit,
    TestFailureThenTestEdited,
    TestsNeverRunInSession,
    HookBypassCommand,
    UnrewindableChange,
    SubagentEdit,
    PostCompactionEdit,
    RepeatedEdit,
    PromptScopeDrift,
    StaleRulesInjected,
    // ── V31 / V32 / V35: 커밋 위생 ───────────────────────────────────────
    TangledCommit,
    RevertUnsafe,
    AgentTrailerMismatch,
}
```

### 2.2 Finding

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: FindingKind,
    pub severity: Severity,
    /// 저장소 상대 경로. **파일 단위가 아닌 발견(커밋·세션 단위)은 빈 문자열**이며,
    /// 프론트는 빈 문자열을 "커밋 레벨"로 렌더한다. `is_file_scoped()`로 판정한다.
    pub file: String,
    /// 새 파일 기준 1-based 라인 번호. 라인을 특정할 수 없으면 None.
    pub line: Option<u32>,
    /// **번역하지 않는다.** 구체적 증거만 담는 사실 문장이어야 한다.
    /// 예: `"it.skip added"`, `"3 assertions removed, 0 added"`.
    /// 프론트는 제목·설명을 `rule_id` 기반 i18n 키로 렌더하고 이 값은 증거 인용으로만 쓴다.
    pub message: String,
    /// 코드 스니펫·명령어 등 추가 증거. 512자에서 자른다.
    pub detail: Option<String>,
    /// 안정적 와이어 식별자. **반드시 `kind.rule_id()`로만 채운다** (직접 리터럴 금지).
    pub rule_id: String,
}
```

`Finding`은 **생성자를 통해서만 만든다.** 이렇게 하면 `severity`·`rule_id`가 레지스트리에서 벗어날 수 없다.

```rust
impl Finding {
    /// severity와 rule_id를 레지스트리에서 채운다.
    pub fn new(kind: FindingKind, file: impl Into<String>, message: impl Into<String>) -> Self;
    pub fn at_line(self, line: u32) -> Self;
    pub fn with_detail(self, detail: impl Into<String>) -> Self;
    /// 기본 severity를 위로만 올린다(내리지 않는다). 근거 없는 격상 금지.
    pub fn escalate(self, severity: Severity) -> Self;
    pub fn is_file_scoped(&self) -> bool { !self.file.is_empty() }
}

impl FindingKind {
    pub fn rule_id(&self) -> &'static str;          // registry.rs 조회
    pub fn default_severity(&self) -> Severity;     // registry.rs 조회
}
```

**`rule_id` 명명 규칙**: `"<v번호소문자>.<변종lowerCamel>"`. 예: `TestSkipAdded` → `"v2.testSkipAdded"`, `VerificationBypassed` → `"v5.verificationBypassed"`, `ReadLessEdit` → `"v19.readLessEdit"`. 이 문자열은 사용자 설정·통계·i18n 키의 앵커이므로 **한번 배포되면 변경하지 않는다.**

### 2.3 VerificationReport — §7-①의 핵심

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub findings: Vec<Finding>,
    /// 최소 1개 대상에 대해 **실제로 실행된** 룰의 rule_id 목록.
    pub checked: Vec<String>,
    /// 실행되지 못한 대상이 하나라도 있는 룰의 rule_id 목록.
    /// **`limits`에서 파생되며 직접 채우지 않는다** (`VerificationReport::new`가 채운다).
    pub unchecked: Vec<String>,
    /// 각 미검사 항목의 사유. UI가 "왜 안 봤는지"를 말할 수 있게 한다.
    pub limits: Vec<ScanLimit>,
    /// epoch 밀리초.
    pub generated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanLimit {
    pub rule_id: String,
    pub reason: UncheckedReason,
    /// 사람이 읽을 구체 사유. 예: `"3 Python files skipped"`, `"lcov.info not found"`.
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UncheckedReason {
    /// 사용자가 끔 (§7-②).
    Disabled,
    /// diff에 이 룰의 대상 파일 종류가 없음.
    NotApplicable,
    /// TS/JS/Rust 외 언어라 검사 범위 밖 (§7-⑤).
    UnsupportedLanguage,
    /// lcov·lockfile·세션 로그 등 필요한 아티팩트 없음.
    MissingArtifact,
    /// 파싱 실패 (§7-⑥ — 에러가 아니라 조용한 미검사).
    ParseFailed,
    /// 바이트·시간 예산 초과 (§7-⑦).
    BudgetExceeded,
    /// 레지스트리에 있으나 아직 구현 안 됨 (V1·V7·V8·V9 …).
    NotImplemented,
}
```

**불변식 (구현자가 반드시 지킬 것)**

- `unchecked == limits.iter().map(|l| l.rule_id.clone()).collect::<BTreeSet<_>>()` — 중복 없이 정렬.
- 레지스트리의 **모든** 엔트리는 `checked ∪ unchecked` 안에 있어야 한다. 어느 쪽에도 없는 룰이 있으면 그 리포트는 잘못된 것이다.
- **한 룰이 양쪽에 동시에 등장하는 것은 정상이다** (TS 파일에서는 돌았고 Python 파일에서는 건너뜀). UI는 이를 "부분 검사"로 렌더한다.
- 생성은 `VerificationReport::new(findings, checked, limits)` 하나로만 한다. 이 생성자가 `unchecked`를 파생시키고 `generated_at`을 채우고 findings를 severity 내림차순 → 파일 경로 오름차순 → 라인 오름차순으로 정렬한다.

### 2.4 룰 레지스트리 (`verify/registry.rs`)

```rust
#[derive(Clone, Copy, Debug)]
pub struct RuleEntry {
    pub id: &'static str,               // "v2.testSkipAdded"
    pub kind: Option<FindingKind>,      // Planned 룰은 None
    pub v_number: &'static str,         // "V2"
    pub layer: u8,                      // spec §4의 Layer 번호 (0~6)
    pub default_severity: Severity,
    pub default_enabled: bool,
    pub status: RuleStatus,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuleStatus {
    Implemented,
    /// 레지스트리에 등재되었으나 미구현. 항상 `unchecked` + `NotImplemented`로 나간다.
    /// 이것이 §7-①("미검사: 나머지 전부")을 기계적으로 보장하는 장치다.
    Planned,
}

pub fn registry() -> &'static [RuleEntry];
pub fn find(rule_id: &str) -> Option<&'static RuleEntry>;
```

**Planned 엔트리 (P0이 반드시 등재)**: `v1.structuralDiff`, `v7.reinventedFunction`, `v8.orphanCode`, `v9.blastRadius`, `v15.mutationScore`, `v16.claimMismatch`, `v17.invariantViolation`, `v18.blindReviewMode`, `v28.hookCollector`, `v36.subCommitBisect`. `kind: None`, `status: Planned`.

**기본 on/off (§7-② "적게 시작")**

| 기본 ON | 기본 OFF |
|---|---|
| `v2.*` (전부), `v5.verificationBypassed`, `v5.emptyCatchAdded`, `v6.scopeDrift`, `v10.*` (전부, Info), `v11.*`, `v19.readLessEdit`, `v20.*`, `v21.hookBypassCommand`, `v22.unrewindableChange`, `v23.subagentEdit`, `v31.tangledCommit`, `v32.revertUnsafe` | `v3.*` (전부 — 오탐 위험 최상), `v4.*` (매니페스트 필요), `v5.typeEscapeHatchAdded`, `v5.unsafeUnwrapAdded`, `v12.uncoveredNewLines`, `v24.postCompactionEdit`, `v25.repeatedEdit`, `v26.promptScopeDrift`, `v27.staleRulesInjected`, `v35.agentTrailerMismatch` |

**기본 severity**

- `Danger`: `v2.testFileDeleted`, `v4.hallucinatedDependency`, `v11.testEvidenceFailed`, `v20.testFailureThenTestEdited`, `v21.hookBypassCommand`
- `Info` (경고 아님 — §7-⑨): `v10.*`, `v19.readLessEdit`, `v23.subagentEdit`, `v24.postCompactionEdit`, `v25.repeatedEdit`, `v3.assertionRoulette`, `v27.staleRulesInjected`, `v35.agentTrailerMismatch`
- 나머지: `Warn`

> **`v19.readLessEdit`은 Info를 넘길 수 없다.** spec §7-⑨는 이것을 경고가 아닌 **리뷰 우선순위 가중치**로 쓰라고 명시한다. `escalate()` 호출 금지.

### 2.5 룰 설정 (`verify/config.rs`)

```rust
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuleConfig {
    /// rule_id → enabled. 없는 키는 레지스트리 default_enabled를 따른다.
    pub enabled: std::collections::BTreeMap<String, bool>,
}

impl RuleConfig {
    pub fn is_enabled(&self, rule_id: &str) -> bool;
}

/// `~/Library/Application Support/com.gitbaro.app/verify-rules.json`
/// 읽기 실패 시 기본값으로 폴백한다 (app_state.rs 패턴 동일).
pub fn load_rule_config() -> RuleConfig;
pub fn save_rule_config(config: &RuleConfig) -> Result<(), AppError>;
```

### 2.6 룰 입력 (`verify/rules/context.rs`)

```rust
#[derive(Clone, Debug)]
pub struct DiffContext {
    pub repo_path: std::path::PathBuf,
    pub files: Vec<FileChange>,
    /// 워킹트리 스캔이면 None.
    pub commit: Option<CommitContext>,
    /// 워킹트리 스캔 시 커밋 패널의 초안 메시지 (V6가 사용).
    pub draft_message: Option<String>,
}

#[derive(Clone, Debug)]
pub struct FileChange {
    /// 새 경로. 삭제면 옛 경로.
    pub path: String,
    pub old_path: Option<String>,
    pub change: ChangeKind,
    pub language: Language,
    /// 경로 기반 판정만 한다 (`.test.` / `.spec.` / `__tests__/` / `/tests/` /
    /// `_test.rs` / `tests/*.rs`). Rust의 `#[cfg(test)]` 인라인 모듈은
    /// 경로로 판정 불가하므로 `has_cfg_test`로 보완한다.
    pub is_test: bool,
    pub has_cfg_test: bool,
    pub added: Vec<ChangedLine>,
    pub removed: Vec<ChangedLine>,
}

#[derive(Clone, Debug)]
pub struct ChangedLine {
    /// added는 new 기준, removed는 old 기준 1-based 라인 번호.
    pub line_no: u32,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind { Added, Modified, Deleted, Renamed }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language { TypeScript, JavaScript, Rust, Other }

#[derive(Clone, Debug)]
pub struct CommitContext {
    pub oid: String,
    pub message: String,
    pub parent_ids: Vec<String>,
    pub author_email: String,
    /// `Key: Value` 트레일러 (V35). 소문자화하지 않은 원본 키.
    pub trailers: Vec<(String, String)>,
}

/// 기존 `git::engine::DiffOutput`에서 DiffContext를 만든다.
/// diff 획득 자체는 커맨드 층 책임이며 이 함수는 순수 변환이다(테스트 가능).
pub fn context_from_diff(
    repo_path: &std::path::Path,
    diff: &DiffOutput,
    commit: Option<CommitContext>,
    draft_message: Option<String>,
) -> DiffContext;
```

**룰 함수 시그니처** (모든 정적 diff 룰이 이 모양이다 — 트레이트·다형성 금지, 단순 함수 목록):

```rust
pub struct RuleOutcome {
    pub findings: Vec<Finding>,
    pub limits: Vec<ScanLimit>,
    /// 실제로 검사한 rule_id (부분 검사여도 포함).
    pub checked: Vec<String>,
}

pub type DiffRuleFn = fn(&DiffContext) -> RuleOutcome;

/// 활성 룰만 돌리고 비활성 룰은 `Disabled` limit으로 기록한 뒤 리포트를 만든다.
pub fn run_diff_rules(ctx: &DiffContext, config: &RuleConfig) -> VerificationReport;
```

### 2.7 검토 상태 타입 (V13 · V29 · V34 · V33)

```rust
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewStatus {
    Unreviewed,
    Reviewed,
    /// 검토 후 내용이 바뀜 → 자동 미검토 복귀 (V13). 커밋은 불변이므로 Stale이 될 수 없다.
    Stale,
}

/// 디스크에 저장되는 마킹. `status`는 저장하지 않고 조회 시 계산한다.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileReviewMark {
    pub path: String,
    /// 검토 시점 diff 텍스트의 `digest::diff_hash`.
    pub reviewed_diff_hash: String,
    pub reviewed_at: i64,
    /// git `user.name <user.email>` — P4(책임 귀속)의 실체.
    pub reviewer: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileReviewEntry {
    pub path: String,
    pub status: ReviewStatus,
    pub reviewed_at: Option<i64>,
    pub reviewer: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitReviewState {
    pub commit_id: String,
    pub status: ReviewStatus,   // Unreviewed | Reviewed 만 나온다
    pub reviewed_at: Option<i64>,
    pub reviewer: Option<String>,
}

/// V29 — 미검토 커밋 큐.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueue {
    /// 최신순 커밋 oid.
    pub unreviewed_commit_ids: Vec<String>,
    pub total_unreviewed: usize,
    /// `unreviewed_commit_ids`가 limit에서 잘렸는지.
    pub truncated: bool,
    pub last_reviewed_at: Option<i64>,
}

/// V34 — push 전 게이트. **표시 전용. 차단하지 않는다.**
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PushGateSummary {
    pub commits: Vec<PushGateCommit>,
    pub unreviewed_count: usize,
    pub danger_count: usize,
    pub warn_count: usize,
    /// 15개 이상 파일을 건드려 깨끗한 revert가 어려운 커밋 수 (V31 연동).
    pub tangled_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PushGateCommit {
    pub commit_id: String,
    pub summary: String,
    pub review_status: ReviewStatus,
    pub files_changed: usize,
    /// findings 중 최고 severity. findings가 없으면 None(≠ 안전).
    pub max_severity: Option<Severity>,
    pub finding_count: usize,
}

/// 히스토리 목록 배지용 경량 요약. 100개 커밋에 전체 리포트를 실어보내지 않는다.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitVerificationSummary {
    pub commit_id: String,
    pub max_severity: Option<Severity>,
    pub danger_count: usize,
    pub warn_count: usize,
    pub info_count: usize,
    /// 이 커밋에서 미검사로 남은 룰 수 (§7-① 배지에 노출).
    pub unchecked_count: usize,
}

/// V33 — git-notes 증거 원장. **기본 비활성 · 로컬 전용 · 절대 push 금지.**
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLedgerEntry {
    pub commit_id: String,
    pub recorded_at: i64,
    pub recorded_by: String,
    pub checks: Vec<LedgerCheck>,
    /// 기록 시점 GitBaro 버전 — 포맷 진화 대비.
    pub tool_version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LedgerCheck {
    pub rule_id: String,
    pub outcome: LedgerOutcome,
    pub finding_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LedgerOutcome { Passed, Flagged, Skipped }
```

**notes ref**: `refs/notes/gitbaro-verification`.

**git CLI가 아니라 `git2`를 쓴다.** git notes에는 훅이 없으므로 하이브리드 전략상 libgit2가 맞고, 그래야 통합 파일 `git/cli.rs`를 건드리지 않아도 된다 (`GitCliEngine::run_local`/`run_local_checked`는 **private**이라 `commands/`에서 호출할 수 없다 — 확인함). git2 0.19에 필요한 API가 전부 있다:

- 쓰기: `repo.note(&sig, &sig, Some("refs/notes/gitbaro-verification"), oid, &json, /* force */ true)`
- 읽기: `repo.find_note(Some("refs/notes/gitbaro-verification"), oid)` → 없으면 `Err` → **`Ok(None)`으로 흡수**
- 삭제: `repo.note_delete(oid, Some(...), &sig, &sig)`

모두 `spawn_blocking` 안에서. `Signature`는 `repo.signature()`로 얻고, 실패하면 `AppError::Verify`로 명확히 알린다(원장은 귀속이 핵심이라 익명 기록은 무의미하다).

**push 금지** — 원장 커맨드는 remote를 절대 건드리지 않는다 (spec §V14 경고). 기본 비활성.

### 2.8 실행 증거 타입 (V11 · V12)

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestEvidence {
    /// `digest::worktree_hash` 결과 (40자 hex).
    pub worktree_hash: String,
    /// 증거를 트리와 대조하기 위한 매니페스트. 5000줄 초과 시 비운다.
    pub manifest: Vec<String>,
    pub command: String,
    pub exit_code: Option<i32>,
    pub passed: bool,
    pub ran_at: i64,
    pub duration_ms: u64,
    /// stdout+stderr 마지막 8 KiB. 비밀이 섞일 수 있으므로 로그로 재출력 금지.
    pub output_tail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EvidenceFreshness {
    /// 기록 시점 트리 해시 == 현재 트리 해시.
    Fresh,
    /// 트리가 변했다 = 증거 만료. 매니페스트가 있으면 변경 파일 수를 센다.
    #[serde(rename_all = "camelCase")]
    Stale { changed_files: Option<usize> },
    /// 이 저장소에 기록된 실행 증거가 없다.
    Absent,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestEvidenceStatus {
    pub evidence: Option<TestEvidence>,
    pub freshness: EvidenceFreshness,
    pub current_worktree_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffCoverage {
    pub path: String,
    pub added_lines: u32,
    pub covered_added_lines: u32,
    pub uncovered_added_lines: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoverageResult {
    /// 파싱한 lcov 파일의 저장소 상대 경로.
    pub source: String,
    pub parsed_at: i64,
    pub files: Vec<DiffCoverage>,
    /// lcov에 없어서 판정 불가한 변경 파일 (§7-① 정직성).
    pub unmapped_files: Vec<String>,
}
```

> **V12는 절대 단독 표시 금지** (spec §P3·V12). `UncoveredNewLines` finding을 렌더하는 화면은 반드시 V3(테스트 품질) 상태를 같은 화면에 함께 노출한다. 커버리지는 "실행됨"만 증명하지 "검증됨"을 증명하지 않는다.

### 2.9 세션 타입 (V19~V27 · V30)

```rust
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionSource { ClaudeCode, Codex }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub source: SessionSource,
    /// 세션 JSONL 절대 경로 (재조회 키).
    pub file_path: String,
    pub cwd: String,
    pub git_branch: Option<String>,
    pub started_at: i64,
    pub ended_at: i64,
    /// V26 — 명세 앵커. 2000자에서 자른다. 로컬 밖으로 나가지 않는다.
    pub first_user_prompt: Option<String>,
    pub files_read: Vec<String>,
    pub files_edited: Vec<FileEditSummary>,
    pub bash_commands: Vec<BashCommandRecord>,
    /// V24 — compact_boundary 타임스탬프.
    pub compaction_boundaries: Vec<i64>,
    /// V27 — 주입된 CLAUDE.md/AGENTS.md 내용의 다이제스트 (본문 저장 안 함).
    pub injected_rules_digest: Option<String>,
    /// 예산 초과로 뒷부분을 못 읽었다 (§7-⑦). true면 모든 파생 신호는 "부분 관측"이다.
    pub truncated: bool,
    /// 스킵된 레코드 수 (긴 라인·파싱 실패). 0이 아니면 UI에 부분 관측 표시.
    pub skipped_records: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileEditSummary {
    pub path: String,
    /// V25 — 재편집 횟수(헤맴 지표).
    pub edit_count: u32,
    pub first_edit_at: i64,
    pub last_edit_at: i64,
    /// V19 — 첫 편집 이전에 같은 세션에서 Read/Grep 했는가.
    pub was_read_first: bool,
    /// V24 — compaction 경계 이후에 편집됐는가.
    pub after_compaction: bool,
    /// V23 — isSidechain 서브에이전트가 편집했는가.
    pub by_subagent: bool,
    /// V22 — Bash로 변경됐는가 (= /rewind 복원 범위 밖).
    pub via_bash: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BashCommandRecord {
    /// 512자에서 자른다.
    pub command: String,
    pub at: i64,
    pub is_error: bool,
    pub kind: BashCommandKind,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BashCommandKind {
    /// pnpm test / vitest / jest / cargo test / pytest …
    TestRun,
    /// --no-verify / -n / SKIP= / push -f / chmod / rm -rf
    HookBypass,
    /// > / >> / sed -i / mv / rm  (V22 — rewind 사각지대)
    FileMutation,
    Other,
}

/// V30 — 세션 ↔ 커밋 상관. §7-⑧: 오귀속은 무귀속보다 나쁘다.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionCommitLink {
    pub session_id: String,
    pub session_path: String,
    pub commit_ids: Vec<String>,
    pub confidence: LinkConfidence,
    /// 판단 근거 토큰: "cwd" | "branch" | "timeWindow" | "fileOverlap"
    pub basis: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkConfidence { High, Medium, Low }
```

**상관 규칙 (§7-⑧ — 반드시 이대로)**

- `High`: cwd 일치 + branch 일치 + 커밋 시각이 세션 구간 안 + 편집 파일 ⊇ 커밋 파일.
- `Medium`: cwd 일치 + (branch 또는 시각 구간) + 파일 교집합 ≥ 1.
- `Low`: 그 외 전부.
- **`Low` 링크는 프로버넌스로 표시하지 않는다.** 프론트는 숨기거나 명시적 "추정" 라벨 뒤에서만 노출한다. `High`가 아닌 링크로 "이 커밋은 에이전트가 만들었다"고 단정하는 UI 금지.

### 2.10 다이제스트 (`verify/digest.rs`) — P0가 이 알고리즘대로 구현

```rust
/// 워킹트리의 안정적 콘텐츠 다이제스트 (V11/P7).
/// 알고리즘 (구현 독립적이어야 하므로 순서까지 고정):
///   1) 첫 줄 = `"HEAD\t{head_tree_oid}"`. unborn HEAD면 `{"0"*40}`.
///   2) `repo.statuses()`를 include_untracked=true, recurse_untracked_dirs=true,
///      include_ignored=false 로 순회.
///   3) 각 엔트리 → `"{path}\t{oid}"`. oid는 워킹트리 파일의
///      `git2::Oid::hash_file(ObjectType::Blob, abs_path)`. 삭제됐으면 리터럴 `"deleted"`.
///   4) path 바이트 오름차순 정렬(1번 줄은 항상 맨 앞 고정), `\n`으로 join, 끝에 `\n`.
///   5) `git2::Oid::hash_object(ObjectType::Blob, manifest)`의 hex 문자열 반환.
/// 매니페스트는 dirty 파일 수만큼만 커지므로 저장 비용이 작다.
pub fn worktree_manifest(repo: &git2::Repository) -> Result<Vec<String>, AppError>;
pub fn worktree_hash(repo: &git2::Repository) -> Result<String, AppError>;

/// 매니페스트 두 개를 비교해 달라진 경로 수를 센다 (EvidenceFreshness::Stale).
pub fn manifest_diff_count(before: &[String], after: &[String]) -> usize;

/// diff 텍스트의 콘텐츠 해시 (V13 파일 검토 무효화).
pub fn diff_hash(diff_text: &str) -> String;
```

`git2 0.19`에 `Oid::hash_object` / `Oid::hash_file`이 **존재함을 확인했다.** 새 해시 크레이트가 필요 없는 이유다.

### 2.11 상태 저장 경로 (`verify/paths.rs`)

```rust
/// worktree-지역 상태 디렉터리: `{repo.path()}/gitbaro/`
/// (파일 검토 상태, 테스트 실행 증거 — 체크아웃마다 달라야 하는 것들)
pub fn worktree_state_dir(repo: &git2::Repository) -> Result<std::path::PathBuf, AppError>;

/// worktree 공유 상태 디렉터리: `{common_dir}/gitbaro/`
/// (커밋 검토 상태, 세션 요약 캐시 — 체크아웃과 무관해야 하는 것들)
///
/// **주의: git2 0.19에는 `Repository::commondir()`가 없다.** 직접 해석한다:
///   `repo.is_worktree()`가 true면 `{repo.path()}/commondir` 파일을 읽어
///   (상대 경로일 수 있음) `repo.path()` 기준으로 join 후 정규화한다.
///   false면 `repo.path()`를 그대로 쓴다.
pub fn shared_state_dir(repo: &git2::Repository) -> Result<std::path::PathBuf, AppError>;
```

파일명 규약:

| 파일 | 위치 | 내용 |
|---|---|---|
| `file-review.json` | worktree-local | `Vec<FileReviewMark>` |
| `test-evidence.json` | worktree-local | `TestEvidence` |
| `commit-review.json` | shared | `Vec<CommitReviewState>` (`Reviewed`만 저장) |
| `session-cache/<sha1(path)>.json` | shared | `SessionSummary` + `{size, mtime}` 무효화 키 |

`.git/` 하위이므로 git이 자동 무시한다. `.gitignore`를 건드리지 않는다.

### 2.12 세션 파싱 예산 (`verify/session/jsonl.rs`) — §7-⑦ 방어선

```rust
pub const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;      // 4 MiB 초과 라인은 스킵(카운트)
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;      // 초과 시 앞부분만 + truncated=true
pub const MAX_RECORDS: usize = 200_000;
pub const MAX_PARSE_MILLIS: u64 = 5_000;
pub const MAX_PROMPT_CHARS: usize = 2_000;
pub const MAX_COMMAND_CHARS: usize = 512;
pub const MAX_OUTPUT_TAIL_BYTES: usize = 8 * 1024;
```

- **`std::fs::read_to_string` 금지.** `BufReader::read_until(b'\n', ..)`로 라인 단위 스트리밍만 한다.
- 예산 초과·파싱 실패는 **에러가 아니다.** `SessionSummary.truncated` / `skipped_records`를 올리고, 리포트에 `ScanLimit { reason: BudgetExceeded | ParseFailed }`를 남긴다.
- 어댑터는 알 수 없는 필드·레코드 타입을 **조용히 무시**한다 (`#[serde(default)]` + `serde_json::Value` 폴백). 포맷이 바뀌어도 파서가 죽지 않는 것이 §7-⑥ 요구사항이다.
- 세션 요약은 `(file_size, mtime_ms)` 키로 캐시하고, 키가 일치하면 재파싱하지 않는다.

**보안**: 세션 로그에는 프롬프트·파일 내용·토큰이 섞여 있을 수 있다. 이 서브시스템은 세션 내용을 **네트워크로 전송하지 않고, `tracing`으로 본문을 출력하지 않는다.** 경로·카운트만 로깅한다.

---

## 3. Tauri 커맨드 시그니처

모두 `#[tauri::command] pub async fn`. `git2` 호출은 전부 `tokio::task::spawn_blocking` 안. `JoinError`는 `AppError::Channel(e.to_string())`으로 매핑.

### 3.1 `commands/verify.rs`

```rust
#[tauri::command]
pub async fn verify_working_tree(
    repo_path: String,
    staged: bool,
    draft_message: Option<String>,
) -> Result<VerificationReport, AppError>;

#[tauri::command]
pub async fn verify_commit(
    repo_path: String,
    oid: String,
) -> Result<VerificationReport, AppError>;

/// 히스토리 배지용 경량 배치 조회. 전체 리포트를 반환하지 않는다.
#[tauri::command]
pub async fn verify_commit_range(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<CommitVerificationSummary>, AppError>;

/// 설정 화면용 — Planned 룰까지 전부 반환한다 (§7-① UI 근거).
#[tauri::command]
pub async fn get_verify_rules() -> Result<Vec<RuleDescriptor>, AppError>;

#[tauri::command]
pub async fn set_verify_rule_enabled(
    rule_id: String,
    enabled: bool,
) -> Result<(), AppError>;

/// V4. `allow_registry=false`(기본)면 오프라인 매니페스트/락파일 대조만 한다.
#[tauri::command]
pub async fn check_dependencies(
    repo_path: String,
    oid: Option<String>,
    allow_registry: bool,
) -> Result<VerificationReport, AppError>;
```

`RuleDescriptor`는 `RuleEntry`의 직렬화 가능 버전 — `verify/types.rs`에 정의:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleDescriptor {
    pub rule_id: String,
    pub kind: Option<FindingKind>,
    pub v_number: String,
    pub layer: u8,
    pub default_severity: Severity,
    pub status: RuleStatus,
    pub enabled: bool,
}
```

### 3.2 `commands/review.rs`

```rust
#[tauri::command]
pub async fn get_file_review_states(
    repo_path: String,
    paths: Vec<String>,
    staged: bool,
) -> Result<Vec<FileReviewEntry>, AppError>;

/// 현재 diff 해시는 **백엔드가 계산한다.** 프론트가 해시를 만들어 보내지 않는다.
#[tauri::command]
pub async fn mark_file_reviewed(
    repo_path: String,
    path: String,
    staged: bool,
) -> Result<FileReviewEntry, AppError>;

#[tauri::command]
pub async fn unmark_file_reviewed(
    repo_path: String,
    path: String,
) -> Result<(), AppError>;

#[tauri::command]
pub async fn get_commit_review_states(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<CommitReviewState>, AppError>;

#[tauri::command]
pub async fn mark_commit_reviewed(
    repo_path: String,
    oid: String,
) -> Result<CommitReviewState, AppError>;

#[tauri::command]
pub async fn unmark_commit_reviewed(
    repo_path: String,
    oid: String,
) -> Result<(), AppError>;

/// V29 — 미검토 커밋 큐.
#[tauri::command]
pub async fn get_review_queue(
    repo_path: String,
    limit: Option<usize>,
) -> Result<ReviewQueue, AppError>;

/// V34 — push 대상 커밋 요약. **표시 전용.**
#[tauri::command]
pub async fn get_push_gate_summary(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<PushGateSummary, AppError>;

/// V33 — 원장 조회. 노트가 없으면 Ok(None) (에러 아님).
#[tauri::command]
pub async fn read_evidence_ledger(
    repo_path: String,
    oid: String,
) -> Result<Option<EvidenceLedgerEntry>, AppError>;

/// V33 — 백엔드가 리포트를 재산출해 노트로 기록한다. 프론트가 원장 내용을 만들지 않는다.
/// 로컬 전용. 절대 push하지 않는다.
#[tauri::command]
pub async fn record_evidence_ledger(
    repo_path: String,
    oid: String,
) -> Result<EvidenceLedgerEntry, AppError>;
```

### 3.3 `commands/session.rs`

```rust
/// 이 저장소와 연관된 세션 목록. 세션 디렉터리가 없거나 전부 파싱 실패면
/// **빈 Vec을 반환한다 (에러 아님)** — §7-⑥ progressive enhancement.
#[tauri::command]
pub async fn list_sessions_for_repo(
    repo_path: String,
    limit: Option<usize>,
) -> Result<Vec<SessionSummary>, AppError>;

/// 파싱 불가면 Ok(None).
#[tauri::command]
pub async fn get_session_summary(
    session_path: String,
) -> Result<Option<SessionSummary>, AppError>;

/// V19~V27 findings.
#[tauri::command]
pub async fn verify_session(
    repo_path: String,
    session_path: String,
) -> Result<VerificationReport, AppError>;

/// V30 — 커밋 목록에 대한 세션 상관. Low 신뢰도도 반환하되 confidence를 반드시 실어보낸다.
#[tauri::command]
pub async fn correlate_sessions_to_commits(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<SessionCommitLink>, AppError>;

/// V30 — 세션 baseline 대비 누적 diff. baseline은 Claude Code의
/// `file-history-snapshot`에서 얻고, 없으면 세션 첫 커밋의 부모로 폴백한다.
#[tauri::command]
pub async fn get_session_cumulative_diff(
    repo_path: String,
    session_path: String,
) -> Result<DiffOutput, AppError>;
```

### 3.4 `commands/evidence.rs`

```rust
/// V11 — 현재 트리 기준 증거 상태.
#[tauri::command]
pub async fn get_test_evidence(
    repo_path: String,
) -> Result<TestEvidenceStatus, AppError>;

/// V11 — 테스트를 실행하고 결과를 현재 트리 해시에 결합해 기록한다.
/// 실행 중 `verify:test-progress` 이벤트를 흘린다. 실패해도 Err가 아니라
/// `passed:false`인 TestEvidence를 반환한다 (실패도 증거다).
#[tauri::command]
pub async fn run_test_command(
    repo_path: String,
    command: String,
    app_handle: tauri::AppHandle,
) -> Result<TestEvidence, AppError>;

/// V12 — lcov 경로 미지정 시 `coverage/lcov.info`, `lcov.info`,
/// `coverage/coverage-final.json` 순으로 탐색. 못 찾으면 `unmapped_files`에
/// 전부 넣고 빈 결과를 반환한다 (에러 아님).
#[tauri::command]
pub async fn get_diff_coverage(
    repo_path: String,
    oid: Option<String>,
    coverage_path: Option<String>,
) -> Result<CoverageResult, AppError>;
```

**`run_test_command` 보안 주의** — 이 커맨드는 사용자가 입력한 문자열을 `sh -c`로 실행한다(테스트 명령은 `pnpm test -- --run` 같은 셸 문법을 필요로 하므로 불가피하다). 지켜야 할 것:

- 명령 문자열은 **오직 사용자 설정에서만** 온다. 세션 로그·커밋 메시지·diff 등 **에이전트가 생성한 텍스트를 명령으로 실행하지 않는다.** (V20이 세션 로그에서 테스트 명령을 *탐지*하는 것과, 그걸 *실행*하는 것은 전혀 다른 일이다. 실행은 하지 않는다.)
- `current_dir`는 반드시 검증된 `repo_path`.
- 타임아웃 10분, 초과 시 프로세스를 kill하고 `passed:false` 증거로 기록.
- 출력은 8 KiB 꼬리만 저장하고 `tracing`으로 본문을 재출력하지 않는다(테스트 출력에 토큰이 섞일 수 있다).

**커맨드 명명 확인** — `snake_case` fn 이름이 그대로 `invoke()` 키가 된다 (기존 코드가 `invoke("get_status")`처럼 snake_case를 쓴다). 프론트 래퍼는 `invoke("verify_working_tree", { repoPath, staged, draftMessage })`처럼 **인자만 camelCase**다.

**신규 이벤트** (`events.rs`, P0 소유):

```rust
pub const VERIFY_TEST_PROGRESS: &str = "verify:test-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTestProgressEvent {
    pub repo_path: String,
    /// 마지막 출력 라인 (2048자 컷).
    pub line: String,
    pub running: bool,
}
```

---

## 4. 신규 `AppError` 변종

`error.rs`에 **정확히 2개만** 추가한다. 나머지 실패 경로는 기존 변종으로 충분하다 (락파일/설정 JSON → `Serde`, 파일 IO → `Io`, git notes CLI → `GitCli`, git2 → `Git`).

```rust
    #[error("Verification failed: {0}")]
    Verify(String),

    #[error("Session log unreadable ({path}): {message}")]
    SessionParse { path: String, message: String },
```

`Serialize` 매칭 추가:

```rust
            AppError::Verify(msg) => ("Verify", msg.clone()),
            AppError::SessionParse { path, message } => (
                "SessionParse",
                format!("{}: {}", path, message),
            ),
```

TS `AppError["type"]` 유니온에 `"Verify" | "SessionParse"` 추가 (`src/types/index.ts`, P0).

> **`SessionParse`는 커맨드 반환값으로 프론트에 올라가면 안 된다.** §7-⑥에 따라 세션 파싱 실패는 `Ok(None)` / 빈 `Vec` / `ScanLimit{ParseFailed}`로 흡수된다. 이 변종은 세션 **파일을 명시적으로 지정한 커맨드가 그 파일 자체를 열 수 없을 때**만 쓴다.

---

## 5. 의존성 결정 — **신규 크레이트 0개**

기존 `Cargo.toml`에 이미 있는 것으로 전부 해결된다: `serde` / `serde_json` / `git2` / `tokio` / `tracing` / `chrono` / `dirs` / `reqwest` / `uuid` / `thiserror`.

| 검토한 크레이트 | 결정 | 근거 |
|---|---|---|
| `regex` | **추가 안 함** | Layer 1 패턴은 전부 트림된 라인에 대한 리터럴 토큰 매칭이다. 손으로 쓴 매처가 더 빠르고, 완전히 hermetic하며, 단위 테스트가 쉽다. 정규식이 필요할 만큼 복잡해진다면 그건 AST(V1)가 필요하다는 신호이지 정규식이 필요하다는 신호가 아니다. |
| `globset` | **추가 안 함** | 경로 판정은 접미사·세그먼트 검사로 충분하다 (`.test.`, `__tests__/`, `_test.rs`). |
| `toml` | **추가 안 함** | `Cargo.toml`/`Cargo.lock`은 **존재 여부 탐지**만 필요하다. `[[package]]` / `[dependencies]` 블록 안의 `name = "..."`를 라인 스캔한다. 스캔이 확신을 못 주면 결과는 "환각"이 아니라 `ScanLimit{ParseFailed}`로 간다 — 오탐보다 미검사가 낫다. |
| `serde_yaml` | **추가 안 함** | `pnpm-lock.yaml`도 동일하게 패키지 키 라인 스캔. 위와 같은 폴백 규칙. |
| `walkdir` | **추가 안 함** | 세션 디렉터리는 깊이가 고정이다 (Claude Code 1단계, Codex `YYYY/MM/DD` 3단계). `std::fs::read_dir` 중첩으로 충분. |
| `sha2` / `blake3` | **추가 안 함** | `git2::Oid::hash_object` / `hash_file`이 SHA-1 콘텐츠 해시를 무료로 준다 (0.19에 존재 확인함). |
| `notify` | 이미 있음 | V13 무효화는 기존 `fs:change` 이벤트로 프론트가 재조회하게 한다. 새 워처를 만들지 않는다. |

**레지스트리 조회(V4 opt-in)** 는 기존 `reqwest`를 쓴다. `registry.npmjs.org` / `crates.io`. 기본 비활성, 3초 타임아웃, 실패 시 `ScanLimit{MissingArtifact}`.

**구현자가 이 결정을 뒤집으려면** 반드시 리포트에 명시하고 `src-tauri/Cargo.toml`을 직접 수정할 것. 조용히 추가 금지.

---

## 6. 파일 소유권 표 — 병렬 편집 충돌 방지

**실행 순서: P0 → (P1…P6 완전 병렬) → P7 → P8.**
병렬 구간에서 통합 파일(`lib.rs`, `commands/mod.rs`, `error.rs`, `events.rs`, `verify/mod.rs`, `verify/types.rs`, `verify/registry.rs`, `verify/config.rs`, `verify/digest.rs`, `verify/paths.rs`)을 **아무도 건드리지 않는다.**

| Phase | 소유 파일 | 담당 V-번호 |
|---|---|---|
| **P0 — Scaffold (통합, 단독 실행)** | `verify/mod.rs`, `verify/types.rs`, `verify/registry.rs`, `verify/config.rs`, `verify/digest.rs`, `verify/paths.rs`, `error.rs`, `events.rs`, `lib.rs`(`pub mod verify;` 한 줄만), `src/types/index.ts`(유니온 2개 + 재수출 1줄) | — |
| **P1 — Static rules** | `verify/rules/**` (mod·context·patterns·test_disabling·test_quality·bypass·scope·deletion) | V2 V3 V5 V6 V10 |
| **P2 — Dependencies** | `verify/deps.rs` | V4 |
| **P3 — Session** | `verify/session/**` (mod·jsonl·claude_code·codex·summary·rules·correlate) | V19~V27 V30 |
| **P4 — Review state** | `verify/review.rs` | V13 V29 V33 V34 |
| **P5 — Evidence** | `verify/evidence.rs` | V11 V12 |
| **P6 — Hygiene** | `verify/hygiene.rs` | V31 V32 V35 |
| **P7 — Commands** | `commands/verify.rs`, `commands/review.rs`, `commands/session.rs`, `commands/evidence.rs`, `commands/mod.rs`(4줄 추가), `lib.rs`(핸들러 등록만) | — |
| **P8 — Frontend** | `src/types/verify.ts`, `src/api/verify.ts`, `src/api/commands.ts`(재수출 1줄), `src/stores/verify.ts`, `src/components/verify/**`, `src/i18n/locales/{en,ko}.json` | — |

**P0의 산출물은 이 문서 §2의 코드 블록을 문자 그대로 옮긴 것**이다. P1~P6은 이 파일들을 **읽기 전용**으로 취급한다. 새 룰이 필요하면 P0의 레지스트리에 이미 있어야 하며, 없다면 그 룰은 이번 범위가 아니다.

**교차 phase 의존**: P1~P6은 서로를 import하지 않는다. 조합은 전부 P7에서 일어난다. `hygiene.rs`가 `review.rs`의 타입을 쓰고 싶어지면 → 그 타입은 `types.rs`에 있어야 한다(P0). 지금 그렇게 배치돼 있다.

**기존 `git/**` 파일은 어느 phase도 수정하지 않는다.**

- `git/commit.rs` — V6의 conventional-commit 헤더 파싱은 `verify/rules/scope.rs`에, V35 트레일러 파싱은 `verify/hygiene.rs`에 각각 지역 함수로 둔다. 두 phase가 동시에 노릴 수 있는 유일한 기존 파일이라 명시적으로 금지한다. 단 `validate_commit_oid()`는 **읽어서 재사용**한다 (oid를 받는 모든 커맨드는 이 함수로 검증부터 한다 — 옵션 인젝션 방어).
- `git/cli.rs` — `run_local`/`run_local_checked`가 private이므로 애초에 호출 불가하다. verify 서브시스템은 **git CLI를 새로 실행하지 않는다.** 필요한 모든 동작(notes 포함)이 git2로 가능하다. 유일한 예외는 P5의 `run_test_command`인데, 이건 git이 아니라 사용자 지정 테스트 명령이라 `tokio::process::Command`를 직접 쓴다.
- `git/engine.rs` — `DiffOutput`/`DiffSpec`/`CommitInfo`를 **읽어서 재사용**한다. 새 타입을 여기에 추가하지 않는다.

---

## 7. 테스트 요구사항

모든 순수 로직에 `#[cfg(test)] mod tests`를 붙인다. **hermetic**: 네트워크 없음, 실제 git 저장소는 `tempdir` 안에서 직접 만든 것만 사용.

| Phase | 최소 테스트 |
|---|---|
| P0 | `worktree_hash` 결정성(같은 입력 → 같은 해시, 순서 무관), `manifest_diff_count`, `shared_state_dir`가 worktree `commondir` 파일을 해석, 레지스트리에 **중복 rule_id 없음**, 모든 `FindingKind`가 레지스트리에 존재 |
| P1 | 룰마다 최소 3개: 참양성 1, 참음성 1, 경계(테스트 파일 제외·다른 언어 스킵) 1. `context_from_diff`의 라인 번호 정확성 |
| P2 | 락파일에 있는 import → finding 없음 / 없는 import → `HallucinatedDependency` / 락파일 자체가 없음 → `ScanLimit{MissingArtifact}` (finding 아님) |
| P3 | 픽스처 JSONL(수 KB)로 요약 fold 검증. **4 MiB 초과 라인 스킵**, 예산 초과 시 `truncated=true`, 알 수 없는 레코드 타입 무시가 각각 별도 테스트 |
| P4 | 검토 마킹 후 diff 변경 → `Stale`, 동일 → `Reviewed`. 커밋 검토는 `Stale`이 되지 않음 |
| P5 | lcov 파서(`SF:`/`DA:`/`end_of_record`), 추가 라인 ↔ 커버 라인 교차, `EvidenceFreshness` 3분기 |
| P6 | 엉킴 휴리스틱 임계값, revert 안전성 판정, 트레일러 파싱(다중 트레일러·접힌 값) |
| **전 phase 공통** | **`VerificationReport`가 항상 §2.3의 불변식을 만족한다** — 룰이 0개 발견해도 `checked`+`unchecked`가 레지스트리를 덮는지 검증하는 테스트를 각 리포트 생성 지점마다 1개씩 |

---

## 8. 프론트엔드 계약 요약 (P8)

- `src/types/verify.ts`: §2의 모든 직렬화 타입을 TS로 미러링. `FindingKind`·`Severity`·`ReviewStatus`·`UncheckedReason`·`LinkConfidence`·`RuleStatus`·`BashCommandKind`·`SessionSource`는 **문자열 리터럴 유니온**(camelCase 값). `EvidenceFreshness`는 `{ type: "fresh" } | { type: "stale"; changedFiles: number | null } | { type: "absent" }` 판별 유니온.
- `src/api/verify.ts`: §3 커맨드 전부의 `invoke()` 래퍼. 컴포넌트에서 `invoke()` 직접 호출 금지.
- **i18n**: `message`/`detail`은 백엔드가 준 영어 증거 문자열을 **그대로** 표시하고, 제목·설명은 `t("verify.rule.<ruleId>.title")` / `t("verify.rule.<ruleId>.description")`으로 렌더한다. 미검사 사유는 `t("verify.unchecked.<reason>")`.
- **UI 금지 사항** (spec §6·§7-①):
  - 전역 초록 체크마크 금지. findings 0개일 때 표시 문구는 "검사 통과"가 아니라 **"검사한 룰 N개 · 미검사 M개"**다.
  - push 게이트는 차단하지 않는다 — 버튼을 비활성화하지 않는다.
  - "AI가 쓴 테스트"류 낙인 문구 금지. 구체 패턴만 지적한다 (§P3).
  - `LinkConfidence::Low` 상관을 확정 프로버넌스로 렌더 금지.
  - 커버리지(V12)를 테스트 품질(V3) 없이 단독 표시 금지.

---

## 9. 알려진 취약점 — 구현자가 알고 시작할 것

이 계약 자체의 가장 약한 지점 5가지. 발견하면 리포트에 적을 것.

1. **`unchecked` 회계가 지루해서 빠뜨리기 쉽다.** 룰을 짜다 보면 findings만 반환하고 `checked`/`limits`를 대충 채우게 된다. 그러면 §7-①이 무너지고 도구가 오히려 해롭다. §7의 공통 테스트가 이걸 막는 유일한 장치다.
2. **세션 로그 포맷은 스펙이 없다** (§7-⑥). Claude Code CLI 마이너 버전 하나에 P3 전체가 죽을 수 있다. 어댑터 격리와 "조용한 실패"가 지켜지지 않으면 verify 기능 전체가 앱을 시끄럽게 만든다.
3. **세션↔커밋 상관은 근본적으로 휴리스틱이다** (§7-⑧). worktree 병렬 세션에서 오귀속이 난다. `High` 기준을 느슨하게 푸는 순간 이 기능은 없느니만 못해진다.
4. **V3(테스트 안티패턴)은 오탐 공장이 될 수 있다** (§7-②). 기본 OFF로 둔 이유다. 켜졌을 때 노이즈가 심하면 배지 전체가 무시된다.
5. **V2/V5/V6은 pre-commit hook이 더 싸게 한다** (§7-③). 이 서브시스템의 정당성은 차단이 아니라 **diff 옆에 붙는 배치**와 V13/V29(읽는 행위 자체의 개선)에 있다. 이 구분을 놓치면 GitBaro는 "느린 lint"가 된다.

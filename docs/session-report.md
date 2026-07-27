# 세션 리포트 (Session Report) — 아키텍처 계약

> **Status**: AUTHORITATIVE. 이 문서는 `docs/verify-contract.md`를 **대체하지 않고 그 위에 얹힌다.**
> 두 문서가 충돌하면 **이 문서가 이긴다** (contract는 룰 엔진의 계약이고, 이 문서는 제품의 계약이다).
> **Scope**: 프론트엔드 전면 교체 + `verify/report/**` 신설 + `verify/session/**` 강화. **Rust 룰 엔진은 하나도 지우지 않는다.**

---

## 0. 왜 바꾸는가 — 이 문서 전체를 지배하는 문장

> "애매하게 정보를 나열만 하는 느낌이라 어디에서 임팩트를 얻어야 할지 모르겠다."

38개 룰은 **신호**를 만든다. 결정이 붙지 않은 신호는 소음이다. 사용자는 여전히 이야기를 스스로 재구성해야 했다.

세 가지 사실이 이 피벗을 강제한다.

1. **정적 diff 룰은 lint와 CI가 더 싸게 한다.** GUI의 정당성은 lint 재실행이 아니라 **이해시키기**에 있다.
2. **에이전트 실패의 지배적 형태는 diff에 흔적을 남기지 않는다.** 20,574 세션 연구의 1위 실패는 "요청을 오해했지만 그 오해를 정확히 구현했다"이다. 어떤 정적 검사도 잡을 수 없고, **실제로 뭘 시켰는지와 대조해야만** 보인다.
3. **세션 로그 읽기는 클라우드 PR 봇이 구조적으로 못 하는 유일한 일이다.** `~/.claude` · `~/.codex`는 로컬 디스크에만 있다.

그래서 컨테이너가 바뀐다: **"체크 결과 목록" → "세션 하나당 서사 한 편".**
룰 엔진은 삭제되지 않는다. **그 서사 안의 증거(evidence)로 강등된다.**

### 0.1 사용자가 내린 두 결정 (구현 대상 — 재논의 금지)

**DECISION A — 세션 로그가 없으면 검증 UI는 아예 없다.**
GitBaro는 이 기능이 존재하기 *전과 완전히 동일하게* 동작한다. 빈 상태(empty state) 없음, 플레이스홀더 패널 없음, "훅을 설치하면 활성화됩니다" 같은 유도 문구 없음. **할 말이 있을 때만 보인다.**

**DECISION B — 독립적인 룰 목록 화면은 전부 제거한다.**
룰 엔진은 리포트에 증거를 공급하는 경로로만 살아남는다.

### 0.2 지면 예산 — 모든 줄에 적용되는 심사 기준

> **읽는 사람이 다음에 할 행동을 바꾸지 않는 줄은 이 페이지에 없다.**

이 문장은 장식이 아니다. 구현 중 "이것도 보여줄까?" 싶을 때마다 이 문장으로 되돌아온다. 답이 "행동은 안 바뀌는데 흥미롭다"면 **넣지 않는다.**

---

## 1. 목표 화면

```
세션 · "로그인 리팩터링 해줘"                    2시간 전 · 47분 · Claude Code
──────────────────────────────────────────────────────────────────────────
무엇을 시켰나     최초 프롬프트 + 후속 프롬프트 (원문 그대로)
무엇을 했나       커밋, 건드린 파일, 파일별 편집 횟수 (churn = 헤맨 자리)
무엇을 겪었나     bash 실행, 테스트 성공/실패, "N번 실패 → 테스트를 고침", --no-verify
무엇이 영향받나   blast radius: 바뀐 심볼의 호출부, 그중 이 세션이 **안 고친** 것
시킨 것과 다른 것 프롬프트가 말한 범위 vs 실제로 바뀐 경로
```

한 페이지 · 한 커맨드 · N+1 없음.

---

## 2. STEP 1 — 각 섹션을 이미 무엇이 답하고 있는가

범례: **✅ 있음** (필드가 그대로 존재) / **🔧 파생 필요** (데이터는 있으나 조립 필요) / **❌ 없음** (새로 만들어야 함)

### 2.1 § 무엇을 시켰나

| 필요한 것 | 상태 | 위치 / 근거 |
|---|---|---|
| 최초 사용자 프롬프트 | ✅ | `SessionSummary.first_user_prompt` (`types.rs:522`), 2,000자 컷 |
| 세션 정체성 (id·source·cwd·branch·시작/종료) | ✅ | `SessionSummary.{session_id, source, cwd, git_branch, started_at, ended_at}` |
| compaction 경계 | ✅ | `SessionSummary.compaction_boundaries` |
| 부분 관측 여부 | ✅ | `SessionSummary.{truncated, skipped_records}` |
| **후속 프롬프트 전체** | ❌ | `event.rs`의 `SessionEvent::Prompt`는 **모든 사용자 턴마다 방출된다** (`claude_code.rs:111,146`). 버리는 곳은 fold 단 한 줄: `summary.rs:103` `if self.first_prompt.is_none()`. → `Fold`에 `prompts: Vec<PromptRecord>` 추가만 하면 된다. |
| 슬래시 커맨드 확장 / 훅 주입 텍스트 배제 | 🔧 | `claude_code.rs:99`가 `isMeta`는 이미 거른다. `<command-name>`/`<command-message>` 블록과 `<system-reminder>`는 아직 안 거른다 → 프롬프트가 오염된다 |
| 세션 파일 mtime | 🔧 | `SessionRef.modified_at` (`session/mod.rs:34`)에 있으나 **`SessionSummary`로 넘어가지 않는다** |

### 2.2 § 무엇을 했나

| 필요한 것 | 상태 | 위치 / 근거 |
|---|---|---|
| 파일별 편집 횟수 (churn) | ✅ | `FileEditSummary.edit_count` — V25가 이미 쓴다 (`rules.rs:315`) |
| 읽고 고쳤나 | ✅ | `FileEditSummary.was_read_first` (신규 생성 파일은 true로 정규화됨 — `summary.rs:197`) |
| 서브에이전트 / bash / compaction 이후 편집 | ✅ | `FileEditSummary.{by_subagent, via_bash, after_compaction}` |
| 첫/마지막 편집 시각 | ✅ | `FileEditSummary.{first_edit_at, last_edit_at}` |
| 읽은 파일 목록 | ✅ | `SessionSummary.files_read` |
| 세션 ↔ 커밋 연결 | 🔧 | `correlate.rs::correlate()` — **있으나 신뢰할 수 없다.** §5 참조 |
| 커밋의 변경 파일 목록 | ✅ | `hygiene::commit_changed_paths` (`commands/session.rs:160`에서 사용) |
| **커밋 메타 (summary·author·삽입/삭제 줄수)** | ❌ | `CommitRef`는 `{oid, timestamp_ms, files}`만 담는다 |
| **파일별 +/- 줄수** | ❌ | `get_session_cumulative_diff`가 통짜 `DiffOutput`을 준다 — 리포트 헤더용으로는 과하다 |
| **절대경로 → 저장소 상대경로 변환** | 🔧 | `correlate.rs::normalize()`가 하지만 **private** |
| **"편집했으나 커밋 안 됨" 분리** | ❌ | 없음 |

### 2.3 § 무엇을 겪었나

| 필요한 것 | 상태 | 위치 / 근거 |
|---|---|---|
| bash 명령 목록 + 시각 + 실패 여부 | ✅ | `BashCommandRecord{command, at, is_error, kind}` |
| 테스트 실행 판별 | ✅ | `bash.rs::TEST_MARKERS` — 17개 러너, 토큰 시퀀스 매칭 |
| `--no-verify` 등 우회 | ✅ | `bash.rs::find_bypass_markers` → `BashCommandKind::HookBypass` |
| 셸을 통한 파일 변조 | ✅ | `BashCommandKind::FileMutation` + `BashClassification.mutated_paths` |
| **"N번 실패 → 테스트 파일을 고침" 시퀀스** | ✅ | `session/rules.rs::test_failure_then_test_edited` (V20). 임계값 `TEST_FAILURE_THRESHOLD = 2` |
| **우회 토큰 원문** | ❌ | `BashClassification.bypass_markers`는 **계산되고 즉시 버려진다.** `BashCommandRecord`에 `kind`만 남는다 |
| **테스트 통과/실패 개수 ("3 failed, 27 passed")** | ❌ | tool_result 본문을 보관하지 않는다. `is_error` 불리언이 전부. **이번 범위 밖 — 실행 횟수와 실패 횟수만 보고한다** |

### 2.4 § 무엇이 영향받나

| 필요한 것 | 상태 | 위치 / 근거 |
|---|---|---|
| 시그니처 바뀐 심볼 | ✅ | `context/changes.rs::changed_symbols` → `ChangeSet.signature_changed` |
| 호출부 목록 + 이 diff가 건드렸는지 | ✅ | `reach.rs::blast_radius` → `BlastRadiusEntry{callers, caller_count, untouched_caller_count, resolution}`, `CallSite.touched_in_diff` |
| 이름 모호성 정직 표기 | ✅ | `CallerResolution::NameAmbiguous{definitions}` |
| 심볼 인덱스 | ✅ | `SymbolIndexStore::snapshot()`, `RepoIndex{complete, files_total}` |
| 인덱스 없음 사유 문구 | ✅ | `context/mod.rs::describe_missing_index` |
| **커밋 *범위*(A..B)에 대한 FileRevision 조립** | ❌ | `commands/syntax.rs::scan_sources`는 단일 커밋 또는 워킹트리만 다룬다. blob 읽기 헬퍼(`blob_bytes`, `commit_source`)는 **전부 private** |
| **커밋 귀속이 없을 때의 폴백** | ❌ | 없음 |

### 2.5 § 시킨 것과 다른 것 (V26)

| 필요한 것 | 상태 |
|---|---|
| 프롬프트 원문 | ✅ (§2.1) |
| **경로/모듈 언급 추출** | ❌ 전무 |
| **저장소 대조 해석(resolve)** | ❌ 전무 |
| **실제 변경 경로와 비교** | ❌ 전무 |
| 레지스트리 등재 | ✅ `planned("v26.promptScopeDrift", "V26", 5)` (`registry.rs`), `FindingKind::PromptScopeDrift` 존재하나 **아무도 생성하지 않는다** |
| 유사 선례 | 🔧 `rules/scope.rs` (V6)가 conventional-commit scope ↔ 경로를 비교한다. **아이디어만 재사용, 코드는 재사용 불가** (입력이 다르다) |

### 2.6 전 섹션 공통으로 없는 것

**한 번에 다 주는 커맨드가 없다.** 현재 UI는 `list_sessions_for_repo` → `get_session_summary` → `verify_session` → `correlate_sessions_to_commits` → `get_session_cumulative_diff` → `get_blast_radius` → `get_symbol_index_status`, 최소 7회 왕복이 필요하다. 이것이 `SessionReport` 단일 커맨드를 만드는 이유다.

---

## 3. STEP 2 — `SessionReport` 명세

### 3.1 커맨드 (`src-tauri/src/commands/report.rs`, 신규)

```rust
/// 이 저장소의 세션 목록 — **DECISION A 게이트의 유일한 데이터 소스**.
/// 세션 디렉터리가 없거나 전부 파싱 실패면 빈 Vec (에러 아님).
/// 기존 `(size, mtime)` 요약 캐시를 그대로 쓰므로 재파싱 비용이 없다.
#[tauri::command]
pub async fn list_session_digests(
    repo_path: String,
    limit: Option<usize>,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<Vec<SessionDigest>, AppError>;

/// 한 세션의 전체 리포트. 페이지가 필요한 모든 것이 여기 들어 있다.
/// 파싱 불가 / 인식 불가면 `Ok(None)` — 프론트는 아무것도 렌더하지 않는다.
#[tauri::command]
pub async fn get_session_report(
    repo_path: String,
    session_path: String,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<Option<SessionReport>, AppError>;
```

두 개가 전부다. `store`는 **읽기 전용 스냅샷**으로만 쓴다 — 리포트 커맨드는 **절대 인덱스를 빌드하지 않는다** (§3.7).

### 3.2 최상위 형태

```rust
// src-tauri/src/verify/report/model.rs — 이 파일이 아래 전부의 유일한 소유자.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionReport {
    pub header: ReportHeader,
    /// § 무엇을 시켰나
    pub asked: AskedSection,
    /// § 무엇을 했나
    pub did: DidSection,
    /// § 무엇을 겪었나
    pub went_through: WentThroughSection,
    /// § 무엇이 영향받나
    pub impact: ImpactSection,
    /// § 시킨 것과 다른 것
    pub drift: DriftSection,
    /// epoch 밀리초.
    pub generated_at: i64,
}
```

### 3.3 공용 어휘 — 프로버넌스와 미가용 사유

```rust
/// 이 항목이 **어디서 왔는가**. UI는 이걸로 정직함의 수위를 조절한다.
/// 세션 로그는 사실이고, 상관관계에서 파생된 것은 추정이다.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Provenance {
    /// 에이전트 세션 로그에 그대로 적혀 있다. 가장 강한 근거.
    SessionLog,
    /// git 오브젝트에서 직접 읽었다. 사실.
    Git,
    /// 트리시터 심볼 인덱스가 이름 기반으로 해석했다. 불완전할 수 있다.
    SymbolIndex,
    /// 위 둘 이상을 조합해 계산했다. 상관관계 신뢰도의 영향을 받는다.
    Derived,
}

/// 섹션 하나가 통째로 답할 수 없는 이유.
/// **모든 섹션은 `unavailable`이 `Some`이면 본문 필드를 비운 채로 온다.**
/// UI는 `unavailable`이 있으면 그 섹션을 **렌더하지 않거나**, 한 줄 사유만 쓴다.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Unavailable {
    pub reason: UnavailableReason,
    /// 사람이 읽을 구체 사유. 번역하지 않는 사실 문장.
    /// 예: `"symbol index is partial (412 of 5100 file(s) indexed)"`.
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UnavailableReason {
    /// 세션 로그에 사용자 프롬프트가 하나도 없다.
    NoPrompt,
    /// 프롬프트에 저장소에서 해석되는 경로·심볼 언급이 하나도 없다 (V26 G1).
    NoResolvableAnchor,
    /// 어떤 커밋도 이 세션에 귀속할 만큼 근거가 강하지 않다 (§5의 거부 규칙).
    NoCommitAttribution,
    /// 이 저장소에 심볼 인덱스가 없다. UI는 "지금 만들기"를 제안할 수 있다.
    NoSymbolIndex,
    /// 인덱스가 부분적이다 — 부분 인덱스는 **없는 것과 동일하게** 취급한다.
    PartialSymbolIndex,
    /// 이 에이전트의 로그에는 해당 데이터가 애초에 없다 (Codex: read/sidechain/compaction).
    UnsupportedAgent,
    /// 파싱 예산 초과로 로그 뒷부분을 못 읽었다.
    ParseBudget,
    /// 해당 없음 — 예: 시그니처가 하나도 안 바뀌었다.
    NotApplicable,
}
```

### 3.4 헤더

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportHeader {
    pub session_id: String,
    pub session_path: String,
    pub source: SessionSource,          // "claudeCode" | "codex"
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub cwd: String,
    pub git_branch: Option<String>,
    /// 한 줄 제목. **백엔드가 만든다** — UI가 조합하지 않는다.
    /// 우선순위: 첫 프롬프트 첫 줄(80자 컷) → 브랜치명 → session_id 앞 8자.
    pub title: String,
    /// cwd가 이 워크트리인지, 형제 워크트리인지, 하위 디렉터리인지.
    pub cwd_relation: CwdRelation,
    /// truncated || skipped_records > 0.
    /// **true면 이 리포트의 모든 수치는 하한(floor)이지 총계가 아니다.**
    pub partial: bool,
    pub truncated: bool,
    pub skipped_records: usize,
    pub compaction_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CwdRelation {
    /// 세션 cwd가 지금 보고 있는 워크트리(또는 그 하위)다.
    ThisWorktree,
    /// 같은 저장소의 **다른** 워크트리에서 돌았다. High 귀속 불가.
    SiblingWorktree,
    /// 이 저장소와 무관하다. (여기까지 오면 안 되지만 방어적으로 표기)
    Unrelated,
}
```

### 3.5 § 무엇을 시켰나

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AskedSection {
    pub unavailable: Option<Unavailable>,
    /// 시간 오름차순. 최대 `MAX_REPORT_PROMPTS`개.
    pub prompts: Vec<PromptRecord>,
    /// 잘렸을 수 있으므로 총 개수를 따로 보낸다.
    pub total_prompts: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptRecord {
    pub at: i64,
    /// 원문. `MAX_PROMPT_CHARS`(2,000)에서 잘린다. 번역·요약 금지.
    pub text: String,
    pub truncated: bool,
    /// 0-based. 0번은 **명세 앵커**, 나머지는 정정(correction)이다.
    pub ordinal: u32,
    /// 이 프롬프트 뒤에 compaction이 있었다 = 이 지시가 컨텍스트에서 사라졌을 수 있다.
    pub compacted_away: bool,
    pub provenance: Provenance,     // 항상 SessionLog
}
```

**`compacted_away`가 이 섹션의 유일한 판단이다.** "당신이 3번째로 한 지시는 그 뒤 컨텍스트 압축으로 사라졌을 수 있다"는 문장은 읽는 사람의 다음 행동을 바꾼다. 나머지는 원문 인용이다.

### 3.6 § 무엇을 했나

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DidSection {
    /// **커밋 절반만 미가용일 수 있다.** 파일 편집은 세션 로그에서 오므로
    /// 상관관계가 실패해도 항상 채워진다 — 이 섹션은 절대 통째로 비지 않는다.
    pub unavailable: Option<Unavailable>,
    /// 귀속이 `Low`이거나 거부됐으면 **빈 배열**이다.
    pub commits: Vec<ReportCommit>,
    /// 귀속을 거부했으면 `None`.
    pub attribution: Option<CommitAttribution>,
    /// 세션이 편집한 파일. 저장소 상대 경로, churn 내림차순 → 경로 오름차순.
    pub files: Vec<TouchedFile>,
    pub files_edited_count: usize,
    pub files_read_count: usize,
    /// 세션이 편집했지만 귀속된 어떤 커밋에도 없는 경로 = **아직 커밋 안 된 작업**.
    /// 귀속이 없으면 빈 배열(전부 미커밋이라고 단정하지 않는다).
    pub uncommitted_paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportCommit {
    pub commit_id: String,
    pub summary: String,
    pub author_name: String,
    /// epoch **밀리초** (`commit.time().seconds() * 1000`).
    pub committed_at: i64,
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
    /// 이 커밋에 있으나 세션이 편집한 적 없는 파일.
    /// **Medium 신뢰도의 이유가 여기 그대로 드러난다.**
    pub unattributed_files: Vec<String>,
    pub confidence: LinkConfidence,
    pub provenance: Provenance,     // Git
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitAttribution {
    /// 귀속된 커밋들 중 **최고** 등급 (§5에서 weakest→best로 바뀐다).
    pub confidence: LinkConfidence,
    /// 근거 토큰. §5의 확장된 집합.
    pub basis: Vec<String>,
    /// 후보였지만 탈락한 커밋과 그 이유. 정직성의 핵심.
    pub rejected: Vec<RejectedCommit>,
    /// 같은 커밋을 두 세션이 동등하게 주장했다 → 아무에게도 귀속하지 않았다.
    pub ambiguous_with: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RejectedCommit {
    pub commit_id: String,
    pub reason: RejectionReason,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RejectionReason {
    MergeCommit,
    BranchMismatch,
    NoFileOverlap,
    OutsideSessionWindow,
    DifferentWorktree,
    DifferentAuthor,
    /// 다른 세션이 동등하거나 더 강하게 주장했다.
    AmbiguousWithAnotherSession,
    /// 부분 관측 로그로는 부분 커버리지 주장을 지탱할 수 없다.
    PartialLogInsufficient,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TouchedFile {
    /// **저장소 상대 경로.** 세션 로그의 절대 경로는 여기서 정규화된다.
    pub path: String,
    /// V25 churn — 헤맨 자리. 이 섹션의 주인공.
    pub edit_count: u32,
    pub was_read_first: bool,
    pub by_subagent: bool,
    pub via_bash: bool,
    pub after_compaction: bool,
    pub first_edit_at: i64,
    pub last_edit_at: i64,
    /// 귀속된 커밋들에서의 줄 수. 귀속이 없으면 `None`.
    pub added_lines: Option<u32>,
    pub removed_lines: Option<u32>,
    /// 귀속된 커밋 중 하나에라도 이 경로가 있는가.
    pub in_commit: bool,
    /// 경로 기반 테스트 판정 (`context::model::is_test_path` 재사용).
    pub is_test: bool,
    pub provenance: Provenance,     // SessionLog (줄 수만 Derived)
}
```

### 3.7 § 무엇을 겪었나

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WentThroughSection {
    pub unavailable: Option<Unavailable>,
    pub bash_total: usize,
    pub test_runs: usize,
    pub failed_test_runs: usize,
    /// 시간 오름차순. `MAX_REPORT_EVENTS`(120)에서 자른다.
    /// **`Other` 종류의 bash는 여기 들어오지 않는다** — 120개 `ls`는 서사가 아니다.
    pub events: Vec<OrdealEvent>,
    /// 이 섹션의 결론. "N번 실패 → 테스트를 고쳤다"는 이 페이지에서
    /// 가장 행동을 바꾸는 한 줄이므로 이벤트 스트림과 별도로 승격한다.
    pub test_edits_after_failure: Vec<TestEditAfterFailure>,
    /// 코드를 고쳤는데 테스트를 **한 번도** 안 돌렸다 (V20).
    pub never_ran_tests: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OrdealEvent {
    pub at: i64,
    pub kind: OrdealKind,
    /// 명령 원문 또는 경로. `MAX_COMMAND_CHARS`(512) 컷. **번역하지 않는다.**
    pub evidence: String,
    /// 우회 토큰(`--no-verify`), 변조 대상 경로 등 부가 증거.
    pub detail: Option<String>,
    pub severity: Severity,
    pub provenance: Provenance,     // SessionLog
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OrdealKind {
    TestPassed,
    TestFailed,
    /// `--no-verify`, `SKIP=`, `push -f`, `chmod` … (`bash.rs::find_bypass_markers`)
    HookBypass,
    /// 셸 리다이렉트·`sed -i`·`rm` — 체크포인트 복원 사각지대 (V22).
    ShellMutation,
    /// 컨텍스트 압축 (V24).
    Compaction,
    /// 서브에이전트 사이드체인 편집 (V23).
    SubagentEdit,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestEditAfterFailure {
    pub test_path: String,
    /// 이 편집 **이전에** 관측된 실패 횟수. `TEST_FAILURE_THRESHOLD`(2) 이상만 온다.
    pub failures_before: usize,
    /// 실패한 명령 원문들. 최대 5개.
    pub failing_commands: Vec<String>,
    pub edited_at: i64,
}
```

### 3.8 § 무엇이 영향받나

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImpactSection {
    /// `NoSymbolIndex` / `PartialSymbolIndex` / `NotApplicable`(시그니처 변경 없음).
    pub unavailable: Option<Unavailable>,
    /// `reach.rs::BlastRadiusEntry`를 **그대로 재사용**한다. 새 타입을 만들지 않는다.
    /// `untouched_caller_count > 0`인 항목만 담는다 —
    /// 전부 같이 고쳐진 시그니처 변경은 할 말이 없다.
    pub entries: Vec<BlastRadiusEntry>,
    pub total_untouched_callers: usize,
    /// 인덱스 상태를 그대로 노출해 UI가 "지금 만들기"를 제안할 수 있게 한다.
    pub index_state: IndexState,
    /// blast radius를 어느 기준선과 비교했는가.
    pub basis: ImpactBasis,
    pub provenance: Provenance,     // SymbolIndex
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImpactBasis {
    /// 귀속된 가장 오래된 커밋의 첫 부모 → 가장 최근 커밋. 가장 정확하다.
    AttributedCommitRange,
    /// 귀속이 없어 HEAD ↔ 워킹트리를 세션 편집 경로로 좁혀 비교했다.
    /// 세션 이후의 다른 변경이 섞일 수 있다 — UI는 이 사실을 말해야 한다.
    WorktreeFallback,
}
```

**인덱스는 절대 리포트 커맨드에서 빌드하지 않는다.** `SymbolIndexStore::snapshot()`으로 캐시만 읽는다. 없으면 `unavailable{NoSymbolIndex}`. 빌드는 사용자가 §4 안의 버튼으로 기존 `build_symbol_index` 커맨드를 호출할 때만 일어난다. **이것은 유도(nag)가 아니다 — 이미 존재하는 페이지 안의 행동이다.**

### 3.9 § 시킨 것과 다른 것

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriftSection {
    /// `NoPrompt` 또는 `NoResolvableAnchor`. **앵커가 0개면 여기서 끝난다.**
    pub unavailable: Option<Unavailable>,
    /// 프롬프트에서 뽑아낸 모든 언급 — 해석된 것과 안 된 것 전부.
    pub mentions: Vec<PromptMention>,
    /// 해석된 앵커가 규정한 범위 안에서 바뀐 경로.
    pub in_scope_paths: Vec<String>,
    /// 프롬프트가 지목하지 않은 곳에서 바뀐 경로. churn 내림차순.
    /// `MAX_DRIFT_PATHS`(20)에서 자르고 `drifted_total`로 총수를 알린다.
    pub drifted_paths: Vec<DriftedPath>,
    pub drifted_total: usize,
    pub changed_total: usize,
    pub verdict: DriftVerdict,
    pub confidence: LinkConfidence,
    /// 변경 경로를 커밋에서 얻었는가, 세션 편집 목록에서 얻었는가.
    pub basis: ImpactBasis,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptMention {
    /// 프롬프트에 적힌 원문 토큰. 그대로 인용된다.
    pub raw: String,
    pub extractor: MentionExtractor,
    /// 저장소에서 무엇으로 해석됐는가. `None`이면 미해석 — **범위를 좁히지 않는다.**
    pub resolved: Option<ResolvedAnchor>,
    /// 이 언급이 나온 프롬프트의 ordinal.
    pub prompt_ordinal: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MentionExtractor {
    /// 백틱 안. 가장 강한 신호.
    Backtick,
    /// 확장자를 가진 토큰 (`utils.ts`).
    Extension,
    /// 슬래시를 가진 토큰 (`src/verify`, `@/api/commands`).
    PathLike,
    /// CamelCase / snake_case 식별자. 심볼 인덱스가 있어야만 동작.
    Identifier,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAnchor {
    /// 저장소 상대 경로. 디렉터리면 끝에 `/`가 붙는다.
    pub path: String,
    pub kind: AnchorKind,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnchorKind {
    File,
    Directory,
    /// 심볼 이름이 유일하게 정의된 파일로 해석됐다.
    SymbolDefinition,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriftedPath {
    pub path: String,
    pub edit_count: u32,
    pub added_lines: Option<u32>,
    pub removed_lines: Option<u32>,
    pub is_test: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DriftVerdict {
    /// 앵커 0개 — 섹션이 렌더되지 않는다. `unavailable`과 함께 온다.
    NoAnchor,
    /// 프롬프트가 지목한 곳 안에서만 바뀌었다.
    WithinScope,
    /// 일부는 지목한 곳, 일부는 아니다.
    PartialDrift,
    /// 앵커가 있는데 그 경로는 **하나도** 안 바뀌었다.
    /// 이 페이지에서 가장 가치 있는 판정이다 — 에이전트가 딴 데를 고쳤다.
    FullDrift,
}
```

### 3.10 목록용 경량 타입

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionDigest {
    pub session_id: String,
    pub session_path: String,
    pub source: SessionSource,
    /// `ReportHeader.title`과 동일 규칙.
    pub title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub git_branch: Option<String>,
    pub files_edited_count: usize,
    /// `High`/`Medium`으로 귀속된 커밋만. 거부됐으면 빈 배열.
    pub commit_ids: Vec<String>,
    pub attribution: Option<LinkConfidence>,
    pub partial: bool,
}
```

### 3.11 상수

```rust
// verify/report/mod.rs
pub const MAX_REPORT_PROMPTS: usize = 40;
pub const MAX_REPORT_EVENTS: usize = 120;
pub const MAX_REPORT_FILES: usize = 300;
pub const MAX_DRIFT_PATHS: usize = 20;
pub const MAX_IMPACT_ENTRIES: usize = 30;
/// 리포트 조립 전체의 벽시계 예산. 초과하면 아직 못 채운 섹션은
/// `unavailable{ParseBudget}`로 마감한다 — 에러가 아니다.
pub const MAX_REPORT_MILLIS: u64 = 3_000;
```

### 3.12 불변식 (구현자가 반드시 지킬 것)

1. **`get_session_report`는 절대 `Err`를 UI로 올리지 않는다** (세션 파일 자체를 못 여는 경우 제외). 파싱 실패·인덱스 없음·귀속 실패는 전부 `unavailable`이다.
2. **`DidSection.files`는 절대 비지 않는다** (세션이 파일을 하나라도 편집했다면). 세션 로그는 상관관계와 무관하게 사실이다.
3. **`Low` 신뢰도 귀속은 존재하지 않는 것으로 취급한다.** `commits`는 비고 `attribution`은 `None`이 된다.
4. **`unavailable`이 `Some`인 섹션의 본문 필드는 전부 빈 값이다.** 반쯤 채워 보내지 않는다.
5. **모든 `message`/`evidence`/`detail`은 번역하지 않는 영어 사실 문장이다.** 제목·설명은 `t("report.*")` i18n 키로 렌더한다 (contract §8 규칙 승계).
6. `SessionReport`는 **한 번의 `spawn_blocking`** 안에서 조립한다. 섹션마다 블로킹 태스크를 띄우지 않는다.

---

## 4. STEP 3 — V26 `promptScopeDrift` 결정론적 알고리즘

> **레지스트리 변경**: `planned("v26.promptScopeDrift", "V26", 5)` → `implemented("v26.promptScopeDrift", K::PromptScopeDrift, "V26", 5, Warn, true)`.
> **기본 ON으로 승격한다.** 이 룰이 곧 § 다섯 번째 섹션이고, 꺼져 있으면 페이지가 절반만 답한다.

전체 파이프라인은 4단계다. 각 단계는 순수 함수이며 네트워크·LLM을 쓰지 않는다.

### 4.1 Stage A — 추출 (extract)

입력은 **사용자 프롬프트 전부**(`AskedSection.prompts`)이며, 에이전트가 쓴 텍스트는 **절대** 입력이 아니다.

전처리:
- 정보 문자열이 `bash|sh|zsh|shell|console|text`인 펜스 블록은 **통째로 버린다**. 셸 예시 안의 경로는 지시가 아니다.
- `<system-reminder>` · `<command-name>` · `<command-message>` · `<local-command-stdout>` 태그 블록을 제거한다.
- URL(`http://`, `https://`)은 제거한다.

네 개의 추출기가 각자 후보를 낸다 (중복은 원문 토큰 기준으로 dedup):

| 추출기 | 규칙 | 예 |
|---|---|---|
| `Backtick` | 백틱 쌍 사이의 내용을 공백·쉼표로 분할 | `` `src/verify/session/rules.rs` `` |
| `Extension` | 공백 구분 토큰 중 `.<ext>`로 끝나고 ext가 허용 목록에 있는 것. 허용: `ts tsx js jsx mjs cjs rs json md toml yaml yml css scss html sql sh` | `utils.ts` |
| `PathLike` | `/`를 포함하고 공백이 없으며 세그먼트가 2개 이상, 각 세그먼트가 `[A-Za-z0-9_.@\-]+` | `src/verify`, `@/api/commands` |
| `Identifier` | CamelCase(대문자 경계 2개 이상) 또는 snake_case(`_` 1개 이상, 전부 소문자, 세그먼트 2개 이상). **심볼 인덱스가 있을 때만 동작** | `SessionSummary`, `run_diff_rules` |

모든 토큰은 앞뒤 문장부호 `.,;:!?)]}"'` 를 벗겨낸다.

### 4.2 Stage B — 거부 (reject) — 해석 **전에** 거른다

다음은 후보에서 즉시 제거한다:

- 길이 ≤ 2 문자
- 순수 숫자, 버전 문자열(`v2`, `1.2.3`, `2.0.0-rc1`)
- 스톱워드 테이블 (`patterns.rs` 스타일 리터럴 상수):
  `test tests testing code build run fix bug api ui type types error errors main src lib app util utils config setup index data file files function class method`
  및 한국어: `코드 테스트 파일 함수 버그 수정 에러 데이터 설정`
- 토큰이 `$`로 시작 (셸 변수)
- `Identifier` 추출기의 결과 중 심볼 인덱스에 정의가 **0개**인 것 (인덱스 없으면 이 추출기 자체가 비활성)

> 스톱워드는 **해석 전에** 적용된다. `test`가 우연히 `test/` 디렉터리로 해석되어 앵커가 되면 "테스트 고쳐줘"라는 프롬프트가 전 저장소를 drift로 만든다.

### 4.3 Stage C — 해석 (resolve) — 첫 히트가 이긴다

각 후보를 순서대로 시도한다. 어떤 단계도 성공하지 못하면 **미해석**으로 남고, 미해석 언급은 `mentions`에 표시만 되고 **범위를 좁히지도 넓히지도 않는다.**

1. 저장소 상대 경로로서 **파일이 존재** → `AnchorKind::File`
2. 저장소 상대 경로로서 **디렉터리가 존재** → `AnchorKind::Directory` (경로 끝에 `/` 부착)
3. **경로 별칭 확장**
   - `@/x` → `src/x` — 단, 저장소 루트 `tsconfig.json`의 `compilerOptions.paths`에 `"@/*"` 매핑이 실제로 있을 때만. 없으면 이 단계를 건너뛴다.
   - `crate::a::b` → `src/a/b.rs` 또는 `src/a/b/mod.rs` (Rust 파일이 저장소에 있을 때만)
   - 확장 후 1·2단계를 다시 시도
4. **유일 basename 매칭**: 추적 파일 목록에서 basename이 정확히 일치하는 것이 **딱 1개**면 그 경로. 2개 이상이면 **미해석** (추측 금지)
5. **유일 심볼 매칭**: 심볼 인덱스에서 `definitions_of(name).len() == 1`이면 그 정의 파일 → `AnchorKind::SymbolDefinition`. 2개 이상이면 미해석
6. 그 외 → 미해석

추적 파일 목록은 `git2`의 HEAD 트리 + 인덱스에서 한 번만 만들어 재사용한다 (`BTreeSet<String>`).

### 4.4 Stage D — 비교 (compare)

**변경 경로 집합** `changed`:
- 커밋 귀속이 `High`/`Medium`이면 = 귀속된 커밋들의 변경 경로 ∪ 세션 편집 경로 → `basis = AttributedCommitRange`
- 귀속이 없으면 = 세션 편집 경로만 → `basis = WorktreeFallback`, **confidence를 한 단계 낮춘다**

**범위 안(in-scope) 판정** — 변경 경로 `p`가 다음 중 하나면 in-scope:
- 어떤 `File` 앵커와 정확히 같다
- 어떤 `Directory` 앵커 prefix로 시작한다
- 어떤 in-scope 파일의 **테스트 짝**이다: 같은 stem + 테스트 마커(`.test.` `.spec.` `_test.rs`) 또는 `__tests__/<stem>`
- **부수효과 허용 목록**에 있다: `pnpm-lock.yaml` `package-lock.json` `yarn.lock` `bun.lockb` `Cargo.lock` `CHANGELOG.md` `*.snap`
  (락파일 갱신은 새로운 범위가 아니라 편집의 결과다)

나머지는 drift다. 단, **삭제·이름변경의 옛 경로는 drift에서 제외한다** — in-scope 파일의 rename은 양쪽 다 in-scope다.

### 4.5 오탐 방지 가드 — 이 알고리즘이 쓸모없어지지 않게 하는 7개

| ID | 규칙 | 막는 것 |
|---|---|---|
| **G1** | **해석된 앵커가 0개면 `unavailable{NoResolvableAnchor}`로 끝난다. drift를 절대 보고하지 않는다.** | "로그인 리팩터링 해줘" → "전부가 drift"라는 최악의 오탐. **이 문서에서 가장 중요한 한 줄.** |
| **G2** | 앵커 커버리지 = `in_scope / changed_total` 가 `MIN_ANCHOR_COVERAGE`(0.2) 미만이면 confidence를 `Low`로 강등하고 verdict를 `PartialDrift`로만 낸다 (`FullDrift` 금지) | 프롬프트가 경로를 *예시로* 언급했을 뿐인 경우 |
| **G3** | **모든 프롬프트가 앵커를 기여한다.** 첫 프롬프트만 쓰지 않는다 | "그리고 src/x도 고쳐줘"라는 후속 지시가 drift로 찍히는 것 |
| **G4** | 미해석 언급은 범위를 **좁히지 않는다.** 표시만 한다 | 오타·외부 라이브러리명 때문에 범위가 잘못 좁아지는 것 |
| **G5** | 부수효과 허용 목록 (§4.4) | 락파일·CHANGELOG·스냅샷이 매번 drift로 뜨는 것 |
| **G6** | drift 경로는 `MAX_DRIFT_PATHS`(20)에서 자르고 총수를 별도 필드로 준다. 정렬은 churn 내림차순 → 경로 오름차순 | 200줄짜리 drift 목록 = 다시 "정보 나열" |
| **G7** | `header.partial == true`(로그 일부만 읽음)면 confidence를 한 단계 낮추고 `FullDrift`를 금지한다 | 못 읽은 로그 뒷부분에 앵커가 있었을 수 있다 |

### 4.6 신뢰도

```
High   : 해석 앵커 ≥ 2  AND  커버리지 ≥ 0.5  AND  커밋 귀속 == High
Medium : 해석 앵커 ≥ 1  AND  커버리지 ≥ MIN_ANCHOR_COVERAGE(0.2)
Low    : 앵커 ≥ 1인 그 외 전부
(앵커 0개 → 등급 없음, 섹션 미가용)
```

G2·G7은 각각 한 단계씩 강등시킨다 (중복 적용 가능, 바닥은 `Low`).

### 4.7 문장 규칙 — 정확히 이렇게 쓴다

백엔드는 **문장을 만들지 않는다.** `verdict` + 카운트 + 대표 경로만 준다. UI가 i18n 키로 렌더한다.

| verdict | i18n 키 | ko | en |
|---|---|---|---|
| `WithinScope` | `report.drift.withinScope` | `프롬프트가 지목한 {{anchors}}곳 안에서만 바뀌었다.` | `Changed only inside the {{anchors}} place(s) the prompt named.` |
| `PartialDrift` | `report.drift.partial` | `{{total}}개 변경 중 {{drifted}}개가 프롬프트에 없던 곳이다 — {{first}} 외.` | `{{drifted}} of {{total}} changed paths were not named in the prompt — {{first}} and others.` |
| `FullDrift` | `report.drift.full` | `프롬프트는 {{anchorList}}을(를) 지목했지만 그 경로는 하나도 바뀌지 않았다.` | `The prompt named {{anchorList}}, but none of those paths changed.` |

**강제 규칙 3개** (테스트로 검증한다):

1. 문장은 반드시 **숫자 하나 이상**과 **구체 경로 하나 이상**을 포함한다. 둘 다 없으면 그 문장은 렌더하지 않는다.
2. 문장에 **판단어를 넣지 않는다**: `잘못` `위반` `실패` `wrong` `violation` `should` 금지. 사실만 진술한다.
3. `confidence != High`면 UI는 문장 앞에 `t("report.confidence.estimate")` (`추정` / `estimated`) 칩을 붙인다. 백엔드가 문장에 섞지 않는다.

### 4.8 필수 테스트 (P-drift)

- 경로를 하나도 언급하지 않는 프롬프트 → `unavailable{NoResolvableAnchor}`, `drifted_paths.is_empty()`
- 스톱워드만 있는 프롬프트("테스트 고쳐줘") → 동일
- 백틱 경로 1개 + 그 경로만 변경 → `WithinScope`
- 백틱 경로 1개 + 전혀 다른 경로만 변경 → `FullDrift`
- 후속 프롬프트가 추가 경로를 지목 → 그 경로는 drift가 아니다 (G3)
- 락파일 변경 → drift 아님 (G5)
- basename이 2곳에 있는 언급 → 미해석, 앵커 0개면 미가용 (Stage C 4)
- 심볼 인덱스 없음 → `Identifier` 추출기 비활성, 나머지 3개는 동작
- `truncated` 로그 → `FullDrift`가 나오지 않는다 (G7)

---

## 5. STEP 4 — 상관관계(correlation) 강화

> 세션↔커밋 매칭은 이제 "있으면 좋은 것"이 아니라 **제품의 척추**다. 잘못된 귀속 = 잘못된 리포트.

### 5.1 현재 `correlate.rs`의 실제 결함 (읽고 확인함)

| # | 결함 | 근거 |
|---|---|---|
| **1** | **브랜치를 비교하지 않는다.** `correlate.rs:80` `let branch_matches = session.git_branch.is_some();` — 세션이 브랜치를 기록했다는 사실만 확인한다. `feat/x` 세션이 `main` 커밋에 `High`를 받는다. **`High`는 UI가 사실로 진술하도록 허용된 유일한 등급이므로, 이것이 가장 심각한 결함이다.** |
| **2** | **커밋 쪽 브랜치 정보가 아예 없다.** `CommitRef`는 `{oid, timestamp_ms, files}`뿐이다 |
| **3** | **작성자를 보지 않는다.** 같은 시간대의 남의 커밋(리베이스·체리픽 유입분)이 귀속된다 |
| **4** | **머지 커밋을 배제하지 않는다.** 머지의 파일 목록은 저작 작업이 아니다 |
| **5** | **세션 파일 mtime을 버린다.** `SessionRef.modified_at`은 discover 단계에만 존재하고 `SessionSummary`로 넘어가지 않는다 |
| **6** | **겹침을 한 방향으로만 본다.** `grade()`는 `overlap == changed_count`(커밋 커버리지)만 본다. 200개 파일을 만진 세션이 1개 파일 커밋을 `High`로 가져간다 |
| **7** | **병렬 세션 중재가 없다.** 같은 저장소·같은 브랜치·겹치는 시간대의 두 세션이 **둘 다** `High`를 받는다. 한 커밋에 모순되는 리포트 두 개 |
| **8** | **`weakest()`가 방향이 거꾸로다.** `correlate.rs:106` — 나쁜 후보 하나가 좋은 귀속 전체를 끌어내리는데, **그 나쁜 후보는 여전히 `commit_ids` 안에 남는다.** 등급을 낮출 게 아니라 후보를 떨어뜨려야 한다 |
| **9** | **워크트리 개념이 없다.** 같은 저장소의 형제 워크트리에서 돌아간 세션은 `cwd` 불일치로 전부 탈락하거나, 반대로 상위 경로 우연 일치로 통과한다 |

### 5.2 구조 변경 — 등급을 **쌍(pair) 단위**로

```rust
// verify/session/attribution.rs (신규)

/// 한 (세션, 커밋) 쌍의 판정. 등급은 여기서만 결정된다.
pub struct PairVerdict {
    pub commit_id: String,
    pub confidence: LinkConfidence,
    pub basis: Vec<&'static str>,
    /// |세션편집 ∩ 커밋변경| / |커밋변경|
    pub commit_coverage: f32,
    /// |세션편집 ∩ 커밋변경| / |세션편집|
    pub session_coverage: f32,
    pub rejection: Option<RejectionReason>,
}

pub fn grade_pair(ctx: &AttributionContext, session: &SessionSummary, commit: &CommitFacts) -> PairVerdict;

/// 모든 쌍을 채점한 뒤 병렬 세션을 중재한다 (§5.5).
pub fn arbitrate(verdicts: &mut BTreeMap<String, Vec<(SessionId, PairVerdict)>>);
```

`SessionCommitLink`는 **필드를 추가**하되 기존 필드는 유지한다(다른 호출자 보호):

```rust
pub struct SessionCommitLink {
    pub session_id: String,
    pub session_path: String,
    /// `Low`로 떨어진 커밋은 **여기서 제거된다** (결함 8 수정).
    pub commit_ids: Vec<String>,
    /// 이제 커밋별 **최고** 등급이다 (weakest → best).
    pub confidence: LinkConfidence,
    pub basis: Vec<String>,
    /// NEW — 커밋별 판정.
    pub commits: Vec<CommitLinkDetail>,
    /// NEW — 탈락한 후보와 이유.
    pub rejected: Vec<RejectedCommit>,
}
```

### 5.3 추가로 쓰는 신호

| 신호 | 출처 | 사용 |
|---|---|---|
| **브랜치 실제 비교** | 커밋 측: `repo.head()`의 브랜치명 + 커밋이 HEAD에서 도달 가능한가(`graph_descendant_of`). 세션 측: `SessionSummary.git_branch` | 양쪽이 **모두** 브랜치를 기록했고 **다르면** → `RejectionReason::BranchMismatch`, **하드 거부**. 같으면 basis에 `"branch"`. 한쪽이 없으면 중립(High 불가, Medium 가능) |
| **워크트리 해석** | `session.cwd`에서 위로 걸어 올라가 `.git`(파일 또는 디렉터리)을 찾고, 그 `commondir`을 해석 (`verify/paths.rs::shared_state_dir`와 동일 로직) | 같은 워크트리 → `CwdRelation::ThisWorktree`. 같은 common dir·다른 워크트리 → `SiblingWorktree` (**Medium 상한**). 그 외 → `Unrelated` → **하드 거부** |
| **세션 파일 mtime** | `SessionRef.modified_at` → `SessionSummary.modified_at`으로 승격 (신규 필드) | 커밋 시각 > `modified_at + TAIL_GRACE_MILLIS` → High 불가. 커밋 시각 < `started_at` → 하드 거부 |
| **양방향 커버리지** | `commit_coverage`, `session_coverage` | High 요건: `commit_coverage == 1.0` **AND** `session_coverage ≥ MIN_SESSION_COVERAGE(0.10)` (결함 6) |
| **작성자** | `commit.author().email()` vs 저장소 `user.email` + 등록 계정 이메일 목록 | 전부와 다르면 → `RejectionReason::DifferentAuthor`, High 불가 (하드 거부는 아님 — 커밋 훅이 이메일을 바꾸는 경우가 있다) |
| **머지 커밋** | `commit.parent_count() > 1` | **무조건 배제.** `RejectionReason::MergeCommit` |
| **reflog** | `repo.reflog("HEAD")` — 각 엔트리의 `id_new()`와 `committer().when()` | 커밋 oid가 HEAD reflog에 **처음 나타난 시각**이 세션 구간 밖이면 (= 리베이스/체리픽으로 유입) High 불가. reflog가 없으면 중립 — 증거의 부재는 반증이 아니다 |

`basis` 토큰 집합 (확정): `"cwd"` `"branch"` `"timeWindow"` `"fileOverlap"` `"mtime"` `"author"` `"reflog"` `"siblingWorktree"`.
프론트는 이 목록에 없는 토큰을 **표시하지 않는다** (`session-signals.ts::knownBasis` 패턴 승계).

### 5.4 등급 규칙 (개정)

```
하드 거부 (링크 자체를 만들지 않는다):
  - CwdRelation::Unrelated
  - 머지 커밋
  - commit_coverage == 0.0            ← 시간 근접만으로는 절대 귀속하지 않는다
  - 양쪽 브랜치가 기록됐고 다름
  - 커밋 시각 < session.started_at
  - session.truncated  AND  commit_coverage < 1.0   ← 부분 관측으로 부분 주장 금지

High  : CwdRelation::ThisWorktree
        AND 브랜치 일치(양쪽 기록)
        AND 커밋 시각 ∈ [started_at, min(ended_at, modified_at) + TAIL_GRACE]
        AND commit_coverage == 1.0
        AND session_coverage ≥ 0.10
        AND 작성자 일치
        AND (reflog 없음 OR reflog 최초 등장이 세션 구간 안)
        AND 이 커밋을 High로 주장하는 세션이 유일 (§5.5)

Medium: CwdRelation ∈ {ThisWorktree, SiblingWorktree}
        AND commit_coverage > 0.0
        AND (브랜치 일치 OR 시간 구간 안)

Low   : 그 외 — **링크에서 제거된다.** 리포트에 나타나지 않는다.
```

### 5.5 병렬 세션 중재

모든 쌍을 채점한 뒤 **커밋별로 묶어서** 처리한다:

1. 한 커밋을 `High`로 주장하는 세션이 **2개 이상**이면:
   - 한 세션의 편집 집합이 다른 세션의 진부분집합(strict superset 관계)이면 **상위 집합 쪽이 High를 유지**하고 나머지는 Medium으로 내려간다.
   - 그렇지 않으면 **아무도 High를 받지 못한다.** 전부 Medium으로 내리고 각 링크에 `ambiguous_with = n`을 기록한다.
2. 한 커밋을 `Medium` 이상으로 주장하는 세션이 3개 이상이면 전부 `RejectionReason::AmbiguousWithAnotherSession`으로 탈락시킨다. 세 갈래 모호성은 정보가 아니라 소음이다.
3. 시간 구간이 **전혀 겹치지 않는** 두 세션은 "병렬"이 아니다. 각자 자기 구간 안의 커밋만 주장하므로 1·2가 적용되지 않는다.

### 5.6 신뢰도별 UI 의무

| 등급 | UI가 해야 하는 것 |
|---|---|
| **High** | 단정한다. "이 세션이 커밋 N개를 만들었다." § 무엇을 했나가 커밋을 사실로 렌더한다. §4·§5는 `AttributedCommitRange` 기준. |
| **Medium** | **`추정` 칩을 반드시 붙인다.** basis 토큰을 풀어서 보여준다("같은 폴더 · 같은 시간대 · 파일 3개 겹침"). 헤더 카운트는 "추정 N개". §4·§5는 confidence 한 단계 강등. `SiblingWorktree`면 어느 워크트리인지 **명시한다**. |
| **Low** | **렌더하지 않는다.** 애초에 백엔드가 보내지 않는다. `DidSection.attribution = None`, `commits = []`, `unavailable{NoCommitAttribution}`. |

**핵심**: § 무엇을 했나는 **절대 통째로 비지 않는다.** 파일 편집은 세션 로그에서 오는 사실이고, 상관관계에 의존하는 것은 커밋 절반뿐이다.

### 5.7 필수 테스트 (P-corr)

- 브랜치가 다른 세션·커밋 → 링크 없음 (결함 1 회귀 테스트)
- 머지 커밋 → 절대 귀속 안 됨
- 파일 겹침 0 + 완벽한 시간 일치 → 링크 없음
- 200파일 세션 + 1파일 커밋 → Medium 상한 (결함 6)
- 좋은 커밋 1 + 나쁜 커밋 1 → 좋은 것만 남고 High 유지, 나쁜 것은 `rejected`에 (결함 8)
- 같은 브랜치·겹치는 시간·같은 파일의 두 세션 → 둘 다 Medium + `ambiguous_with = 2` (결함 7)
- 형제 워크트리 세션 → Medium 상한, `CwdRelation::SiblingWorktree`
- `truncated` 세션 + 부분 커버리지 → 링크 없음
- reflog에 체리픽으로 유입된 커밋 → High 불가

---

## 6. STEP 5 — 철거 목록 (DEMOLITION)

> 전부 `feat/ai-verification` 3커밋에 들어 있다. **자신 있게 지운다.**
> **Rust 백엔드는 한 파일도 지우지 않는다.** 룰 엔진은 증거 공급원이다.

### 6.1 삭제 — 디렉터리 통째로

```
src/components/verify/            (23개 파일 전부 — 컴포넌트 9 + 유틸 7 + __tests__ 7)
src/components/review/            (6개 파일 전부)
src/components/evidence/          (8개 파일 전부)
src/components/session/           (9개 파일 전부)
```

**왜 `verify/severity.ts`·`session-signals.ts` 같은 "쓸 만한 유틸"도 지우는가**: 리포트가 필요로 하는 것은 백엔드가 이미 계산해서 보낸다(`duration_ms`, `partial`, `title`). 남기면 소유권이 두 에이전트에 걸쳐 충돌한다. 필요하면 report-ui가 `src/components/report/` 아래 새로 만든다.

### 6.2 삭제 — 개별 파일

```
src/components/history/RiskDigest.tsx
src/components/history/risk-digest-model.ts
src/components/history/__tests__/risk-digest-model.test.ts
src/components/history/SessionGroupList.tsx
src/components/history/SessionGroupHeader.tsx
src/components/history/session-groups.ts
src/components/history/__tests__/session-groups.test.ts
src/components/history/HistoryViewModeToggle.tsx
src/components/settings/VerifyAdvancedSettings.tsx
src/components/settings/HookInstallDialog.tsx      (VerifyAdvancedSettings에서만 마운트됨 — 고아가 된다)
src/hooks/useFileVerification.ts
src/hooks/useRiskDigest.ts
src/hooks/useSessionCommitBadges.ts
src/hooks/useSessionGroups.ts
src/stores/commit-draft.ts
```

**세션 그룹 History가 사라지는 것에 대한 보상**: report-ui가 `src/components/report/SessionEntryList.tsx`로 **같은 기능을 다시 만든다** — 세션 헤더 아래 커밋을 묶는 목록. 데이터 소스만 `useSessionGroups`(7회 왕복) → `list_session_digests`(1회)로 바뀐다. 기능은 잃지 않는다.

### 6.3 존치 — 명시적 판단

| 파일 | 판정 | 근거 |
|---|---|---|
| `src/components/diff/StructuralCollapse.tsx` | **KEEP** | 이것은 룰 목록이 아니라 **diff 읽기 보조**다. 2,800줄 재포맷을 접어서 안 읽어도 되게 만든다 — 정확히 "이해시키기"다. `noise === null`이면 아무것도 렌더하지 않으므로 DECISION A 정신에도 이미 부합한다. |
| `src/components/ui/Disclosure.tsx` | **KEEP** | 범용 프리미티브. 리포트가 재사용한다. |
| `src/hooks/useSymbolIndex.ts` | **KEEP** | § 무엇이 영향받나의 "지금 인덱스 만들기" 버튼이 쓴다. |
| `src/stores/selection.ts`의 `selectedSessionPath` | **KEEP** | 리포트 페이지의 선택 상태. |
| `src-tauri/**` 전부 | **KEEP** | 백엔드는 증거 공급원이다. 지우지 않는다. |

### 6.4 수정 — 기존 프론트 파일 (전부 **demolition 에이전트 소유**)

| 파일 | 제거할 것 | 남는 것 |
|---|---|---|
| `src/components/commit/ChangesView.tsx` | `ReviewProgress`·`TestEvidenceBadge`·`WorkingTreeVerification` 마운트, `useFileReviewStates`, `stagedPaths`/`stagedReviewStates`, `useCommitDraftStore` | 커밋 요약/설명을 **로컬 `useState`로 복원** (HEAD~3 형태) |
| `src/components/layout/ContentArea.tsx` | `FileReviewToggle`·`FindingBadge` 헤더 스트립, `useFileVerification`, `useFileReviewStates`, `ActiveTab`/`historyViewMode` 분기 | `DiffViewer`의 `structural` prop **유지**. `SessionDetail` 분기를 `SessionReportView`(신규, `@/components/report`)로 교체하되 `useSessionData().hasSessions` 게이트를 통과할 때만 |
| `src/components/history/CommitDetail.tsx` | 검토 토글 버튼, `CommitVerification`, `useCommitReviewStates`/`useCommitReviewMutations` | `structural` prop **유지** |
| `src/components/history/HistoryView.tsx` | `RiskDigest`, `HistoryViewModeToggle`, `SessionGroupList`, `SessionCommitBadge`, `useSessionGroups`, `renderCommitTrailing`의 세션 배지 부분 | `SessionEntryList`(신규) 마운트 — `useSessionData().hasSessions`가 true일 때만. `isUnpushed` 배지는 유지 |
| `src/components/toolbar/SyncDropdown.tsx` | `PushGateBanner`, `repoPath`/`remote`/`branch`/`onReviewFirst` props | HEAD~3 형태로 되돌림 |
| `src/components/toolbar/SyncZone.tsx` | `pushRemote`, `setActiveTab`, 위 4개 prop 전달 | — |
| `src/components/settings/SettingsPanel.tsx` | `verification` 섹션, `RuleSettings`, `VerifyAdvancedSettings`, `ScanSearch` 아이콘, `Section` 유니온의 `"verification"` | — |
| `src/hooks/useRepoWatcher.ts` | `verifyWorkingTree`·`fileReviewStates`·`testEvidence` 무효화 | `sessionDigests`·`sessionReport` 무효화 **추가** |
| `src/stores/ui.ts` | `historyViewMode`·`setHistoryViewMode`·`HistoryViewMode` 타입·`isHistoryViewMode`·partialize의 해당 항목 | **`resolveActiveTab` 마이그레이션은 유지한다** — 배포된 빌드가 `"sessions"`를 저장했을 수 있다 |
| `src/api/verify.ts` | 삭제된 화면 전용 래퍼 | `getSessionReport`·`listSessionDigests` **추가** (§3.1 시그니처 그대로). 파일명은 **바꾸지 않는다** (`commands.ts`의 `export * from "./verify"` 유지) |
| `src/api/queries.ts` | 삭제된 화면 전용 훅 | `useSessionReport`·`useSessionDigests` **추가** |
| `src/types/index.ts` | 삭제된 화면 전용 타입 | §3의 `SessionReport` 계열 타입 **추가** (Rust 정의 미러링) |
| `src/i18n/locales/{en,ko}/translation.json` | 죽은 `verify.*` 키 | `report.*` 블록 **추가** (§4.7 문구 포함) |

> **삭제로 인해 호출자가 없어지는 Tauri 커맨드** (Rust는 그대로 두되, 후속 정리를 위해 기록):
> `verify_working_tree` `verify_commit` `verify_commit_range` `get_verify_rules` `set_verify_rule_enabled` `check_dependencies`
> `get_file_review_states` `mark_file_reviewed` `unmark_file_reviewed` `get_commit_review_states` `mark_commit_reviewed` `unmark_commit_reviewed` `get_review_queue` `get_push_gate_summary` `get_ledger_enabled` `set_ledger_enabled` `read_evidence_ledger` `record_evidence_ledger`
> `get_test_evidence` `run_test_command` `get_diff_coverage`
> `get_hook_status` `preview_hook_install` `install_verify_hooks` `uninstall_verify_hooks` `list_hook_sessions`
> `verify_syntax` `list_sessions_for_repo` `get_session_summary` `verify_session` `get_session_cumulative_diff`
> (`get_structural_diff`·`get_blast_radius`·`build_symbol_index`·`cancel_symbol_index`·`get_symbol_index_status`·`correlate_sessions_to_commits`는 **계속 호출된다**)

### 6.5 DECISION A 게이트 — 정확히 한 곳

```ts
// src/hooks/useSessionData.ts   ← 신규. report-ui 소유. 이 파일이 게이트다.
export interface SessionData {
  /** 이 저장소에 실제로 읽을 수 있는 세션이 있는가. 로딩 중과 에러 시에는 false. */
  hasSessions: boolean;
  isLoading: boolean;
  digests: SessionDigest[];
}

export function useSessionData(repoPath: string | null): SessionData;
```

- 뒤에 있는 쿼리는 **단 하나**: `["sessionDigests", repoPath]` → `list_session_digests`.
- `hasSessions = !isLoading && !isError && digests.length > 0`. **로딩 중에는 반드시 `false`** — 패널이 깜빡였다 사라지는 것도 유도(nag)다.
- **규칙**: 검증 관련 마운트 지점은 `hasSessions === true`가 아니면 `return null`. 스켈레톤 없음, 빈 상태 없음, 토스트 없음.
- **마운트 지점은 정확히 2개다**: `HistoryView`(세션 목록), `ContentArea`(리포트 페이지). 그 외 어디에도 검증 UI를 붙이지 않는다.
- 백엔드 대응물: `list_session_digests`는 세션 디렉터리가 없으면 **빈 Vec**을 반환한다 (에러 아님 — contract §7-⑥).

---

## 7. STEP 6 — 소유권 표 (병렬 4에이전트)

**신규 파일과 수정 파일은 절대 겹치지 않는다. demolition이 기존 프론트 파일의 *모든* 수정을 소유한다.**

| 에이전트 | 신규 파일 (독점) | 기존 파일 수정 (독점) |
|---|---|---|
| **A. report-backend** | `src-tauri/src/verify/report/mod.rs`<br>`src-tauri/src/verify/report/model.rs` (§3 타입 전부)<br>`src-tauri/src/verify/report/asked.rs`<br>`src-tauri/src/verify/report/did.rs`<br>`src-tauri/src/verify/report/ordeal.rs`<br>`src-tauri/src/verify/report/impact.rs`<br>`src-tauri/src/verify/report/drift.rs` (§4 V26 전부)<br>`src-tauri/src/commands/report.rs` | `src-tauri/src/verify/mod.rs` (`pub mod report;` + 재수출)<br>`src-tauri/src/verify/registry.rs` (v26 `planned`→`implemented` 1행)<br>`src-tauri/src/commands/mod.rs` (1행)<br>`src-tauri/src/lib.rs` (핸들러 2개 등록) |
| **B. correlation** | `src-tauri/src/verify/session/attribution.rs` (§5.2 채점·중재·워크트리 해석) | `src-tauri/src/verify/session/correlate.rs` (채점을 attribution에 위임)<br>`src-tauri/src/verify/session/mod.rs` (`modified_at` 승계, 캐시 버전)<br>`src-tauri/src/verify/session/summary.rs` (프롬프트 전체 fold)<br>`src-tauri/src/verify/session/event.rs` (프롬프트 정제)<br>`src-tauri/src/verify/session/claude_code.rs`·`codex.rs` (태그 블록 제거)<br>`src-tauri/src/verify/types.rs` (**§7.1의 4개 추가만**)<br>`src-tauri/src/commands/session.rs` (새 신호 공급) |
| **C. report-ui** | `src/components/report/SessionReportView.tsx`<br>`src/components/report/SessionEntryList.tsx`<br>`src/components/report/AskedSection.tsx`<br>`src/components/report/DidSection.tsx`<br>`src/components/report/WentThroughSection.tsx`<br>`src/components/report/ImpactSection.tsx`<br>`src/components/report/DriftSection.tsx`<br>`src/components/report/report-model.ts`<br>`src/components/report/index.ts`<br>`src/components/report/__tests__/**`<br>`src/hooks/useSessionData.ts`<br>`src/hooks/useSessionReport.ts` | **없음. 기존 파일을 하나도 건드리지 않는다.** |
| **D. demolition** | 없음 | §6.1·6.2의 **모든 삭제** + §6.4의 **모든 수정** (`types/index.ts`·`api/verify.ts`·`api/queries.ts`·양쪽 `translation.json` 포함) |

### 7.1 correlation이 `verify/types.rs`에 넣는 것 — 이 4개가 전부

```rust
// SessionSummary에 추가
    /// 세션 파일 mtime (epoch ms). 상관관계의 하드 게이트에 쓰인다.
    #[serde(default)]
    pub modified_at: i64,
    /// 사용자 프롬프트 전부 (V26의 명세 앵커). `first_user_prompt`는
    /// `prompts.first()`와 동치이며 캐시 호환을 위해 유지된다.
    #[serde(default)]
    pub prompts: Vec<PromptRecord>,

// BashCommandRecord에 추가
    /// 발견된 우회 토큰 원문 (`--no-verify` 등). §3.7의 증거.
    #[serde(default)]
    pub bypass_markers: Vec<String>,

// 신규 타입 (report/model.rs가 재수출해 쓴다)
pub struct PromptRecord { /* §3.5 정의 그대로 */ }
```

### 7.2 계약된 임포트 경계 — demolition과 report-ui가 서로를 기다리지 않게 하는 것

두 에이전트는 **지금 확정된 이 표면**을 신뢰하고 병렬로 작업한다.

| 심볼 | 경로 | 만드는 쪽 | 쓰는 쪽 |
|---|---|---|---|
| `SessionReportView`, `SessionEntryList` | `@/components/report` | report-ui | demolition (ContentArea·HistoryView) |
| `useSessionData` | `@/hooks/useSessionData` | report-ui | demolition (게이트) |
| `useSessionReport` | `@/hooks/useSessionReport` | report-ui | report-ui 내부 |
| `getSessionReport`, `listSessionDigests` | `@/api/commands` | demolition | report-ui |
| `SessionReport`, `SessionDigest`, 섹션 타입 전부 | `@/types` | demolition | report-ui |
| `report.*` i18n 키 | `translation.json` | demolition | report-ui |

### 7.3 실행 순서

```
B (correlation: types.rs 4개 필드 먼저 랜딩)
      ↓
A (report-backend) ─┐
                    ├── 병렬
C (report-ui) ──────┤
D (demolition) ─────┘
      ↓
통합: cargo test / pnpm test / pnpm typecheck / cargo clippy
```

- **B의 `types.rs` 커밋이 A의 시작 조건이다.** 그 4개 필드 없이는 `report/model.rs`가 컴파일되지 않는다.
- C와 D는 §7.2의 표를 계약으로 삼아 완전 병렬. 서로의 파일을 절대 열지 않는다.
- **캐시 무효화 필수**: `session/mod.rs::CacheEntry`에 `version: u32`를 추가하고 불일치 시 재파싱한다. 새 필드가 `#[serde(default)]`이므로, 이게 없으면 기존 캐시가 `prompts: []`로 되살아나 §1과 §5가 조용히 빈다.

---

## 8. 이 계획의 가장 약한 지점 5개 — 구현자가 알고 시작할 것

1. **V26의 앵커 추출은 한국어 프롬프트에서 훨씬 약하다.** `Backtick`/`Extension`/`PathLike`는 언어 중립이지만, 실제 사용자 프롬프트("로그인 리팩터링 해줘")는 경로를 백틱으로 감싸지 않는다. → **§ 다섯 번째 섹션은 상당수 세션에서 `NoResolvableAnchor`로 비어 있을 것이다.** 그게 정답이다(G1). 하지만 "가장 가치 있는 섹션이 자주 안 보인다"는 사실을 제품 기대치에 반영해야 한다.

2. **상관관계 강화가 `High`를 희소하게 만든다.** 브랜치 실제 비교 + 양방향 커버리지 + 병렬 중재를 다 걸면 High가 크게 줄고, 대부분 Medium(=추정 칩)이 된다. 페이지가 "추정" 투성이가 되면 신뢰가 아니라 피로를 준다. → Medium UI를 **칩 하나로 조용하게** 만들어야지, 매 줄에 경고를 달면 안 된다.

3. **`SessionSummary`에 필드를 추가하면 기존 요약 캐시가 전부 무효가 된다.** 첫 실행에서 수백 MB JSONL을 재파싱한다. `MAX_PARSE_MILLIS`(5초)와 `MAX_REPORT_MILLIS`(3초) 예산 안에서 목록이 비어 보일 수 있고, DECISION A 게이트가 그 순간 `hasSessions = false`를 반환해 **UI가 통째로 사라졌다 나타난다.** → 첫 로드에 한해 게이트를 "이전 결과 유지"로 처리하거나, 캐시 마이그레이션을 백그라운드로 돌려야 한다.

4. **§4(blast radius)는 심볼 인덱스가 있는 저장소에서만 산다.** 인덱스는 최대 120초 걸리고 사용자가 명시적으로 눌러야 만들어진다. → 다섯 섹션 중 두 개(§4, §5)가 흔히 비어 있는 페이지가 된다. 세 섹션짜리 페이지가 "정보 나열"이라는 원래 불만을 다시 부르지 않는지 **첫 프로토타입에서 반드시 확인할 것.**

5. **Codex 세션은 절반이 안 된다.** `CLAUDE_ONLY_KINDS`(read/sidechain/compaction)가 통째로 빠지고, Codex 로그는 700MB~2GB라 `truncated`가 흔하다. `truncated`면 §5의 `FullDrift`가 금지되고(G7) 상관관계 하드 거부 규칙에 걸린다(§5.4). → **Codex 사용자는 사실상 §1·§2·§3만 보게 된다.** 이것을 `UnsupportedAgent` 사유로 정직하게 말하되, Codex를 일급 지원한다고 광고하지 말 것.

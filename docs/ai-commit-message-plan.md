# 커밋 메시지 자동 생성 (Claude Code CLI 연동)

## Context

AI 시대에 개발자의 역할이 코드 작성에서 코드 리뷰로 전환되고 있다. GitBaro에 AI 기능을 추가하는 첫 단계로, 이미 사용자 PC에 설치된 Claude Code CLI를 활용하여 staged diff를 분석하고 conventional commit 메시지를 자동 생성하는 기능을 구현한다. 별도의 API 키 설정 없이, `gh` CLI 통합과 동일한 패턴으로 `claude` CLI를 subprocess로 호출한다.

---

## 수정할 파일 목록

| 파일 | 작업 |
|------|------|
| `src-tauri/src/error.rs` | AppError에 Claude 관련 variant 추가 |
| `src-tauri/src/claude/mod.rs` | 신규 — 모듈 선언 |
| `src-tauri/src/claude/cli.rs` | 신규 — Claude CLI 바이너리 탐지 + `call_claude_print()` |
| `src-tauri/src/git/diff.rs` | `diff_to_string()`에서 `#[allow(dead_code)]` 제거 (재사용) |
| `src-tauri/src/commands/ai.rs` | 신규 — generate_commit_message, check_claude_status 커맨드 |
| `src-tauri/src/commands/mod.rs` | `pub mod ai` 추가 |
| `src-tauri/src/lib.rs` | `pub mod claude` + invoke_handler에 커맨드 등록 + startup 로그 |
| `src/types/index.ts` | AppError union에 Claude variant 추가 + GeneratedCommitMessage 타입 |
| `src/api/commands.ts` | generateCommitMessage, checkClaudeStatus 래퍼 추가 |
| `src/hooks/useCommitMessageGenerator.ts` | 신규 — AI 커밋 메시지 생성 커스텀 훅 |
| `src/i18n/locales/ko/translation.json` | ai 섹션 번역 추가 |
| `src/i18n/locales/en/translation.json` | ai 섹션 번역 추가 |
| `src/components/layout/Sidebar.tsx` | 커밋 패널에 AI 생성 버튼 추가 (훅 사용) |
| `docs/ai-features-roadmap.md` | 신규 — AI 기능 로드맵 문서 |

---

## 구현 단계

### Step 1: AppError 확장

**파일**: `src-tauri/src/error.rs`

`AppError` enum에 2개 variant 추가 (L54, `RepoNotFound` 아래):
```rust
#[error("Claude Code CLI not found")]
ClaudeCliNotFound,

#[error("Claude CLI error: {0}")]
ClaudeCli(String),
```

`Serialize` impl의 match에도 추가 (L92, `RepoNotFound` 아래):
```rust
AppError::ClaudeCliNotFound => ("ClaudeCliNotFound", self.to_string()),
AppError::ClaudeCli(msg) => ("ClaudeCli", msg.clone()),
```

### Step 2: Claude CLI 모듈

**파일**: `src-tauri/src/claude/mod.rs` (신규)
```rust
pub mod cli;
```

**파일**: `src-tauri/src/claude/cli.rs` (신규)

`gh/cli.rs`의 `find_gh_binary()` 패턴을 따르되, `$HOME` 경로는 런타임 조합:

```rust
/// 절대 경로 상수 (컴파일타임)
const CLAUDE_FIXED_PATHS: &[&str] = &[
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
];

/// $HOME 기반 경로 (런타임 조합)
fn claude_home_paths() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME") else { return vec![] };
    let home = PathBuf::from(home);
    vec![
        home.join(".npm/bin/claude"),
        home.join(".claude/local/claude"),
    ]
}

/// Claude Code CLI 바이너리 탐색
pub fn find_claude_binary() -> Result<PathBuf, AppError> {
    // 1. which claude (PATH 검색)
    // 2. CLAUDE_FIXED_PATHS 순회
    // 3. claude_home_paths() 순회
    // 실패 시 AppError::ClaudeCliNotFound
}

/// Claude CLI 비대화형 호출 (claude -p)
pub async fn call_claude_print(prompt: &str, timeout_secs: u64) -> Result<String, AppError> {
    // find_claude_binary()로 바이너리 탐색
    // tokio::process::Command::new(&claude).args(["-p", "--output-format", "text"])
    // stdin에 prompt 전달
    // tokio::time::timeout으로 타임아웃 적용
    // stdout에서 결과 반환
}
```

CLI 호출 책임을 이 모듈에 격리하여 `commands/ai.rs`는 프롬프트 조립과 응답 파싱에만 집중.

### Step 3: git/diff.rs 재사용

**파일**: `src-tauri/src/git/diff.rs` (L105)

기존 `diff_to_string()` 함수에서 `#[allow(dead_code)]`만 제거:
```rust
// 변경 전
#[allow(dead_code)]
pub fn diff_to_string(diff: &git2::Diff<'_>) -> Result<String, AppError> {

// 변경 후
pub fn diff_to_string(diff: &git2::Diff<'_>) -> Result<String, AppError> {
```

`commands/ai.rs`에서 이 함수를 재사용하여 diff 수집 코드 중복을 방지한다.

### Step 4: AI 커맨드 모듈

**파일**: `src-tauri/src/commands/ai.rs` (신규)

SRP를 지키기 위해 4개 헬퍼 함수로 분리:

```rust
/// staged diff를 unified diff 문자열로 수집 (git/diff.rs의 diff_to_string 재사용)
fn collect_staged_diff(repo_path: &str) -> Result<String, AppError> {
    let repo = git2::Repository::open(repo_path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, None)?;
    crate::git::diff::diff_to_string(&diff)  // 기존 함수 재사용
}

/// 프로젝트 루트에서 커밋 컨벤션 설정 파일 탐색 (4KB 상한)
fn detect_commit_convention(repo_path: &str) -> Option<String> {
    // .commitlintrc, .commitlintrc.json, commitlint.config.js 등 탐색
    // package.json의 "commitlint" 필드 탐색
    // 발견 시 내용 반환 (MAX 4KB)
}

/// diff + 컨벤션 설정으로 프롬프트 조립
fn build_prompt(diff: &str, convention: Option<&str>) -> String { ... }

/// Claude 응답을 summary + description으로 파싱
fn parse_commit_response(output: &str) -> GeneratedCommitMessage { ... }
```

#### diff truncation — UTF-8 안전:
```rust
const MAX_DIFF_BYTES: usize = 100_000;

fn truncate_diff(diff: String) -> String {
    if diff.len() <= MAX_DIFF_BYTES { return diff; }
    // char_indices()로 안전한 바이트 경계 찾기
    match diff.char_indices().find(|(i, _)| *i >= MAX_DIFF_BYTES) {
        Some((i, _)) => format!("{}\n\n[diff truncated]", &diff[..i]),
        None => diff,
    }
}
```

#### 커맨드:

```rust
#[tauri::command]
pub async fn generate_commit_message(repo_path: String) -> Result<GeneratedCommitMessage, AppError> {
    let rp = repo_path.clone();
    let diff = tokio::task::spawn_blocking(move || collect_staged_diff(&rp))
        .await.map_err(|e| AppError::Channel(e.to_string()))??;

    if diff.trim().is_empty() {
        return Err(AppError::ClaudeCli("No staged changes".into()));
    }

    let diff = truncate_diff(diff);
    let convention = detect_commit_convention(&repo_path);
    let prompt = build_prompt(&diff, convention.as_deref());

    let output = crate::claude::cli::call_claude_print(&prompt, 60).await?;
    Ok(parse_commit_response(&output))
}

#[tauri::command]
pub async fn check_claude_status() -> Result<serde_json::Value, AppError> {
    // check_gh_status 패턴과 동일: Value 반환
    match crate::claude::cli::find_claude_binary() {
        Ok(_) => Ok(json!({ "available": true })),
        Err(_) => Ok(json!({ "available": false })),
    }
}
```

#### 프롬프트 설계:
```
Based on the following git diff of staged changes, generate a commit message.

Rules:
- First line: type(scope): brief description (max 72 chars)
- Types: feat, fix, refactor, docs, test, chore, perf, ci, style
- Leave a blank line after the first line
- Then provide a concise body (1-3 sentences) explaining WHAT and WHY
- Match the language of code comments/variable names in the diff
- Output ONLY the commit message, no markdown blocks

{커밋 설정이 발견된 경우}
IMPORTANT: This project has commit conventions configured.
Follow the rules defined in the config below strictly:
---
{설정 파일 내용, 최대 4KB}
---

Diff:
{diff 내용}
```

### Step 5: 모듈 및 커맨드 등록

**파일**: `src-tauri/src/commands/mod.rs`
- `pub mod ai;` 추가

**파일**: `src-tauri/src/lib.rs`
- L8: `pub mod claude;` 추가
- L21 invoke_handler에 추가:
  ```rust
  commands::ai::generate_commit_message,
  commands::ai::check_claude_status,
  ```
- L69 startup block에 Claude CLI 감지 로그 추가 (기존 gh CLI 패턴과 일관):
  ```rust
  match claude::cli::find_claude_binary() {
      Ok(p) => tracing::info!("Claude Code CLI detected: {:?}", p),
      Err(_) => tracing::debug!("Claude Code CLI not found (AI features disabled)"),
  }
  ```

### Step 6: 프론트엔드 타입 추가

**파일**: `src/types/index.ts`

(a) AppError union에 Claude variant 추가 (L18, `"RepoNotFound"` 아래):
```typescript
    | "ClaudeCliNotFound"
    | "ClaudeCli";
```

(b) 새 인터페이스 추가 (파일 하단):
```typescript
export interface GeneratedCommitMessage {
  summary: string;
  description: string;
}

export interface ClaudeStatus {
  available: boolean;
}
```

### Step 7: API 래퍼 추가

**파일**: `src/api/commands.ts`
- import에 `GeneratedCommitMessage`, `ClaudeStatus` 추가
- 함수 2개 추가:
  ```typescript
  export async function generateCommitMessage(repoPath: string): Promise<GeneratedCommitMessage> {
    return invoke("generate_commit_message", { repoPath });
  }

  export async function checkClaudeStatus(): Promise<ClaudeStatus> {
    return invoke("check_claude_status");
  }
  ```

### Step 8: i18n 번역 추가

두 파일 모두 `"ai"` 섹션 추가:

| 키 | 한국어 | 영어 |
|---|--------|------|
| `ai.generateTooltip` | AI로 커밋 메시지 생성 | Generate commit message with AI |
| `ai.generateFailed` | 메시지 생성 실패: {{error}} | Failed to generate message: {{error}} |
| `ai.claudeNotInstalled` | Claude Code CLI가 설치되지 않았습니다 | Claude Code CLI is not installed |
| `ai.timeout` | AI 메시지 생성 시간이 초과되었습니다 | AI message generation timed out |
| `ai.noStagedFiles` | 먼저 파일을 Stage하세요 | Stage files first |

### Step 9: 커스텀 훅 추출

**파일**: `src/hooks/useCommitMessageGenerator.ts` (신규)

Sidebar.tsx 비대화를 방지하기 위해 AI 로직을 별도 훅으로 추출:

```typescript
export function useCommitMessageGenerator(repoPath: string | null, stagedCount: number) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;  // cleanup으로 경쟁 조건 방지
    checkClaudeStatus()
      .then((s) => { if (!cancelled) setClaudeAvailable(s.available); })
      .catch(() => { if (!cancelled) setClaudeAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  const generate = useCallback(async (): Promise<GeneratedCommitMessage | null> => {
    if (!repoPath || stagedCount === 0 || isGenerating) return null;
    setIsGenerating(true);
    try {
      return await generateCommitMessage(repoPath);
    } catch (err) {
      addToast(t("ai.generateFailed", { error: getErrorMessage(err) }), "error");
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [repoPath, stagedCount, isGenerating, addToast, t]);

  return { isGenerating, claudeAvailable, generate };
}
```

### Step 10: Sidebar.tsx UI 수정

**파일**: `src/components/layout/Sidebar.tsx`

ChangesView 컴포넌트 수정:

1. **import 추가**:
   ```typescript
   import { Sparkles } from "lucide-react";  // Loader2는 이미 L19에 존재
   import { useCommitMessageGenerator } from "@/hooks/useCommitMessageGenerator";
   ```

2. **훅 사용** (L706 아래, 기존 state 대신):
   ```typescript
   const { isGenerating, claudeAvailable, generate } = useCommitMessageGenerator(
     activeRepoPath, stagedFiles.length
   );
   ```

3. **생성 핸들러** (handleCommit 위에):
   ```typescript
   const handleGenerateMessage = async () => {
     const result = await generate();
     if (result) {
       setCommitSummary(result.summary);
       setCommitDescription(result.description);
     }
   };
   ```

4. **커밋 패널 UI** (L867-878, 기존 `<input>` 교체):
   ```tsx
   <div className="relative">
     <input
       type="text"
       placeholder={t("commit.summary")}
       value={commitSummary}
       onChange={(e) => setCommitSummary(e.target.value)}
       className={cn(
         "w-full px-3 py-2 pr-9 text-sm rounded-md border border-border",
         "bg-card outline-none",
         "focus:border-primary transition-colors",
       )}
     />
     {claudeAvailable && (
       <button
         onClick={handleGenerateMessage}
         disabled={stagedFiles.length === 0 || isGenerating}
         title={stagedFiles.length === 0 ? t("ai.noStagedFiles") : t("ai.generateTooltip")}
         className={cn(
           "absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded",
           "text-muted-foreground hover:text-primary hover:bg-primary/10",
           "transition-colors",
           (stagedFiles.length === 0 || isGenerating) && "opacity-40 cursor-not-allowed",
         )}
       >
         {isGenerating ? (
           <Loader2 className="w-4 h-4 animate-spin" />
         ) : (
           <Sparkles className="w-4 h-4" />
         )}
       </button>
     )}
   </div>
   ```

---

## 설계 결정 사항

| 결정 | 이유 |
|------|------|
| `claude -p`로 비대화형 호출 | stdin→stdout 파이프라인에 적합, gh CLI와 동일 패턴 |
| diff를 인자가 아닌 프롬프트에 포함 | macOS `ARG_MAX` 제한(~262KB) 회피 |
| 100KB에서 diff truncation (`char_indices`) | UTF-8 멀티바이트 경계 패닉 방지 |
| 60초 타임아웃 | API 호출 + 추론 시간 감안, UX와 안정성 균형 |
| Claude CLI 미설치 시 버튼 숨김 | 에러 메시지보다 깔끔한 UX (progressive enhancement) |
| `check_claude_status` → `Value` 반환 | 기존 `check_gh_status` 패턴과 일관 (확장 용이) |
| `git/diff.rs::diff_to_string()` 재사용 | diff 수집 코드 중복 방지 (기존 dead code 활용) |
| AI 로직을 `useCommitMessageGenerator` 훅으로 추출 | Sidebar.tsx 비대화 방지 (이미 1208줄) |
| CLI 호출을 `claude/cli.rs`에 격리 | SRP: commands/ai.rs는 프롬프트 조립+응답 파싱에 집중 |
| 컨벤션 파일 읽기 4KB 상한 | diff truncation 의도와 충돌 방지 |
| useEffect cleanup (`cancelled` 플래그) | 언마운트 후 setState 경쟁 조건 방지 |

---

## 검증 방법

1. **빌드 확인**: `cd src-tauri && cargo check` — Rust 컴파일 에러 없음
2. **프론트 타입체크**: `npx tsc --noEmit` — TypeScript 에러 없음
3. **수동 테스트**:
   - 파일 수정 → stage → Sparkles 버튼 클릭 → 커밋 메시지 자동 채워지는지 확인
   - Claude CLI 미설치 환경에서 버튼이 숨겨지는지 확인
   - staged 파일 없을 때 버튼 disabled 상태 확인
   - 큰 diff (100KB+)에서 truncation 후 정상 동작 확인
   - 타임아웃 시 에러 토스트 표시 확인
   - commitlint 설정 파일이 있는 프로젝트에서 컨벤션 반영 확인

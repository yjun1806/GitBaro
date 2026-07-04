# GitBaro

A macOS Git GUI application with per-repository GitHub account management.

- **Frontend**: React 19 + TypeScript + Tauri 2 + TailwindCSS 4
- **Backend**: Rust (edition 2021) + Tauri 2 + git2 (libgit2)
- **State**: Zustand 5 (frontend), Tauri managed state (backend)
- **Bundler**: Vite 6
- **Platform**: macOS (minimum 10.15)

## Project Structure

```
GitBaro/
├── src/                           # React frontend
│   ├── components/                # UI components (by domain)
│   │   ├── account/               # GitHub account management
│   │   ├── branch/                # Branch list, create, switch, delete, compare
│   │   ├── commit/                # Commit panel & message input
│   │   ├── conflict/              # Merge conflict banner
│   │   ├── diff/                  # Diff viewer, image diff (swipe/onion/two-up)
│   │   ├── history/               # Commit timeline, detail, branch compare
│   │   ├── layout/                # MainLayout, Sidebar, ContentArea, StatusBar
│   │   ├── pr/                    # Pull request status badge
│   │   ├── repository/            # Repo list, cards, clone dialog
│   │   ├── settings/              # Settings panel, theme selector
│   │   ├── toolbar/               # Toolbar (branch zone, account zone, sync zone)
│   │   ├── ui/                    # Reusable primitives (Select, ContextMenu, Combobox)
│   │   ├── welcome/               # First-launch welcome screen
│   │   └── worktree/              # Worktree create dialog & preview banner
│   ├── stores/                    # Zustand stores
│   │   ├── account.ts             # GitHub accounts
│   │   ├── repository.ts          # Repository list & active repo
│   │   ├── branch.ts              # Branch state
│   │   ├── ui.ts                  # Theme, sidebar width, view mode
│   │   └── toast.ts               # Toast notifications
│   ├── api/
│   │   ├── commands.ts            # Tauri invoke() wrappers
│   │   └── queries.ts             # React Query (TanStack) integration
│   ├── types/index.ts             # Shared TypeScript type definitions
│   ├── lib/                       # Utilities (theme, file-status, fuzzy-search, etc.)
│   ├── i18n/                      # i18next config + translations (en, ko)
│   ├── App.tsx                    # Root component (ErrorBoundary → GhSetupGuard → AppContent)
│   └── main.tsx                   # React entry point
├── src-tauri/                     # Rust backend
│   ├── src/
│   │   ├── lib.rs                 # Tauri app setup, plugin registration, command handlers
│   │   ├── main.rs                # Binary entry point
│   │   ├── error.rs               # AppError enum (thiserror + Serialize for frontend)
│   │   ├── git/                   # Git operations (hybrid strategy)
│   │   │   ├── engine.rs          # GitEngine + GitRemoteEngine traits, shared types
│   │   │   ├── cli.rs             # GitCliEngine — CLI-based ops (hooks-aware)
│   │   │   ├── libgit.rs          # LibGitEngine — libgit2-based ops (read-only, fast)
│   │   │   ├── repository.rs      # Repository wrapper
│   │   │   ├── diff.rs            # Diff conversion utilities
│   │   │   ├── branch.rs          # Branch name validation
│   │   │   ├── commit.rs          # Commit message parsing/validation
│   │   │   ├── binary.rs          # Binary file detection & image preview
│   │   │   ├── merge.rs           # Merge operations
│   │   │   └── stash.rs           # Stash helpers
│   │   ├── commands/              # Tauri #[tauri::command] handlers
│   │   │   ├── git.rs             # status, stage, unstage, commit, diff, fetch, push, pull, stash
│   │   │   ├── branch.rs          # branches, create, switch, delete, compare, merge, rename
│   │   │   ├── history.rs         # commit history, detail, file diff, avatars
│   │   │   ├── auth.rs            # gh CLI auth, account CRUD, per-repo account assignment
│   │   │   ├── diff.rs            # File diff with binary/image preview
│   │   │   ├── repo.rs            # open, clone (URL-validated), add, close, search GitHub repos
│   │   │   ├── settings.rs        # app settings, theme, editor/terminal/AI-CLI detection & launch
│   │   │   ├── watch.rs           # start/stop FS watcher for the active repo (emits fs:change)
│   │   │   ├── actions.rs         # GitHub Actions workflow runs & jobs
│   │   │   └── worktree.rs        # worktree add/remove/preview
│   │   ├── github/                # GitHub REST API client (reqwest)
│   │   │   ├── client.rs          # HTTP client, auth headers, path-segment validation
│   │   │   ├── issue.rs           # Issues API (client ready; not yet wired to a command)
│   │   │   ├── pull_request.rs    # Pull Requests API (client ready; not yet wired to a command)
│   │   │   ├── actions.rs         # GitHub Actions API
│   │   │   └── notifications.rs   # Notifications API (client ready; not yet wired to a command)
│   │   ├── gh/                    # GitHub CLI (gh) integration
│   │   │   └── cli.rs             # gh binary discovery, version check (≥2.40), auth status
│   │   ├── state/                 # Application state
│   │   │   ├── app_state.rs       # Window bounds persistence, open repos, sidebar width
│   │   │   └── token_store.rs     # In-memory token cache (Zeroizing); source of truth is `gh` CLI
│   │   └── watcher/
│   │       └── fs_events.rs       # FS watcher (notify crate), wired via commands/watch.rs
│   ├── Cargo.toml
│   └── tauri.conf.json            # Tauri window config, plugins, bundle settings
├── package.json
├── tsconfig.json
├── commitlint.config.cjs          # Conventional Commits enforcement
└── .husky/                        # Git hooks (pre-commit, commit-msg via commitlint)
```

## Git Implementation Rules (CRITICAL)

Reference implementation: **GitHub Desktop** (https://github.com/desktop/desktop).

### Hybrid Strategy

| Operation type | Engine | Rationale |
|---|---|---|
| **Read-only** (status, diff, log, blame, branch list) | `git2` (libgit2) via `LibGitEngine` | Performance — no hooks needed |
| **Write + hooks** (commit, checkout, merge, stash) | `git` CLI via `GitCliEngine` | Must execute `.git/hooks/` scripts |
| **Remote** (fetch, push, pull, clone) | `git` CLI + `GIT_ASKPASS` | Secure credential injection |

### Absolute Rules

- **NEVER** use git2 for operations that require hooks (commit, checkout, merge) — libgit2 does not execute `.git/hooks/` scripts
- CLI execution goes through `GitCliEngine::run_local` / `run_local_checked`
- Authentication uses `AskpassScript` pattern — tokens never appear in process arguments
- Method names reflect domain intent (e.g., `switch_branch`, `stash_save`), not git CLI command names

### Key Traits

- `GitEngine` (`git/engine.rs`) — local git operations (status, diff, commit, branch, merge, blame, stash)
- `GitRemoteEngine` (`git/engine.rs`) — remote operations (clone, fetch, push, pull) — async

## Development Commands

```bash
# Frontend
npm run dev              # Vite dev server (port 1420)
npm run build            # tsc + vite build
npm run lint             # ESLint (src/**/*.{ts,tsx})
npm run typecheck        # tsc --noEmit
npm run test             # vitest run
npm run test:watch       # vitest watch mode

# Tauri (full app)
npm run tauri dev        # Dev mode with hot reload
npm run tauri build      # Production build (.app bundle)

# Rust only
cd src-tauri && cargo check          # Type check
cd src-tauri && cargo clippy         # Lint
cd src-tauri && cargo build          # Build
```

## Conventions

### Rust

- All Tauri commands are async functions annotated with `#[tauri::command]` in `src-tauri/src/commands/`
- Errors use `AppError` enum (in `error.rs`) which derives `thiserror::Error` and implements custom `Serialize` for frontend consumption (serialized as `{ type, message }`)
- All serializable types use `#[serde(rename_all = "camelCase")]` for JS interop
- Logging via `tracing` crate (debug level for gitbaro, warn for git2)
- CPU-intensive git ops use `tokio::task::spawn_blocking()`
- Each command opens its own `git2::Repository` (cheap) inside `spawn_blocking`; there is no long-lived per-repo worker
- Working-tree changes are pushed to the frontend via the FS watcher (`commands/watch.rs` + `watcher/fs_events.rs`) emitting `fs:change`; the status query keeps a slow poll as a fallback

### TypeScript / React

- Path alias: `@/*` maps to `./src/*`
- Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- State management: Zustand stores in `src/stores/`
- Data fetching: TanStack React Query via `src/api/queries.ts`
- Tauri IPC: `invoke()` wrappers in `src/api/commands.ts`
- Styling: TailwindCSS 4 utility classes
- i18n: i18next with English (`en`) and Korean (`ko`) translations in `src/i18n/locales/`
- Components organized by domain feature, not by component type

### Commit Messages

Conventional Commits enforced via commitlint + Husky:

```
type(scope): subject

# Examples:
feat(branch): add branch comparison view
fix(diff): handle binary file detection for SVG
refactor(git): extract stash helpers into module
```

### Error Handling Pattern

```
Rust AppError → Serialize as {type, message} → Tauri invoke → Frontend catches → Toast notification
```

Frontend uses `getErrorMessage()` utility from `src/lib/utils.ts` to extract user-friendly messages.

### Adding a New Tauri Command

1. Add the command function in the appropriate `src-tauri/src/commands/*.rs` file
2. Register it in `lib.rs` → `invoke_handler(tauri::generate_handler![...])`
3. Add the TypeScript wrapper in `src/api/commands.ts` using `invoke()`
4. Add types to `src/types/index.ts` if needed

### Adding a New Feature Module

Frontend: Create a directory under `src/components/<feature>/` with components. Add a Zustand store in `src/stores/` if state is needed.

Backend: Add a module under `src-tauri/src/` and expose commands through `src-tauri/src/commands/`.

## Naming Conventions

### Rust

- **함수/메서드**: `snake_case`, 도메인 의도 기반 (`switch_branch`, `stash_save` — git 명령어명 아님)
- **구조체/열거형**: `PascalCase` (`GitCliEngine`, `StatusEntry`, `MergeResult`)
- **모듈**: `snake_case` (`app_state`, `fs_events`)
- **불리언 반환 함수**: `is_` 접두사 (`is_auth_error`, `is_binary`)
- **변환 함수**: `_to_`/`_from_` 패턴 (`signature_to_author`, `repo_info_from_path`)

### TypeScript / React

- **컴포넌트 파일**: `PascalCase.tsx` (`BranchList.tsx`, `CommitPanel.tsx`)
- **유틸리티/훅 파일**: `kebab-case.ts` (`group-files.ts`, `fuzzy-search.ts`)
- **스토어 파일**: `kebab-case.ts` (`repository.ts`, `account.ts`)
- **컴포넌트 이름**: `PascalCase` (`BranchList`, `DiffViewer`)
- **이벤트 핸들러 props**: `on` 접두사 (`onDelete`, `onCommit`, `onChange`)
- **내부 핸들러**: `handle` 접두사 (`handleDeleteClick`, `handleConfirm`)
- **Props 인터페이스**: 컴포넌트명 + `Props` (`BranchListProps`, `CommitPanelProps`)
- **훅**: `use` 접두사 (`useToast`, `useBranchStore`)

### Rust ↔ TypeScript 경계

Rust `snake_case` 필드는 `#[serde(rename_all = "camelCase")]`로 자동 변환되어 TypeScript `camelCase`와 일치한다. 수동 변환 금지.

```
Rust: commit_id: String  →  JSON: "commitId"  →  TS: commitId: string
```

## Code Reuse Rules

### 공통 유틸리티 위치

| 종류 | Rust | TypeScript |
|---|---|---|
| Git 타입/트레이트 | `git/engine.rs` | `types/index.ts` |
| 에러 타입 | `error.rs` | `types/index.ts` (`AppError`) |
| 문자열 변환/파싱 | `git/commit.rs`, `git/branch.rs` | `lib/utils.ts` |
| Tauri IPC 래퍼 | — | `api/commands.ts` |
| 파일 상태 표시 | — | `lib/file-status.tsx` |
| 파일 그룹핑 | — | `lib/group-files.ts` |

### 재사용 원칙

- **Tauri 커맨드 래퍼**: 모든 `invoke()` 호출은 `api/commands.ts`에 함수로 래핑한다. 컴포넌트에서 `invoke()`를 직접 호출하지 않는다.
- **타입 정의**: Rust ↔ TS 공유 타입은 `types/index.ts`에 한 번만 정의한다. 컴포넌트 파일 내에 인라인 타입을 중복 정의하지 않는다.
- **에러 메시지 추출**: `getErrorMessage()` (`lib/utils.ts`)를 사용한다. `(err as any).message` 같은 직접 접근 금지.
- **조건부 클래스**: `clsx()` 또는 `cn()` (`lib/utils.ts`)을 사용한다. 문자열 템플릿으로 클래스를 조합하지 않는다.
- **인증 토큰 해석**: `resolve_token()` (`commands/auth.rs`)을 재사용한다. 각 커맨드에서 토큰 로직을 직접 구현하지 않는다.
- **인증 에러 판별**: `is_auth_error()` (`commands/git.rs`)를 재사용한다. 에러 문자열을 개별적으로 비교하지 않는다.
- **검증 함수**: `validate_message()` (`git/commit.rs`), `validate_branch_name()` (`git/branch.rs`) 등 기존 검증 함수를 재사용한다.

### 새 유틸리티 추가 기준

- 동일 로직이 **2곳 이상**에서 사용될 때만 유틸리티로 추출한다
- 1회성 로직을 미리 추상화하지 않는다
- 유틸리티 추가 시 위 표의 해당 위치에 배치한다

## Clean Code Rules

### 구조 규칙

- **Vertical Slice**: 기능 단위로 코드를 구성한다. 하나의 기능은 `commands/*.rs` + `git/*.rs` + `components/<feature>/` + `stores/*.ts`로 수직 분할된다.
- **단일 책임**: 각 파일은 하나의 도메인만 담당한다. `commands/git.rs`는 git 작업, `commands/branch.rs`는 브랜치 작업.
- **타입 중심 설계**: Rust 열거형(`MergeResult`, `FileStatus`)과 TS 유니온 타입으로 상태를 표현한다. 문자열 비교 대신 타입 매칭을 사용한다.

### Rust 규칙

- **`?` 연산자 우선**: `match`/`unwrap` 대신 `?`로 에러를 전파한다. `unwrap()`은 절대 실패하지 않는 경우에만 허용.
- **`spawn_blocking` 필수**: `git2` (libgit2) 호출은 반드시 `tokio::task::spawn_blocking()` 안에서 실행한다. async 컨텍스트에서 직접 호출 금지.
- **로깅 일관성**: 모든 git CLI 실행은 `tracing::info!("[git] git {} ...")` 형식으로 기록한다. 인증 재시도는 `tracing::warn!`으로 기록한다.
- **CLI 출력 파싱**: `parse_git_error()` 등 전용 파서로 stderr를 정리한다. 원본 stderr를 그대로 사용자에게 노출하지 않는다.
- **인증 재시도 패턴**: remote 작업 실패 시 `is_auth_error()` → 토큰 갱신 → 1회 재시도. 무한 재시도 금지.

```rust
// 올바른 패턴
match engine.fetch("origin", &token).await {
    Ok(()) => Ok(()),
    Err(e) if is_auth_error(&e) => {
        let new_token = token_store.refresh_token(&account_id).await?;
        engine.fetch("origin", &new_token).await
    }
    Err(e) => Err(e),
}
```

### TypeScript / React 규칙

- **함수형 컴포넌트만 사용**: 클래스 컴포넌트 금지 (ErrorBoundary 제외 — React API 제약).
- **Props 구조 분해**: 컴포넌트 매개변수에서 직접 구조 분해한다. `props.` 접두사 사용 금지.

```tsx
// 올바른 패턴
export function BranchList({ branches, currentBranch, onDelete }: BranchListProps) {
```

- **Zustand selector**: 스토어에서 필요한 필드만 개별 selector로 구독한다. 전체 스토어를 구독하지 않는다.

```tsx
// 올바른 패턴
const branches = useBranchStore((s) => s.branches);
const isLoading = useBranchStore((s) => s.isLoading);

// 금지 — 불필요한 리렌더링 유발
const store = useBranchStore();
```

- **`useMemo`/`useCallback`**: 비용이 큰 계산이나 자식 컴포넌트에 전달하는 콜백에 사용한다. 단순 값에는 사용하지 않는다.
- **i18n 필수**: 모든 사용자 노출 문자열은 `t()` 함수로 번역한다. 하드코딩된 한국어/영어 문자열 금지.

```tsx
// 올바른 패턴
addToast(t("error.failedToLoadAccounts", { error: getErrorMessage(err) }), "error");

// 금지
addToast("계정을 불러올 수 없습니다", "error");
```

- **Tailwind 시맨틱 토큰**: `text-primary`, `bg-accent`, `text-muted-foreground` 등 시맨틱 색상을 사용한다. `text-gray-500` 같은 직접 색상 지정 금지 (테마 호환성).

### 금지 사항

- `any` 타입 사용 금지 (불가피한 경우 `unknown` + 타입 가드 사용)
- `eslint-disable` 남용 금지 (`react-hooks/exhaustive-deps` 예외만 최소한으로 허용)
- 콘솔 디버깅 코드 커밋 금지 (`console.log`, `dbg!` 등)
- 미사용 import/변수 커밋 금지 (tsconfig strict 모드가 컴파일 타임에 차단)

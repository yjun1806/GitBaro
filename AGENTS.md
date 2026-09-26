# GitBaro

A macOS Git client for reviewing what coding agents changed across repositories and worktrees. Each repository is tied to one GitHub account, and every GitHub call for that repository uses that account.

- **Frontend**: React 19 + TypeScript + Tauri 2 + TailwindCSS 4
- **Backend**: Rust (edition 2021) + Tauri 2 + git2 (libgit2)
- **State**: Zustand 5 (frontend), Tauri managed state (backend)
- **Bundler**: Vite 6
- **Platform**: macOS (minimum 10.15)

This file is the single source of project instructions. `CLAUDE.md` only imports it (`@AGENTS.md`), so Claude Code and Codex read the same text.

## Project Structure

```
GitBaro/
├── src/                           # React frontend
│   ├── components/                # UI components (by domain)
│   │   ├── account/               # gh setup guard, login, account picker, avatar
│   │   ├── actions/               # GitHub Actions runs list and run detail
│   │   ├── branch/                # Branch panel, create/switch/rename/delete/merge dialogs
│   │   ├── commit/                # Working changes view, commit composer, file menus
│   │   ├── conflict/              # Merge conflict banner
│   │   ├── diff/                  # Diff viewer, find bar, markdown diff, image diff (swipe/onion/two-up)
│   │   ├── error/                 # ErrorBoundary, error toast
│   │   ├── graph/                 # Commit graph with worktree lanes, view-branch picker, graph menus
│   │   ├── history/               # Commit detail, commit menus/dialogs, merge action panel
│   │   ├── layout/                # MainLayout, MainColumn, ContentArea, RepoRail, splits, activity log
│   │   ├── live/                  # Follow panel (live changes as an agent edits)
│   │   ├── pr/                    # Read-only pull request list, detail, files
│   │   ├── repository/            # Repo list, add/clone dialogs, sync indicator
│   │   ├── review/                # Workspace review, git status line, multi-repo remote dialog
│   │   ├── settings/              # Settings panel
│   │   │   ├── app/               # App settings sections (general, appearance, tools, about)
│   │   │   ├── repo/              # Repository settings dialog and its sections
│   │   │   └── ui/                # Settings shell, rows, switch, segmented control
│   │   ├── sidebar/               # Sidebar tree: account > workspace > repo > worktree, drag and drop
│   │   ├── stash/                 # Stash list, detail, save dialog
│   │   ├── toolbar/               # Header path card (repo › folder › branch), sync and account zones
│   │   ├── ui/                    # Primitives (Dialog, ContextMenu, Select, Tabs, Tooltip, Spinner, LoadingState, layers.ts)
│   │   ├── welcome/               # First-launch welcome screen
│   │   └── worktree/              # Worktree panel, create dialog, chips, overlap badge
│   ├── stores/                    # Zustand stores
│   │   ├── account.ts             # GitHub accounts (persisted)
│   │   ├── activity.ts            # Activity log entries (persisted)
│   │   ├── activity-targets.ts    # Paths each screen asks the activity watcher to watch
│   │   ├── auto-sync.ts           # Last auto-sync result per repository
│   │   ├── commit-draft.ts        # Unfinished commit message per repository
│   │   ├── follow.ts              # Live follow on/off and the followed file
│   │   ├── history-view.ts        # Branch being viewed without checkout
│   │   ├── live-changes.ts        # Recent file activity per repo/worktree
│   │   ├── notify.ts              # Notification settings and the last unopened notification
│   │   ├── preferences.ts         # App preferences such as diff font size (persisted)
│   │   ├── repo-settings.ts       # Which repository settings dialog is open, and its section
│   │   ├── repository.ts          # Repository list, active repo/worktree (persisted)
│   │   ├── selection.ts           # Selected file/commit/stash per tab
│   │   ├── sync.ts                # Toolbar sync action state
│   │   ├── toast.ts               # Toast notifications
│   │   ├── ui.ts                  # Theme, sidebar width, split sizes, active tab (persisted)
│   │   └── workspace.ts           # Sidebar tree state: workspaces, order, sort, collapse (persisted)
│   ├── hooks/                     # Shared hooks: repo/worktree switching, watchers (useRepoWatcher,
│   │                              #   useLiveChanges), notifications, auto sync, useTauriEvent, keyboard
│   ├── api/
│   │   ├── commands.ts            # Tauri invoke() wrappers
│   │   ├── events.ts              # Backend event names and payload types
│   │   └── queries.ts             # React Query (TanStack) integration
│   ├── types/index.ts             # Shared TypeScript type definitions
│   ├── lib/                       # Utilities (utils, theme, file-status, repo-tree, graph-lanes, safe-storage, ...)
│   │   ├── md-diff/               # Markdown block diff (runs in a worker)
│   │   └── notify/                # macOS notifications: new-commit bursts, CI failures, delivery, open target
│   ├── i18n/                      # i18next config + translations (en, ko)
│   ├── styles/globals.css         # Color tokens, layers, fonts
│   ├── App.tsx                    # Root component (ErrorBoundary → GhSetupGuard → AppContent)
│   └── main.tsx                   # React entry point
├── src-tauri/                     # Rust backend
│   ├── src/
│   │   ├── lib.rs                 # Tauri app setup, plugin registration, command handlers
│   │   ├── main.rs                # Binary entry point
│   │   ├── error.rs               # AppError enum (thiserror + Serialize for frontend)
│   │   ├── events.rs              # Event names emitted to the frontend (fs:change, repo:activity, git:*)
│   │   ├── shell_env.rs           # Load the user's shell PATH (apps launched from Finder get a minimal one)
│   │   ├── git/                   # Git operations (hybrid strategy)
│   │   │   ├── engine.rs          # GitEngine + GitRemoteEngine traits, shared types
│   │   │   ├── cli.rs             # GitCliEngine — CLI-based ops (hooks-aware)
│   │   │   ├── libgit.rs          # LibGitEngine — libgit2-based ops (read-only, fast)
│   │   │   ├── status.rs          # Working-tree status via `git status --porcelain=v2`
│   │   │   ├── diff.rs            # Diff conversion utilities
│   │   │   ├── file_diff.rs       # Files changed and line diff between two trees (commit range, PR)
│   │   │   ├── branch.rs          # Branch name validation
│   │   │   ├── commit.rs          # Commit message/oid validation, ref map
│   │   │   ├── binary.rs          # Binary file detection & image preview
│   │   │   ├── merge.rs           # Merge result helpers
│   │   │   ├── merge_base.rs      # Where HEAD split from the default branch
│   │   │   ├── stash.rs           # Stash helpers
│   │   │   ├── remote.rs          # Remote URL parsing
│   │   │   ├── output_parser.rs   # Parse git fetch/push/pull output
│   │   │   ├── unpushed.rs        # Commits not on any remote (the review basis)
│   │   │   ├── untracked.rs       # Line counts of untracked files (size-capped)
│   │   │   ├── walk.rs            # Lazy commit walk
│   │   │   ├── head_advance.rs    # Did HEAD only move forward (for new-commit notifications)
│   │   │   ├── review_worktrees.rs # Worktrees of every registered repo with branch and HEAD
│   │   │   └── worktree_base.rs   # Which branch a worktree branch came from
│   │   ├── commands/              # Tauri #[tauri::command] handlers
│   │   │   ├── git.rs             # status, stage, unstage, commit, diff, fetch, push, pull, stash
│   │   │   ├── auto_sync.rs       # per-repo auto sync: post-fetch snapshot, safe ff-only to upstream
│   │   │   ├── branch.rs          # branches, create, switch, delete, compare, merge, rename, bases
│   │   │   ├── range_changes.rs   # fork point from the default branch; files and diff between two commits
│   │   │   ├── history.rs         # commit history (any branch, no checkout), detail, file diff, avatars
│   │   │   ├── workspace_history.rs # workspace timeline across repos
│   │   │   ├── wip.rs             # uncommitted files ordered by edit time (live follow)
│   │   │   ├── unpushed.rs        # commits not on any remote (push confirmation)
│   │   │   ├── remote_plan.rs     # per-repo plan for multi-repo fetch/pull/push
│   │   │   ├── review.rs          # worktrees of all registered repos
│   │   │   ├── auth.rs            # gh CLI auth, account CRUD, per-repo account, token retry
│   │   │   ├── diff.rs            # File diff with binary/image preview
│   │   │   ├── repo.rs            # open, clone (URL-validated), add, close, search GitHub repos
│   │   │   ├── settings.rs        # app settings, theme, editor/terminal/AI-CLI detection & launch
│   │   │   ├── editor_line.rs     # CLI arguments to open an editor at a line
│   │   │   ├── environment.rs     # settings file location, git/gh paths and versions
│   │   │   ├── notify.rs          # HEAD advance check for notifications
│   │   │   ├── pull_request.rs    # read-only PR list, detail, files, file diff
│   │   │   ├── actions.rs         # GitHub Actions workflow runs & jobs
│   │   │   ├── watch.rs           # start/stop FS watcher for the active repo (emits fs:change)
│   │   │   ├── activity.rs        # multi-repo activity watcher (emits repo:activity)
│   │   │   └── worktree.rs        # worktree list/add/remove
│   │   ├── github/                # GitHub API client (reqwest)
│   │   │   ├── client.rs          # HTTP client, auth headers, path-segment validation
│   │   │   ├── cache.rs           # ETag and short-lived response cache
│   │   │   ├── pull_request.rs    # PR queries (GraphQL list/detail, REST files)
│   │   │   ├── pr_parse.rs        # Turn PR responses into view types (fixtures/ holds sample responses)
│   │   │   ├── actions.rs         # GitHub Actions API
│   │   │   ├── issue.rs           # Issues API (client ready; not wired to a command)
│   │   │   └── notifications.rs   # Notifications API (client ready; not wired to a command)
│   │   ├── gh/                    # GitHub CLI (gh) integration
│   │   │   └── cli.rs             # gh binary discovery, version check (≥2.40), auth status
│   │   ├── state/                 # Application state
│   │   │   ├── app_state.rs       # Window bounds persistence, open repos, sidebar width
│   │   │   ├── json_file.rs       # Crash-safe JSON files in the app data directory
│   │   │   └── token_store.rs     # In-memory token cache (Zeroizing); source of truth is `gh` CLI
│   │   └── watcher/
│   │       ├── fs_events.rs       # FS watcher for the active repo (notify crate)
│   │       └── activity.rs        # When files last changed, across many repos and worktrees
│   ├── Cargo.toml
│   └── tauri.conf.json            # Tauri window config, plugins, bundle settings
├── docs/                          # Plans and review notes (see the note at the top of each)
├── scripts/                       # Release helpers (Cargo.toml / Cargo.lock version bump)
├── package.json
├── tsconfig.json
├── eslint.config.js               # ESLint 9 flat config
├── commitlint.config.cjs          # Conventional Commits enforcement
└── .husky/                        # Git hooks (pre-commit: typecheck + lint, commit-msg: commitlint)
```

## Git Implementation Rules (CRITICAL)

Reference implementation: **GitHub Desktop** (https://github.com/desktop/desktop).

### Hybrid Strategy

| Operation type | Engine | Rationale |
|---|---|---|
| **Read-only** (diff, log, blame, branch list) | `git2` (libgit2) via `LibGitEngine` | Performance — no hooks needed |
| **Working-tree status** | `git status --porcelain=v2` (`git/status.rs`) | libgit2 status differs from git in ways users notice |
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

The package manager is **pnpm** (`pnpm-lock.yaml`).

```bash
# Frontend
pnpm dev                 # Vite dev server (port 1420)
pnpm build               # tsc + vite build
pnpm lint                # ESLint 9 flat config (eslint.config.js); errors fail, warnings don't
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest run (frontend only; Rust tests need cargo test)
pnpm test:watch          # vitest watch mode

# The pre-commit hook runs `pnpm typecheck && pnpm lint`.
# It does not run tests: run `pnpm test` (and `cargo test` if you touched Rust) before pushing.

# Tauri (full app)
pnpm tauri dev           # Dev mode with hot reload
pnpm tauri build         # Production build (.app bundle)
pnpm build:install       # Build the .app and copy it to /Applications

# Release (commit-and-tag-version)
pnpm release             # Bump version (4 files), update CHANGELOG, create tag
pnpm release --dry-run   # Preview the next release without writing

# Rust only
cd src-tauri && cargo check          # Type check
cd src-tauri && cargo clippy         # Lint
cd src-tauri && cargo test           # Rust unit tests
cd src-tauri && cargo build          # Build
```

`CHANGELOG.md` is generated by `pnpm release`. Do not edit it by hand.

## Conventions

### Rust

- All Tauri commands are async functions annotated with `#[tauri::command]` in `src-tauri/src/commands/`
- Errors use `AppError` enum (in `error.rs`) which derives `thiserror::Error` and implements custom `Serialize` for frontend consumption (serialized as `{ type, message }`)
- All serializable types use `#[serde(rename_all = "camelCase")]` for JS interop
- Logging via `tracing` crate (debug level for gitbaro, warn for git2)
- CPU-intensive git ops use `tokio::task::spawn_blocking()`
- Each command opens its own `git2::Repository` (cheap) inside `spawn_blocking`; there is no long-lived per-repo worker
- Commands that read many repositories compute each repository separately: one failing repository fills its own `error` and the rest still return
- Working-tree changes are pushed to the frontend via the FS watcher (`commands/watch.rs` + `watcher/fs_events.rs`) emitting `fs:change` (and `fs:git-dir-change` for HEAD/refs/index); the status query keeps a slow poll as a fallback
- Activity across all registered repos and worktrees comes from `watcher/activity.rs` via `commands/activity.rs`, emitting `repo:activity`
- Event names live in `events.rs`; the frontend mirror is `src/api/events.ts`

### TypeScript / React

- Path alias: `@/*` maps to `./src/*`
- Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- State management: Zustand stores in `src/stores/`
- Data fetching: TanStack React Query via `src/api/queries.ts`
- Tauri IPC: `invoke()` wrappers in `src/api/commands.ts`
- Tauri events: subscribe with `useTauriEvent` (`src/hooks/useTauriEvent.ts`) using names and payload types from `src/api/events.ts`. Don't call `listen()` with a string literal in components.
- Styling: TailwindCSS 4 utility classes
- i18n: i18next with English (`en`) and Korean (`ko`) in `src/i18n/locales/<lang>/translation.json`. Keys are grouped by feature under top-level namespaces (`review`, `graph`, `live`, `pr`, `repoSettings`, `settingsPanel`, ...). Put a new string under its feature's namespace in both files.
- Components organized by domain feature, not by component type
- Path comparison: use `trimTrailingSlash()` / `isSameFolder()` (`lib/utils.ts`), not raw string equality

### Persisted stores (zustand `persist`)

- Keep `version` at 0 (the zustand default). Adding an optional field is not a reason to bump it: read it with a default in `merge`.
- `merge` sanitizes every persisted field (`{ ...current, ...sanitize(persisted) }`). A broken or missing field falls back to its default; the other fields stay as they were.
- Never bump `version` without a `migrate`. Without one, zustand drops the stored value, and an older build rolled back to would overwrite it with empty state. `workspace.ts` is at version 2 and has a `migrate`; follow that pattern if a bump is ever unavoidable.
- Never wipe fields you did not change.

### Review model

- The purpose is watching what agents change, not approving it. Never add approval, "viewed", "reviewed", or "N left to review" concepts; words describe what changed or what is happening now.
- The basis is **commits not on any remote** (`git rev-list HEAD --not --remotes`, `git/unpushed.rs`), counted even when the branch has no upstream yet.
- The unpushed range (remote boundary → HEAD, committed changes only) can be shown as one combined diff: `get_range_changed_files` / `get_range_file_diff` (`commands/range_changes.rs`) compare two commits' trees. The fork point from the default branch comes from `get_divergence_point`.
- Viewing a branch in the graph does not check it out (`stores/history-view.ts`).
- The repository display alias (repository settings) is display-only. Paths, git commands, account lookup, and storage keys use the real folder path and name. Use `useRepoDisplay` to show a name.

### UI

- One owner per number: each count (uncommitted files, commits to push, ...) is computed from one source. Show it at most once per level: the sidebar signal (navigation) and the one place where you act on it (e.g. the graph WIP row / WorkSwitcher tab for uncommitted files, the Push button for commits to push). Status lines and tab badges state the condition in words, without repeating the number.
- Colors come from tokens in `src/styles/globals.css`, never raw hex or Tailwind palette colors.
- Layers: 0 window frame (`--frame`) and 1 canvas (`--canvas`) share one ground color, so the sidebar, header, and content read as one surface; 2 card/panel (`PANEL_SURFACE`), 3 floating menus, popovers, dialogs, tooltips (`FLOATING_SURFACE`). Both surfaces are in `components/ui/layers.ts`.
- The brand color (`--acc`, `primary`) is for emphasis only: selection, the main button, active tab underline, focus ring, links. Everything else is grays. Status colors (live, diff, CI) are separate from the brand color.
- Text uses three levels: `--fg` body, `--fg2` secondary, `--muted` description.
- Fonts: Pretendard for UI text, D2Coding for code and diffs (bundled in `src/assets/fonts/`).
- Never mark selection or emphasis with a vertical bar on the left edge (no `SelectionBar`, `border-l-*` accents, inset box-shadow bars, `before:` bars). Selection is a quiet fill (`--acc-sel` / `--panel-sel` / `--frame-sel`) plus a heavier label; a just-changed line is `FocusFlash` once, then a faint `--live-faint` tint with an orange line number. Component rules: `docs/design-system.md`.
- Context menus: destructive items (`variant: "danger"`) go last, and the action asks for confirmation (`ConfirmCommandDialog` with `confirmVariant="destructive"`).
- Loading: waiting for a panel's content is `LoadingState` (a list row: `layout="row"`); a busy button swaps its icon with `BusyIcon` and sets `disabled` + `aria-busy`; a small inline "working" mark is `Spinner` smoothed with `useSteadyFlag`. Never spin another icon or use `animate-pulse`. Details: `docs/loading-design.md`.
- Motion: durations, easing, and enter animations (`animate-pop-in`, `animate-dialog-in`, `animate-reveal`, `animate-content-in`, ...) live in `src/styles/globals.css`. Animate opacity and transform only, and keep enter animations at `backwards` fill.

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
- **불리언 반환 함수**: `is_` 접두사 (`is_auth_error`, `is_previewable`)
- **변환 함수**: `_to_`/`_from_` 패턴 (`signature_to_author`, `repo_info_from_path`)

### TypeScript / React

- **컴포넌트 파일**: `PascalCase.tsx` (`BranchPanel.tsx`, `CommitComposer.tsx`)
- **유틸리티/훅 파일**: `kebab-case.ts` (`group-files.ts`, `fuzzy-search.ts`). `src/hooks/`의 훅 파일은 훅 이름 그대로 쓴다 (`useTauriEvent.ts`).
- **스토어 파일**: `kebab-case.ts` (`repository.ts`, `history-view.ts`)
- **컴포넌트 이름**: `PascalCase` (`BranchPanel`, `DiffViewer`)
- **이벤트 핸들러 props**: `on` 접두사 (`onDelete`, `onCommit`, `onChange`)
- **내부 핸들러**: `handle` 접두사 (`handleDeleteClick`, `handleConfirm`)
- **Props 인터페이스**: 컴포넌트명 + `Props` (`BranchPanelProps`, `DiffViewerProps`)
- **훅**: `use` 접두사 (`useTauriEvent`, `useRepositoryStore`)

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
| Tauri 이벤트 | `events.rs` | `api/events.ts` + `hooks/useTauriEvent.ts` |
| 파일 상태 표시 | — | `lib/file-status.tsx` |
| 파일 그룹핑 | — | `lib/group-files.ts` |
| 층별 겉모습 | — | `components/ui/layers.ts` |

### 재사용 원칙

- **Tauri 커맨드 래퍼**: 모든 `invoke()` 호출은 `api/commands.ts`에 함수로 래핑한다. 컴포넌트에서 `invoke()`를 직접 호출하지 않는다.
- **타입 정의**: Rust ↔ TS 공유 타입은 `types/index.ts`에 한 번만 정의한다. 컴포넌트 파일 내에 인라인 타입을 중복 정의하지 않는다.
- **에러 메시지 추출**: `getErrorMessage()` (`lib/utils.ts`)를 사용한다. `(err as any).message` 같은 직접 접근 금지.
- **조건부 클래스**: `clsx()` 또는 `cn()` (`lib/utils.ts`)을 사용한다. 문자열 템플릿으로 클래스를 조합하지 않는다.
- **인증 토큰 해석**: `resolve_token()` (`commands/auth.rs`)을 재사용한다. 각 커맨드에서 토큰 로직을 직접 구현하지 않는다.
- **GitHub API 재시도**: GitHub API 호출은 `call_with_token_retry()` (`commands/auth.rs`)로 감싼다. 401이면 토큰을 새로 받아 한 번만 다시 부른다.
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
export function GraphSplit({ top, bottom, topCollapsed = false }: GraphSplitProps) {
```

- **Zustand selector**: 스토어에서 필요한 필드만 개별 selector로 구독한다. 전체 스토어를 구독하지 않는다.

```tsx
// 올바른 패턴
const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
const activeTab = useUIStore((s) => s.activeTab);

// 금지 — 불필요한 리렌더링 유발
const store = useRepositoryStore();
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

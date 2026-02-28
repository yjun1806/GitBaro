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
│   │   │   ├── repo.rs            # open, clone, add, close, search GitHub repos
│   │   │   ├── settings.rs        # app settings, theme, editor detection/launch
│   │   │   └── worktree.rs        # worktree add/remove/preview
│   │   ├── github/                # GitHub REST API client (reqwest)
│   │   │   ├── client.rs          # HTTP client with auth headers
│   │   │   ├── issue.rs           # Issues API
│   │   │   ├── pull_request.rs    # Pull Requests API
│   │   │   └── notifications.rs   # Notifications API
│   │   ├── gh/                    # GitHub CLI (gh) integration
│   │   │   └── cli.rs             # gh binary discovery, version check (≥2.40), auth status
│   │   ├── state/                 # Application state
│   │   │   ├── app_state.rs       # Window bounds persistence, open repos, sidebar width
│   │   │   └── token_store.rs     # GitHub token storage (Tauri plugin keychain)
│   │   ├── concurrency/
│   │   │   └── repo_thread.rs     # RepoWorker — dedicated thread per git2::Repository (mpsc)
│   │   └── watcher/
│   │       └── fs_events.rs       # File system watcher (notify crate)
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
- `RepoWorker` serializes git2 operations on a dedicated thread via mpsc channel

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

# GitBaro Project Rules

## Git 작업 구현 규칙 (CRITICAL)

Git 관련 기능 구현 시 **GitHub Desktop** (https://github.com/desktop/desktop)을 참조 구현으로 따른다.

### 하이브리드 전략
- **읽기 전용 작업** (status, diff, log, blame, branch list): `git2` (libgit2) 사용 — 성능 우선
- **쓰기 작업 + hooks 필요** (commit, checkout, merge, stash): `git CLI` 사용 — hooks 실행 보장
- **리모트 작업** (fetch, push, pull, clone): `git CLI` + `GIT_ASKPASS` 인증

### 절대 금지
- git hooks가 필요한 작업(commit, checkout, merge)에 git2 직접 사용
- libgit2는 `.git/hooks/` 스크립트를 실행하지 않음

### CLI 실행 패턴
- `GitCliEngine`의 `run_local` / `run_local_checked` 메서드 사용
- 인증 필요 시 `AskpassScript` 패턴 사용 (토큰이 프로세스 인자에 노출되지 않음)
- 메서드명은 도메인 의도 기반 (예: `switch_branch`, `stash_save`) — CLI 명령명이 아님

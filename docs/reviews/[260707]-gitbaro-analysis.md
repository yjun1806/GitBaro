# GitBaro 종합 분석 (2026-07-07)

> 대상: `GitBaro` (Tauri 2 + React 19 + Rust) — 프론트 15,514라인/117파일, Rust 7,598라인/41파일, 62커밋(2026-02-23 시작). 전 소스 전수 조사.
> 방법: 병렬 4축 분석(Rust 백엔드 · React 프론트엔드 · 테스트/프로세스 · 제품 기능 인벤토리) + CLAUDE.md 규칙 대조. **실행/런타임 재현은 하지 않음** — 동적 검증 필요 항목은 "미확인" 표기.
> 원칙: 모든 발견은 `파일:라인` 근거. 코드는 수정하지 않음(분석 전용).

## 요약 (축별 건수)

| 축 | CRITICAL | HIGH | MEDIUM | LOW | 합 |
|---|:--:|:--:|:--:|:--:|:--:|
| 1. 버그 | 0 | 1 | 0 | 1 | 2 |
| 2. 보안 | 0 | 0 | 1 | 0 | 1 |
| 3. 성능 | 0 | 0 | 1 | 1 | 2 |
| 4. 아키텍처·코드 품질 | 0 | 0 | 1 | 3 | 4 |
| 5. 테스트·프로세스 | 0 | 3 | 0 | 2 | 5 |
| **합** | **0** | **4** | **3** | **7** | **14** |

CRITICAL 없음. HIGH 4건 중 3건이 테스트·프로세스 축에 몰려 있다 — **코드 품질(Rust 9/10 · 프론트 9/10)과 프로세스 성숙도(3.5/10)의 괴리**가 이 프로젝트의 핵심 리스크.

### 축별 점수

| 축 | 점수 | 한 줄 |
|---|:--:|---|
| Rust 백엔드 | 9/10 | 하이브리드 전략 위반 0건, 보안 설계 프로덕션 수준 |
| React 프론트엔드 | 9/10 | 컨벤션 위반 사실상 0건 (invoke 래퍼·selector·any·i18n 전수 준수) |
| 테스트·프로세스 | 3.5/10 | CI 전무 · lint 실행 불가 · write 경로 무테스트 |
| 제품 완성도 | 6.5/10 | 차별화는 실재하나 코어 기능(hunk staging 등) 공백 |

---

## 강점 (근거 요약)

- **AskpassScript 토큰 주입** — `0o700` + `create_new`로 TOCTOU 방지, 토큰이 프로세스 인자에 절대 미노출, `Drop` 정리 + 시작 시 `sweep_stale_askpass()` 잔여물 청소 (`git/cli.rs:898-976`). 토큰 캐시는 `Zeroizing<String>` + RwLock (`state/token_store.rs`).
- **커맨드 인젝션 방어** — 모든 git 실행이 `Command::args()` 슬라이스(셸 미경유) + `--` 구분자, `validate_branch_name`이 leading `-` 거부 (`git/cli.rs:293`). clone URL은 `ext::`/`file://`/`fd::`/leading-dash 거부 + `protocol.ext.allow=never` 이중 방어 (`git/remote.rs:30`, 테스트 `:101`).
- **하이브리드 전략 준수** — 쓰기+훅(commit/switch/merge/stash)은 전부 GitCliEngine(`commands/git.rs:330,556,567`, `commands/branch.rs:185,302`), 읽기는 LibGitEngine. commit/checkout/merge를 git2로 실행하는 커맨드 0건. `spawn_blocking` 규율도 26개 사용처 전수 준수.
- **프론트 컨벤션 실측 위반 0건** — `@tauri-apps/api/core` import가 `api/commands.ts` 단일 파일에만 존재, Zustand 무인자 구독 0건, `any` 0건(테스트 제외), i18n 하드코딩 실질 0건. `eslint-disable`은 허용된 `exhaustive-deps` 7건뿐.
- **상태 관리 경계** — React Query(서버)/Zustand(클라이언트) 분리 명확. invalidation을 mutation `onSuccess`에 집중, staleTime을 데이터 특성별 차등(`api/queries.ts`). cross-store 동기화를 store subscribe로 격리(`stores/selection.ts:69-89`).

---

## HIGH

### H1 (프로세스) CI 전무 + pre-commit 훅 껍데기 + lint 실행 불가 — 자동 품질 게이트 0
- 근거: `.github/` 디렉터리 자체 부재. `.husky/pre-commit`은 `echo` 타임스탬프 한 줄. `package.json`에 `"lint": "eslint src --ext .ts,.tsx"` 스크립트는 있으나 `eslint`·`@typescript-eslint` 패키지 미설치(`node_modules/.bin/eslint` 부재) → `pnpm run lint` 즉시 실패.
- 문제: `tsc --noEmit`·`vitest`·`cargo clippy` 어느 것도 커밋/PR에서 강제되지 않는다. 현재 9점대 코드 품질은 "규율 있는 작성자" 1인에 전적으로 의존하며, 회귀 방어선이 없다. CLAUDE.md의 `npm run lint` 안내는 따라 하면 실패하는 거짓 문서.
- 실패 시나리오: 컨벤션을 모르는 기여자(또는 미래의 본인)가 `useXStore()` 전체 구독·`any`를 커밋 → 아무 게이트도 없이 main 진입 → 위반이 누적된 뒤에야 발견.
- 권장: `.github/workflows/ci.yml`(pnpm install → `tsc --noEmit` → `vitest run` → `cargo clippy -- -D warnings` → `cargo test`) 추가. `.husky/pre-commit`을 최소 typecheck+test로 교체. eslint flat config 작성해 lint 스크립트 복구.

### H2 (테스트) 핵심 write 경로 전체 무테스트 — 커버리지 실측 ~1–2%
- 근거: 프론트 테스트는 순수 유틸 2파일뿐(`src/lib/__tests__/avatar-color.test.ts`, `group-files.test.ts`) — TS/TSX 115개 중 2개. Rust는 `#[cfg(test)]` 5파일 15테스트가 전부 입력 검증 파서(branch/remote/client/gh-cli/settings escape)에 집중.
- 문제: 가장 위험한 경로가 정확히 사각지대다 — `validate_message()`(`git/commit.rs`) 0건, diff 변환(`git/diff.rs`) 0건, CLI 인자 조립(`git/cli.rs`) 0건, 토큰 캐시(`state/token_store.rs`) 0건, merge/stash/libgit 엔진 0건. 하이브리드 전략에서 훅·부수효과를 지닌 write 경로가 전부 미검증. 프로젝트 규칙(80% 커버리지)과의 괴리 극심.
- 실패 시나리오: diff 변환 로직 리팩터링 중 hunk 헤더 파싱 회귀 → 테스트 없어 통과 → 사용자 diff 뷰가 조용히 깨진 채 배포.
- 권장: 커버리지 숫자보다 위험 순서로 — ① `validate_message` ② `convert_diff`/`diff_to_string` ③ CLI 인자 조립(옵션 인젝션 방어) ④ token_store Zeroizing 동작. 프론트는 스토어 리듀서와 `api/commands.ts` 에러 매핑부터.

### H3 (테스트 인프라) 설치만 되고 죽어 있는 테스트 도구 체인
- 근거: `@testing-library/react`·`@testing-library/jest-dom`·`jsdom`이 devDependencies에 있으나 `src/` 어디에서도 import 0건. `vite.config.ts`에 `test` 블록 없음, `vitest.config.*` 부재 → 기본 node 환경으로만 동작.
- 문제: 컴포넌트 테스트를 쓰려는 순간 jsdom 환경 미설정으로 실패한다. 도구는 있는데 배선이 없어, 테스트 작성의 진입 장벽이 불필요하게 높은 상태.
- 권장: `vite.config.ts`에 `test: { environment: 'jsdom', setupFiles: [...] }` 설정 후 컴포넌트 스모크 테스트 1개로 배선 검증. 안 쓸 거면 3개 패키지 제거(H4와 함께).

### H4 (버그·Rust) `terminal_binary_path().unwrap()` — 유일한 실질 panic 경로
- 근거: `src-tauri/src/commands/settings.rs:583,591`.
- 문제: 터미널 감지 시점과 실행 시점 사이에 해당 앱이 제거되면 `unwrap()`이 런타임 panic → Tauri 커맨드 스레드 붕괴. 코드베이스 전체에서 unwrap 8/expect 2 중 나머지는 상수·Mutex 등 안전 케이스라, 이것이 유일한 실질 위험.
- 실패 시나리오: 사용자가 iTerm 삭제 직후 "터미널에서 열기" 클릭 → panic → 에러 토스트 대신 커맨드 무응답.
- 권장: `ok_or(AppError::...)?`로 교체해 `{type, message}` 정상 에러 경로로 합류시킬 것.

---

## MEDIUM

### M1 (아키텍처·Rust) GitEngine 트레이트가 훅 우회 쓰기를 컴파일 타임에 차단하지 못함
- 근거: `git/engine.rs:230-248` — 읽기·쓰기 통합 트레이트. 그 결과 LibGitEngine이 훅을 실행하지 않는 쓰기 메서드를 강제 구현: `git/libgit.rs:118,145`(commit), `:258,261`(checkout_tree), `:413,455`(merge+commit), `:354`(discard), `:365,373`(stash).
- 문제: 이들은 현재 어느 커맨드에서도 호출되지 않는 dead code지만, 실수로 호출하면 `.git/hooks/`가 **조용히 건너뛰어진다**. "훅 필요한 쓰기는 CLI"라는 CLAUDE.md 절대 규칙이 관례로만 지켜지고 컴파일 타임 보호가 없다.
- 권장: `GitReadEngine`(LibGitEngine만 구현) / `GitWriteEngine`(GitCliEngine만 구현)으로 분리, LibGitEngine의 쓰기 메서드 제거. 위반을 타입 시스템이 차단하게.

### M2 (보안·공급망) 미사용 의존성 9개+ — 공급망 표면·감사 노이즈
- 근거: `diff2html`(^3.4.0) — `src/`·`src-tauri/` 전체 import 0건(실제 diff 렌더는 `@git-diff-view/react`가 담당, `DiffViewer.tsx`). `@codemirror/*` 8종(lang-css/html/javascript/json/markdown/python, state, view) — import 0건(`@git-diff-view`는 lowlight+highlight.js 사용, CodeMirror 비의존).
- 문제: 설치된 채 안 쓰이는 패키지는 `pnpm audit` 노이즈이자 공급망 공격 표면. 번들에는 안 들어가더라도(tree-shake) lockfile·CI 캐시·감사 대상에는 계속 남는다.
- 권장: 에디터 도입 로드맵이 없다면 9개 일괄 제거. H3 결정에 따라 testing-library 계열도 정리.

### M3 (성능·프론트) 리스트 아이템 `React.memo` 미적용 — 타이핑 시 리스트 전체 리렌더
- 근거: `React.memo` 사용 전체 1건뿐. `FileEntry` 등 다수 렌더되는 리스트 아이템 미적용. 대조적으로 `ChangesView.tsx:82-93`은 파생 배열 useMemo 캐싱을 주석과 함께 정확히 수행.
- 문제: 커밋 메시지 입력마다 상위 리렌더 → memo 없는 파일 리스트 전체 재렌더. 수백 파일 변경된 대형 리포에서 입력 지연 체감 가능(미확인 — 프로파일링 필요).
- 권장: `FileEntry`·repo/branch 리스트 아이템 memo화 + 콜백 안정 참조 전달.

---

## LOW

### L1 (버그·프론트) 항상 참인 조건식
- 근거: `src/components/commit/ChangesView.tsx:37` — `statusEntries.length >= 0`은 항상 true. `> 0` 의도로 추정.

### L2 (품질·프론트) Tailwind 시맨틱 토큰 이탈 16건
- 근거: 14건이 `ConflictPreviewModal.tsx`의 diff red/green(관례상 방어 가능하나 라이트/다크 하드코딩 반복), 실질 대상은 `MergeActionPanel.tsx:135`(`dark:bg-gray-900`)·`ConfirmCommandDialog.tsx:79`(`bg-red-600`).
- 권장: diff 전용 색은 `--diff-add`/`--diff-remove` CSS 변수로 추출, 나머지는 `bg-destructive` 등 시맨틱 토큰 교체.

### L3 (품질) 파일 크기·책임 — 3곳
- 근거: `git/cli.rs` 1,035줄(800 상한 초과 — 로컬/원격/AskpassScript 분할 가능), `commands/settings.rs` 643줄(앱 설정 + 외부 프로그램 감지/실행 혼재), `RepoListView.tsx` 614줄(컨텍스트메뉴/그룹/계정선택 혼재).

### L4 (문서) CLAUDE.md 드리프트 2건
- 근거: `src-tauri/src/git/remote.rs`가 실존(테스트 포함)하나 프로젝트 구조 트리에 누락. 개발 명령이 `npm run ...`으로 안내되나 실제는 `pnpm@10.27.0`(마이그레이션 커밋 `de2a7ec`).
- 권장: remote.rs 추가 + npm→pnpm 통일(H1의 lint 복구와 함께).

### L5 (성능·프론트) 인라인 `style={{}}` 14건
- 근거: 대부분 이미지 diff 동적 스타일이라 불가피. 일부 상수 추출 가능한 정도.

---

## 제품 평가 — Git GUI 도구로서

### 기능 구현 현황 (73개 Tauri 커맨드 · 18개 컴포넌트 도메인 전수)

상태: ✅ 구현 · 🚧 부분 · ❌ 미구현

| 영역 | 상태 | 근거 |
|---|:--:|---|
| Status/Stage/Commit(+amend) | ✅ | `get_status`·`create_commit(amend)` / `ChangesView`·`CommitPanel` |
| Diff 뷰어(unified/split) | ✅ | `get_diff`·`get_file_diff` / `DiffViewer` |
| 이미지 Diff 4모드 | ✅ | swipe/onion/two-up/difference + SVG 프리뷰 |
| Branch CRUD·비교·Merge(3전략) | ✅ | `compare_branches` / Merge·Squash·Rebase / `MergeActionPanel` |
| Conflict 복구 | ✅ | `abort/continue_merge_or_rebase` / `MergeConflictBanner`·`ConflictPreviewModal` |
| Remote(fetch/push/pull, force-with-lease) | ✅ | ASKPASS 주입 + auth 실패 1회 재시도 |
| Stash(파일 단위 부분 포함) | ✅ | `stash_push_partial` / `StashView` |
| Worktree + 라이브 프리뷰 | ✅ | `start/stop_worktree_preview` |
| GitHub Actions 뱃지 | ✅ | push 후 자동 갱신 |
| per-repo GitHub 계정 | ✅ | `set/get_repo_account`·`resolve_token` / `AccountSwitcher` |
| 에디터·터미널·AI CLI 원클릭 실행 | ✅ | `detect_installed_*`·`open_ai_cli_in_terminal` |
| i18n(en/ko)·테마·온보딩 | ✅ | `WelcomeScreen`·`GhSetupGuard` |
| PR 상태 뱃지 | 🚧 | UI만 존재, `github/pull_request.rs` 커맨드 미연결 |
| Blame | 🚧 | `libgit.rs:518` 백엔드 구현·커맨드/UI 미연결(죽은 코드) |
| 키보드 단축키 | 🚧 | 기본 몇 개뿐, 커맨드 팔레트 없음 |
| **Hunk/라인 단위 부분 스테이징** | ❌ | 스테이징은 파일 단위만 |
| **Commit graph 시각화** | ❌ | `HistoryTimeline`은 선형 리스트 |
| **Interactive rebase** | ❌ | rebase는 pull 전략·충돌 복구용뿐 |
| Cherry-pick / Revert / Tag | ❌ | 전무 |
| Reflog UI / Submodule / Bisect | ❌ | reflog는 내부 최근-브랜치 추출에만 사용 |
| PR/이슈 생성·리뷰 | ❌(의도) | 제품 방침 — 웹에서 쉬운 기능 미구현 |

집계: **✅ 12 · 🚧 3 · ❌ 6**(+의도적 제외 1).

### 차별화 3 · 치명적 공백 3

| | 항목 | 판단 |
|---|---|---|
| 차별화 ① | **per-repo GitHub 계정 자동 바인딩** | 회사/개인 계정 리포별 자동 전환. GitHub Desktop·Fork에 없는 실전 pain point. `repo_accounts.json` 매핑 → TokenStore → ASKPASS 주입 구현도 견고. **이것 하나로 설치 가치 있음** |
| 차별화 ② | **Worktree 라이브 프리뷰 + AI CLI 원클릭** | worktree에서 Claude/Cursor를 바로 띄우는 워크플로. 경쟁 GUI에 없음 |
| 차별화 ③ | **이미지 diff 4모드** | 디자인·에셋 리포에서 Tower급 이상 |
| 공백 ① | **Hunk 단위 스테이징 부재** | "한 파일에서 이 변경만 커밋"은 일상 동작 — 없으면 `git add -p` 하러 터미널 이탈. GUI 존재 이유의 절반 상실 |
| 공백 ② | **커밋 그래프 부재** | 브랜치 얽힌 리포에서 상황 파악 불가. Sourcetree/Fork 대비 최대 열세 |
| 공백 ③ | **Interactive rebase·cherry-pick·tag 부재** | push 전 커밋 정리(squash/reword)·릴리스 태깅이 GUI만으로 완결 불가 |

### 판정

"웹에서 쉬운 기능은 안 만든다"는 스코프 방침은 옳으나, 현재 빠진 것은 웹 대체재가 아니라 **로컬 Git GUI의 존재 이유**에 해당한다. 지금 상태는 "세컨드 툴"(계정 전환 + 이미지 diff 용도) — **hunk staging 하나만 들어와도** "계정 자동 전환 + hunk staging" 조합으로 GitHub Desktop을 대체하는 데일리 드라이버가 된다.

저비용 기회: blame(`libgit.rs:518`)·PR 뱃지(`pull_request.rs`)는 백엔드가 이미 있어 커맨드/UI 연결만으로 기능화 가능.

---

## 권장 로드맵 (우선순위)

| 순위 | 항목 | 근거 | 예상 규모 |
|:--:|---|---|---|
| 1 | CI + pre-commit + lint 복구 | H1 — 9점 코드가 방어선 0으로 성장 중인 것이 최대 리스크 | 반나절 |
| 2 | write 경로 핵심 테스트 4종 | H2 — commit 검증·diff 변환·CLI 인자·token store | 1–2일 |
| 3 | **Hunk 단위 스테이징** | 공백 ① — 데일리 드라이버 전환의 관문 | 에픽 |
| 4 | `settings.rs` unwrap 제거 + GitEngine 트레이트 분리 | H4·M1 — panic 경로 제거 + 훅 우회 컴파일 타임 차단 | 반나절 |
| 5 | 미사용 의존성 정리 + CLAUDE.md 드리프트 수정 | M2·L4 | 1시간 |
| 6 | 커밋 그래프 → interactive rebase | 공백 ②③ | 에픽 |

## 결정 로그

- 분석은 4개 병렬 에이전트(Rust·프론트·프로세스·제품) 산출을 종합한 것으로, 각 발견은 원 보고서의 `파일:라인` 근거를 유지했다.
- 성능 항목(M3)은 정적 판단 — 실제 지연은 대형 리포 프로파일링으로 확증 필요(미확인).
- diff red/green 색상(L2 중 14건)은 업계 관례로 보아 위반이 아닌 개선 여지로 분류했다.

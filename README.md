<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="GitBaro" width="120" height="120" />

# GitBaro

### 코딩 에이전트가 바꾼 것을 검토하는 macOS Git 클라이언트

여러 저장소와 워크트리에서 에이전트가 무엇을 바꿨는지 한곳에서 보고 검토합니다.
저장소마다 GitHub 계정을 지정해 두고, 그 계정으로만 GitHub에 접근합니다.

<br />

[![Platform](https://img.shields.io/badge/platform-macOS-black?logo=apple)](https://www.apple.com/macos/)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-GPLv3-blue)](#라이선스)

[시작하기](#시작하기) · [기능](#기능) · [스크린샷](#스크린샷) · [개발](#개발) · [아키텍처](#아키텍처)

</div>

---

## 왜 GitBaro인가

코딩 에이전트에게 일을 맡기면 저장소 여러 개, 워크트리 여러 개에서 커밋이 동시에 쌓입니다. 사람이 할 일은 git 명령을 치는 것보다 그 결과를 검토하는 쪽으로 옮겨 갑니다. GitBaro는 이 검토를 위한 앱입니다. 어느 저장소·워크트리에서 무엇이 바뀌고 있는지, 아직 원격에 올리지 않은 커밋이 무엇인지, 기준 브랜치와 비교해 어떤 파일이 바뀌었는지를 한 화면에서 봅니다.

검토 기준은 **원격에 없는 커밋**입니다. 추적 브랜치가 없는 브랜치도 셉니다. 원격에 올라간 커밋은 이미 공유된 것으로 보고 검토 대상에서 뺍니다.

저장소마다 GitHub 계정을 지정합니다. 회사 저장소에 개인 계정으로 커밋을 남기거나 개인 프로젝트에 회사 이메일이 찍히는 일을 막습니다. 저장소를 열면 그 계정으로 fetch·push와 GitHub API 호출이 나갑니다.

GitHub 웹에서 쉽게 할 수 있는 일(PR 작성·리뷰, 이슈 관리)은 앱에 넣지 않습니다. PR 탭은 읽기 전용입니다.

## 기능

| 영역 | 내용 |
|---|---|
| **사이드바** | 계정 › 워크스페이스 › 저장소 › 워크트리 순의 트리. 워크스페이스는 앱 안에서만 쓰는 저장소 묶음. 지금 파일이 바뀌는 곳을 표시하고, 조용한 저장소는 접음 |
| **커밋 그래프** | 워크트리마다 레인과 색을 나눠 그림. 원격에 없는 커밋 표시. 체크아웃하지 않고 다른 브랜치 보기 |
| **기준 대비 변경** | 기준 브랜치(저장소 설정에서 지정)와 비교해 바뀐 파일 목록. 파일마다 「봤음」 표시, 진행률 |
| **워크스페이스 검토** | 워크스페이스에 속한 저장소들의 커밋을 한 타임라인으로. 여러 저장소 fetch·pull·push를 한 번에 확인하고 실행 |
| **따라가기** | 에이전트가 파일을 고치는 동안 가장 최근에 고친 파일과 방금 바뀐 줄을 따라가며 보여 줌 |
| **Diff** | 텍스트 diff, 마크다운 diff, 이미지 diff(swipe · onion · two-up). diff 안에서 찾기, 편집기에서 해당 줄 열기 |
| **워크트리** | 추가·삭제, 기반 브랜치 표시, 같은 파일을 고치는 워크트리 표시 |
| **커밋·브랜치** | 스테이지·커밋·되돌리기, 브랜치 생성·전환·이름 변경·삭제·병합, 커밋 단위 checkout·revert·cherry-pick·reset, stash, 병합 충돌 처리 |
| **GitHub** | 읽기 전용 PR 탭(목록·상세·바뀐 파일), Actions 실행·잡 조회 |
| **알림** | 새 커밋과 CI 실패를 macOS 알림으로. 알림을 누르면 해당 저장소·브랜치로 이동 |
| **저장소 설정** | 표시 이름(화면에만 쓰임), 계정, 자동 최신화(끔·확인만·안전할 때 받기)와 주기, 비교 기준, 알림 |
| **앱 설정** | 일반, 모양(라이트·다크·시스템 테마), 외부 도구(편집기·터미널·AI CLI 자동 감지), 계정, 알림, 정보(설정 파일 위치, git·gh 경로와 버전) |
| **기타** | 우클릭 메뉴, 파일 변경 실시간 반영, 한국어·영어 |

## 스크린샷

> 아직 스크린샷이 없습니다.

## 시작하기

### 빠른 설치

한 줄로 저장소를 clone 하고 앱을 빌드해 `/Applications` 에 설치합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/yjun1806/GitBaro/main/install.sh | bash
```

> 사전 빌드 바이너리가 아니라 **소스에서 직접 빌드**하므로 아래 사전 요구 사항(Rust · pnpm · gh)이 필요합니다.
> Rust 첫 컴파일은 수 분 걸릴 수 있습니다. 완료 후 `open -a GitBaro` 로 실행하세요.

빌드 캐시는 `~/Library/Caches/gitbaro-build` 에 남습니다(1GB 이상). 다음 업데이트를 수 분에서
수십 초로 줄여 주므로 그대로 두길 권하지만, 공간이 필요하면 지워도 됩니다.

```bash
rm -rf ~/Library/Caches/gitbaro-build
```

### 사전 요구 사항

| 도구 | 버전 |
|---|---|
| [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/) | pnpm `10.27` |
| [Rust](https://www.rust-lang.org/tools/install) | edition 2021 |
| [Git](https://git-scm.com/) | 시스템에 설치된 `git` |
| [GitHub CLI (`gh`)](https://cli.github.com/) | `≥ 2.40` |
| macOS | `10.15` 이상 |

### 수동 설치 & 실행

```bash
# 1. 의존성 설치
pnpm install

# 2. 개발 모드 실행 (핫 리로드)
pnpm tauri dev

# 3. 프로덕션 앱 번들 빌드 (.app)
pnpm tauri build
```

## 개발

```bash
# ── Frontend ──────────────────────────────
pnpm dev              # Vite 개발 서버 (포트 1420)
pnpm build            # tsc + vite build
pnpm lint             # ESLint 9 (eslint.config.js)
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (프런트엔드만)

# ── Rust (src-tauri/) ─────────────────────
cargo check           # 타입 체크
cargo clippy          # 린트
cargo test            # Rust 테스트
cargo build           # 빌드
```

커밋할 때 pre-commit hook이 `pnpm typecheck && pnpm lint`를 돌립니다. 테스트는 돌리지 않으므로 push 전에 `pnpm test`(Rust를 고쳤다면 `cargo test`도)를 직접 돌리세요.

## 아키텍처

GitBaro의 핵심은 **작업 유형에 따라 Git 엔진을 나누는 하이브리드 전략**입니다.

| 작업 유형 | 엔진 | 이유 |
|---|---|---|
| 읽기 전용 (diff, log, 브랜치 목록) | `git2` (libgit2) | 성능 — hook이 필요 없음 |
| 작업 트리 상태 (status) | `git status --porcelain=v2` | libgit2 status는 git과 결과가 달라지는 경우가 있음 |
| 쓰기 + hook (commit, checkout, merge) | `git` CLI | `.git/hooks/` 스크립트 실행 필요 |
| 원격 (fetch, push, pull, clone) | `git` CLI + `GIT_ASKPASS` | 안전한 크레덴셜 주입 (토큰이 프로세스 인자에 노출되지 않음) |

> libgit2는 `.git/hooks/`를 실행하지 않으므로, hook이 필요한 작업에는 **절대** libgit2를 쓰지 않습니다.
> 참조 구현: [GitHub Desktop](https://github.com/desktop/desktop).

<details>
<summary><strong>프로젝트 구조 펼쳐보기</strong></summary>

```
GitBaro/
├── src/                  # React 프론트엔드
│   ├── components/       # 도메인별 UI (sidebar, graph, review, live, diff, pr, settings, ...)
│   ├── stores/           # Zustand 스토어
│   ├── hooks/            # 공용 훅 (감시, 알림, 자동 최신화, ...)
│   ├── api/              # Tauri invoke 래퍼, 이벤트 이름, React Query
│   ├── types/            # 공유 TypeScript 타입
│   ├── lib/              # 유틸리티 (theme, file-status, fuzzy-search, ...)
│   └── i18n/             # i18next 설정 & 번역 (en, ko)
├── src-tauri/            # Rust 백엔드
│   └── src/
│       ├── git/          # Git 작업 — 하이브리드 (cli.rs · libgit.rs)
│       ├── commands/     # Tauri 커맨드 핸들러
│       ├── github/       # GitHub REST API 클라이언트
│       ├── gh/           # GitHub CLI 연동
│       ├── state/        # 앱 상태 & 토큰 저장소
│       └── watcher/      # 파일 시스템 감시 (활성 저장소, 여러 저장소 활동)
└── AGENTS.md             # 아키텍처 & 컨벤션 상세 (CLAUDE.md가 이 파일을 불러옴)
```

</details>

**기술 스택** · React 19 · TypeScript · TailwindCSS 4 · Tauri 2 · Rust · git2 · Zustand 5 · TanStack Query 5 · Vite 6 · i18next

## 기여

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다. commitlint + Husky가 검사합니다. 코드 규칙은 [AGENTS.md](AGENTS.md)에 있습니다.

```
feat(branch): add branch comparison view
fix(diff): handle binary file detection for SVG
refactor(git): extract stash helpers into module
```

타입: `feat` · `fix` · `refactor` · `docs` · `test` · `chore` · `perf` · `ci`

## 라이선스

[GNU General Public License v3.0](LICENSE) — 파생물도 소스를 공개해야 하는 copyleft 라이선스입니다.

---

<div align="center">
<sub>Rust · React · <a href="https://tauri.app/">Tauri</a></sub>
</div>

<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="GitBaro" width="120" height="120" />

# GitBaro

### 멀티 계정을 관리하는 macOS Git GUI 클라이언트

저장소마다 GitHub 계정을 지정해 두고 쓰는 네이티브 Git 클라이언트.
복잡한 명령어 외울 것 없이, 이름 그대로 **바로** 쓸 수 있게.

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

GitHub Desktop은 가볍고 편하지만, 저장소마다 다른 계정을 쓸 수 없습니다. 여러 GitHub 계정을 오가며 일하는 사람에게는 매번 걸리는 지점입니다. GitBaro는 이 공백을 메우는 데서 출발했습니다.

회사 저장소에 개인 계정으로 커밋을 남기거나, 개인 프로젝트에 회사 이메일이 찍히거나 — 전역 `user.email` 하나로 버티다 보면 한 번은 겪는 일입니다. GitBaro는 저장소마다 계정을 지정해 둡니다. 저장소를 열면 그 계정으로 커밋·푸시·PR이 나가고, 다른 계정이 끼어들 여지가 없습니다.

워크트리도 GUI에서 다룹니다. 추가·삭제는 물론, 만들기 전에 결과를 미리 볼 수 있습니다.

엔진은 둘로 나눠 씁니다. 조회는 libgit2로 빠르게, 커밋·병합처럼 hook과 인증이 걸린 작업은 Git CLI로. 속도와 정확성을 모두 챙기면서 로컬 Git 설정을 건드리지 않습니다.

이름의 '바로'는 CLI 명령어를 외우지 않아도 GUI로 바로 쓸 수 있다는 뜻에서 붙였습니다.

## 기능

| 영역 | 내용 |
|---|---|
| **계정** | 저장소마다 GitHub 계정을 지정해 커밋·푸시·PR에 자동 적용. `gh` CLI 인증 연동 |
| **브랜치** | 생성·전환·삭제·이름 변경, 브랜치 간 비교와 병합 |
| **커밋** | 스테이지/언스테이지, 커밋, 변경 되돌리기, `.gitignore` 추가 |
| **히스토리** | 무한 스크롤 커밋 로그, 상세 보기, 커밋 단위 checkout·revert·cherry-pick·reset |
| **충돌** | 병합 충돌 감지, 파일별 충돌 diff, 병합·리베이스 계속/중단 |
| **Stash** | 저장·적용·pop·삭제, 일부 파일만 stash |
| **Diff** | 텍스트 diff와 이미지 diff (swipe · onion · two-up) |
| **원격** | fetch · push · pull · clone(URL 검증), 저장소별 동기화 상태 표시 |
| **Worktree** | 워크트리 추가·삭제, 생성 전 미리보기 |
| **GitHub** | PR 상태 배지, Actions 워크플로 실행·잡 조회 |
| **외부 도구** | 저장소를 에디터·터미널·AI CLI로 바로 열기(설치 도구 자동 감지), Finder에서 보기 |
| **기타** | 파일 변경 실시간 반영, 라이트·다크·시스템 테마, 한국어·영어 |

## 스크린샷

> _스크린샷 추가 예정_
>
> `docs/` 디렉터리에 이미지를 넣고 아래처럼 링크하세요.
>
> ```markdown
> ![GitBaro 메인 화면](docs/screenshot-main.png)
> ```

## 시작하기

### 빠른 설치

한 줄로 저장소를 clone 하고 앱을 빌드해 `/Applications` 에 설치합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/yjun1806/GitBaro/main/install.sh | bash
```

> 사전 빌드 바이너리가 아니라 **소스에서 직접 빌드**하므로 아래 사전 요구 사항(Rust · pnpm · gh)이 필요합니다.
> Rust 첫 컴파일은 수 분 걸릴 수 있습니다. 완료 후 `open -a GitBaro` 로 실행하세요.

### 사전 요구 사항

| 도구 | 버전 |
|---|---|
| [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/) | pnpm `10.27` |
| [Rust](https://www.rust-lang.org/tools/install) | edition 2021 |
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
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run

# ── Rust (src-tauri/) ─────────────────────
cargo check           # 타입 체크
cargo clippy          # 린트
cargo build           # 빌드
```

## 아키텍처

GitBaro의 핵심은 **작업 유형에 따라 Git 엔진을 나누는 하이브리드 전략**입니다.

| 작업 유형 | 엔진 | 이유 |
|---|---|---|
| 읽기 전용 (status, diff, log, blame) | `git2` (libgit2) | 성능 — hook이 필요 없음 |
| 쓰기 + hook (commit, checkout, merge) | `git` CLI | `.git/hooks/` 스크립트 실행 필요 |
| 원격 (fetch, push, pull, clone) | `git` CLI + `GIT_ASKPASS` | 안전한 크레덴셜 주입 (토큰이 프로세스 인자에 노출되지 않음) |

> libgit2는 `.git/hooks/`를 실행하지 않으므로, hook이 필요한 작업에는 **절대** libgit2를 쓰지 않습니다.
> 참조 구현: [GitHub Desktop](https://github.com/desktop/desktop).

<details>
<summary><strong>프로젝트 구조 펼쳐보기</strong></summary>

```
GitBaro/
├── src/                  # React 프론트엔드
│   ├── components/       # 도메인별 UI (account, branch, commit, diff, history, ...)
│   ├── stores/           # Zustand 스토어
│   ├── api/              # Tauri invoke 래퍼 & React Query
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
│       └── watcher/      # 파일 시스템 감시
└── CLAUDE.md             # 아키텍처 & 컨벤션 상세
```

</details>

**기술 스택** · React 19 · TypeScript · TailwindCSS 4 · Tauri 2 · Rust · git2 · Zustand 5 · TanStack Query 5 · Vite 6 · i18next

## 기여

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다. commitlint + Husky가 검사합니다.

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

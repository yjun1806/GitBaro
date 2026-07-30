#!/usr/bin/env bash
#
# GitBaro 빠른 설치 스크립트
#
#   curl -fsSL https://raw.githubusercontent.com/yjun1806/GitBaro/main/install.sh | bash
#
# 저장소를 clone 하고, 앱 번들을 빌드해 /Applications 에 설치합니다.
# 사전 빌드 바이너리가 아니라 소스에서 직접 빌드하므로 Rust·pnpm·gh 가 필요합니다.

set -euo pipefail

REPO_URL="https://github.com/yjun1806/GitBaro.git"
APP_NAME="GitBaro.app"
INSTALL_DIR="/Applications"
# 빌드 캐시는 $TMPDIR 에 두지 않는다. macOS 는 $TMPDIR 안에서 오래 접근되지 않은
# 파일을 주기적으로 지우는데(110.clean-tmps), 며칠 만에 업데이트하면 clone 과
# Rust target 캐시가 반쯤 지워진 상태로 남아 빌드가 깨진다.
# 이름은 앱 캐시와 겹치지 않게 둔다. macOS 파일시스템은 기본이 대소문자 구분 없음이라
# `GitBaro/` 는 앱이 쓰는 `gitbaro/`(WKWebView 캐시)와 같은 디렉토리가 되어,
# 앱 캐시를 비우면 빌드 캐시까지 사라진다.
# $HOME 유효성은 아래 "환경 확인" 에서 검사한다. set -u 때문에 여기서 곧바로
# 죽으면 원인을 알 수 없는 unbound variable 메시지만 남는다.
BUILD_DIR="${HOME:-}/Library/Caches/gitbaro-build"
# 로그는 한 번 보고 버리는 것이라 tmp 로 충분하다.
LOG_FILE="${TMPDIR:-/tmp}/gitbaro-install.log"
TOTAL_STEPS=4

# ── 색상 ─────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_CYN=$'\033[36m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_DIM=; C_RED=; C_GRN=; C_YEL=; C_CYN=; C_BLD=; C_RST=
fi

# ── 출력 헬퍼 ────────────────────────────────────────────
step_no=0
step()  { step_no=$((step_no + 1)); printf '\n%s[%d/%d]%s %s%s%s\n' \
            "$C_DIM" "$step_no" "$TOTAL_STEPS" "$C_RST" "$C_BLD" "$1" "$C_RST"; }
info()  { printf '  %s·%s %s\n' "$C_DIM" "$C_RST" "$1"; }
ok()    { printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$1"; }
warn()  { printf '  %s!%s %s\n' "$C_YEL" "$C_RST" "$1"; }
fail()  { printf '\n%s✗ %s%s\n' "$C_RED" "$1" "$C_RST" >&2; exit 1; }

banner() {
  printf '\n'
  printf '  %s%s███████%s  %sGitBaro%s\n'   "$C_BLD" "$C_CYN" "$C_RST" "$C_BLD" "$C_RST"
  printf '  %s%s██%s        %sGit GUI for macOS%s\n' "$C_BLD" "$C_CYN" "$C_RST" "$C_DIM" "$C_RST"
  printf '  %s%s███████%s  %s빠른 설치%s\n'  "$C_BLD" "$C_CYN" "$C_RST" "$C_DIM" "$C_RST"
  printf '  %s─────────────────────────────%s\n' "$C_DIM" "$C_RST"
}

# 오래 걸리는 명령을 스피너로 감싸 실행. 출력은 로그 파일로, 실패 시에만 꼬리를 보여준다.
run() {
  local msg="$1"; shift
  if [ ! -t 1 ]; then
    info "$msg ..."
    "$@" >"$LOG_FILE" 2>&1 || { tail -n 30 "$LOG_FILE" >&2; fail "$msg 실패 (로그: $LOG_FILE)"; }
    ok "$msg"
    return
  fi
  local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
  "$@" >"$LOG_FILE" 2>&1 &
  local pid=$! i=0 start=$SECONDS rc=0
  while kill -0 "$pid" 2>/dev/null; do
    printf '\r  %s%s%s %s %s(%ds)%s' \
      "$C_CYN" "${frames[i++ % ${#frames[@]}]}" "$C_RST" "$msg" "$C_DIM" "$((SECONDS - start))" "$C_RST"
    sleep 0.1
  done
  if wait "$pid"; then rc=0; else rc=$?; fi
  if [ "$rc" -eq 0 ]; then
    printf '\r  %s✓%s %s %s(%ds)%s\033[K\n' "$C_GRN" "$C_RST" "$msg" "$C_DIM" "$((SECONDS - start))" "$C_RST"
  else
    printf '\r  %s✗%s %s\033[K\n' "$C_RED" "$C_RST" "$msg"
    warn "마지막 로그 (전체: $LOG_FILE):"
    tail -n 30 "$LOG_FILE" | sed "s/^/    $C_DIM/;s/\$/$C_RST/" >&2
    exit "$rc"
  fi
}

# package.json 에서 버전 추출 (jq 없이 이식성 있게)
read_version() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }
# 이미 설치된 앱 번들의 버전 (없으면 빈 문자열)
installed_version() {
  /usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' \
    "$INSTALL_DIR/$APP_NAME/Contents/Info.plist" 2>/dev/null || true
}

# $BUILD_DIR 자체가 저장소 루트인지 확인한다.
#
# `[ -d "$BUILD_DIR/.git" ]` 로는 부족하다 — 캐시가 반쯤 지워져 .git/HEAD 만 사라진
# 껍데기가 남으면 검사는 통과하고 git 이 실패한다.
# 반대로 `git rev-parse --git-dir` 만으로도 안 된다 — 상위 디렉토리까지 거슬러 올라가서
# 찾기 때문에, 홈을 git 으로 관리하는 사용자에게는 그 저장소를 잡아 아래 fetch 와
# reset --hard 가 홈 작업 트리를 날려버린다.
# 그래서 "저장소 루트가 정확히 여기인지" 를 본다. 애매하면 재clone 쪽이 안전하다.
is_build_repo() {
  [ "$(git -C "$BUILD_DIR" rev-parse --absolute-git-dir 2>/dev/null)" \
    = "$(cd "$BUILD_DIR" 2>/dev/null && pwd -P)/.git" ]
}

banner

# ── 1. 환경 확인 ─────────────────────────────────────────
step "환경 확인"
[ "$(uname)" = "Darwin" ] || fail "GitBaro 는 macOS 전용입니다."
[ -n "${HOME:-}" ] || fail "\$HOME 이 비어 있어 빌드 캐시 위치를 정할 수 없습니다."

PREV_VERSION="$(installed_version)"

HAS_BREW=false; command -v brew >/dev/null 2>&1 && HAS_BREW=true

# 누락 도구를 이름 + 설치 명령과 함께 수집 (자동 설치는 하지 않음 — 안내만)
missing_name=(); missing_cmd=()
need() {  # $1=확인할 명령, $2=표시 이름, $3=설치 명령/안내
  command -v "$1" >/dev/null 2>&1 || { missing_name+=("$2"); missing_cmd+=("$3"); }
}
need git   "git"   "xcode-select --install"
need cargo "Rust"  "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
if $HAS_BREW; then
  need gh "GitHub CLI (gh)" "brew install gh"
else
  need gh "GitHub CLI (gh)" "https://cli.github.com 참고"
fi

# pnpm 은 corepack 으로 자동 활성화 시도 후에도 없으면 안내
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    info "corepack 으로 pnpm 을 활성화합니다."
    corepack enable >/dev/null 2>&1 || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    missing_name+=("pnpm"); missing_cmd+=("npm install -g pnpm  (또는 corepack enable)")
  fi
fi

if [ ${#missing_name[@]} -gt 0 ]; then
  warn "먼저 아래 도구를 설치한 뒤 다시 실행하세요:"
  for i in "${!missing_name[@]}"; do
    printf '     %s%s%s\n'   "$C_BLD" "${missing_name[i]}" "$C_RST"
    printf '       %s$ %s%s\n' "$C_DIM" "${missing_cmd[i]}" "$C_RST"
  done
  fail "필수 도구가 없어 중단합니다."
fi
ok "git · cargo · pnpm · gh 확인 완료"
[ -n "$PREV_VERSION" ] && info "이미 설치됨: GitBaro $PREV_VERSION (업데이트로 진행)"

# ── 2. 저장소 준비 ───────────────────────────────────────
step "저장소 준비"
if is_build_repo; then
  run "기존 소스 갱신" bash -c \
    "git -C '$BUILD_DIR' fetch --depth 1 origin main && git -C '$BUILD_DIR' reset --hard origin/main"
else
  rm -rf "${BUILD_DIR:?}"
  run "저장소 clone" git clone --depth 1 "$REPO_URL" "$BUILD_DIR"
fi
cd "$BUILD_DIR"

NEW_VERSION="$(read_version package.json)"
[ -n "$NEW_VERSION" ] && info "대상 버전: GitBaro $NEW_VERSION"

# ── 3. 빌드 ──────────────────────────────────────────────
step "빌드"
run "의존성 설치 (pnpm)" pnpm install --frozen-lockfile
info "Rust 첫 컴파일은 수 분 걸릴 수 있습니다."
run "앱 번들 빌드 (tauri)" pnpm tauri build --bundles app

BUNDLED="src-tauri/target/release/bundle/macos/$APP_NAME"
[ -d "$BUNDLED" ] || fail "빌드 결과를 찾을 수 없습니다: $BUNDLED"

# ── 4. 설치 ──────────────────────────────────────────────
step "설치"
if [ -n "$PREV_VERSION" ]; then
  info "업데이트  $PREV_VERSION → ${NEW_VERSION:-?}"
else
  info "새 설치  ${NEW_VERSION:-?}"
fi
rm -rf "${INSTALL_DIR:?}/$APP_NAME"
ditto "$BUNDLED" "$INSTALL_DIR/$APP_NAME"
ok "$INSTALL_DIR/$APP_NAME"

# 빌드 캐시는 일부러 남긴다. 지우면 다음 업데이트가 전체 재컴파일(수 분)이 된다.
# 대신 어디에 얼마나 쌓였는지는 알려준다 — 말없이 GB 단위를 남기지 않는다.
info "빌드 캐시 $(du -sh "$BUILD_DIR" 2>/dev/null | cut -f1) — 다음 업데이트를 빠르게 합니다"
info "지우려면: ${C_BLD}rm -rf $BUILD_DIR${C_RST}"

done_label="설치 완료!"
[ -n "$PREV_VERSION" ] && done_label="업데이트 완료!"
printf '\n%s%s%s  GitBaro %s  ·  %sopen -a GitBaro%s 로 실행하세요.\n\n' \
  "$C_GRN$C_BLD" "$done_label" "$C_RST" "${NEW_VERSION:-}" "$C_BLD" "$C_RST"

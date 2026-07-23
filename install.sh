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
BUILD_DIR="${TMPDIR:-/tmp}/gitbaro-build"
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

banner

# ── 1. 환경 확인 ─────────────────────────────────────────
step "환경 확인"
[ "$(uname)" = "Darwin" ] || fail "GitBaro 는 macOS 전용입니다."

PREV_VERSION="$(installed_version)"

missing=()
check() { command -v "$1" >/dev/null 2>&1 || missing+=("$2"); }
check git   "git"
check cargo "Rust (https://www.rust-lang.org/tools/install)"
check gh    "GitHub CLI (https://cli.github.com)"

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    info "corepack 으로 pnpm 을 활성화합니다."
    corepack enable >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 || missing+=("pnpm (https://pnpm.io/installation)")
fi

if [ ${#missing[@]} -gt 0 ]; then
  warn "다음 도구를 먼저 설치해야 합니다:"
  for m in "${missing[@]}"; do printf '     - %s\n' "$m"; done
  fail "필수 도구가 없어 중단합니다."
fi
ok "git · cargo · pnpm · gh 확인 완료"
[ -n "$PREV_VERSION" ] && info "이미 설치됨: GitBaro $PREV_VERSION (업데이트로 진행)"

# ── 2. 저장소 준비 ───────────────────────────────────────
step "저장소 준비"
if [ -d "$BUILD_DIR/.git" ]; then
  run "기존 소스 갱신" bash -c \
    "git -C '$BUILD_DIR' fetch --depth 1 origin main && git -C '$BUILD_DIR' reset --hard origin/main"
else
  rm -rf "$BUILD_DIR"
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

done_label="설치 완료!"
[ -n "$PREV_VERSION" ] && done_label="업데이트 완료!"
printf '\n%s%s%s  GitBaro %s  ·  %sopen -a GitBaro%s 로 실행하세요.\n\n' \
  "$C_GRN$C_BLD" "$done_label" "$C_RST" "${NEW_VERSION:-}" "$C_BLD" "$C_RST"

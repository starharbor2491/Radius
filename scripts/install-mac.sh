#!/bin/bash
#
# Radius installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/starharbor2491/Radius/main/scripts/install-mac.sh | bash
#
# Set RADIUS_BRANCH to build from a branch other than the default.
#
# Installs Radius.app into /Applications and opens it.
#
# Two paths, tried in order:
#   1. Download a published release for this Mac's architecture. Seconds.
#   2. Build from source. Slower, but needs nothing installed beforehand --
#      Node is fetched into a temp directory and thrown away afterwards.
#
# No sudo unless /Applications turns out not to be writable, in which case the
# script asks for it once and says why.
#
# ---------------------------------------------------------------------------
# THIS FILE MUST STAY PURE ASCII, AND EVERY EXPANSION MUST BE BRACED.
#
# macOS ships bash 3.2, which decides whether a character can be part of a
# variable name by calling isalnum() on one byte at a time. In a non-UTF-8
# locale the leading byte of a character like an ellipsis passes that test, so
# `"$INSTALL_DIR..."` written with a real ellipsis parses as a variable named
# INSTALL_DIR plus that byte -- which is unset, and under `set -u` aborts the
# install. That is not hypothetical; it shipped and it broke.
#
# tests/install-script.test.ts enforces both rules.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO="${RADIUS_REPO:-starharbor2491/Radius}"
# Falls back to main if this branch is gone -- the source branch gets deleted
# once it merges, and an installer that breaks on merge day is no installer.
BRANCH="${RADIUS_BRANCH:-claude/ai-productivity-browser-plan-fuijdl}"
FALLBACK_BRANCH="main"
NODE_VERSION="${RADIUS_NODE_VERSION:-22.22.2}"
APP_NAME="Radius.app"
INSTALL_DIR="${RADIUS_INSTALL_DIR:-/Applications}"

# ---------------------------------------------------------------- output ---

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""
fi

step() { printf '%s==>%s %s\n' "${BOLD}" "${RESET}" "$1"; }
info() { printf '    %s%s%s\n' "${DIM}" "$1" "${RESET}"; }
warn() { printf '    %s%s%s\n' "${RED}" "$1" "${RESET}"; }
die() {
  printf '\n%serror:%s %s\n\n' "${RED}" "${RESET}" "$1" >&2
  exit 1
}

# ----------------------------------------------------------------- checks ---

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS. You are on $(uname -s)."

case "$(uname -m)" in
  arm64)  ARCH="arm64";  NODE_ARCH="arm64" ;;
  x86_64) ARCH="x64";    NODE_ARCH="x64"   ;;
  *)      die "Unsupported architecture: $(uname -m)" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required but not installed."

# Electron 43 sets LSMinimumSystemVersion to 12.0, so anything older cannot
# launch the app even if the install succeeds.
MACOS_VERSION="$(sw_vers -productVersion)"
MACOS_MAJOR="$(printf '%s' "${MACOS_VERSION}" | cut -d. -f1)"
if [ "${MACOS_MAJOR}" -lt 12 ] 2>/dev/null; then
  die "Radius needs macOS 12 (Monterey) or newer. You are on ${MACOS_VERSION}."
fi

printf '\n%sRadius%s - installing for macOS %s (%s)\n\n' \
  "${BOLD}" "${RESET}" "${MACOS_VERSION}" "${ARCH}"

# An explicit template rather than `mktemp -d -t prefix`: the -t form is BSD
# syntax that GNU mktemp rejects, and this way the script can be exercised on
# Linux without mocking mktemp.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/radius-install.XXXXXXXX")"
cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT

BUILT_APP=""

# ------------------------------------------------------ path 1: download ---

try_download() {
  step "Looking for a published build..."

  local api="https://api.github.com/repos/${REPO}/releases/latest"
  local json
  if ! json="$(curl -fsSL --max-time 30 "${api}" 2>/dev/null)"; then
    info "No published release yet."
    return 1
  fi

  # Match this Mac's architecture. Pick the zip: it needs no mounting, and a
  # dmg would only add a step for the same payload.
  local url
  url="$(printf '%s' "${json}" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | cut -d'"' -f4 \
    | grep -i -- "-${ARCH}" \
    | grep -i '\.zip$' \
    | head -n 1 || true)"

  if [ -z "${url}" ]; then
    info "No ${ARCH} build attached to the latest release."
    return 1
  fi

  info "Downloading $(basename "${url}")"
  curl -fsSL --max-time 900 -o "${WORK_DIR}/radius.zip" "${url}" || return 1

  mkdir -p "${WORK_DIR}/unpacked"
  ditto -x -k "${WORK_DIR}/radius.zip" "${WORK_DIR}/unpacked" || return 1

  BUILT_APP="$(find "${WORK_DIR}/unpacked" -maxdepth 2 -name "${APP_NAME}" -print -quit)"
  [ -n "${BUILT_APP}" ] || return 1

  # Anything downloaded carries a quarantine flag, and Radius is not notarised,
  # so Gatekeeper would refuse to open it. Clearing the flag is what the
  # right-click-Open dance does, minus the dance.
  xattr -dr com.apple.quarantine "${BUILT_APP}" 2>/dev/null || true
  return 0
}

# --------------------------------------------------------- path 2: build ---

ensure_node() {
  # An installed Node 20+ is fine; anything older or missing gets a private
  # copy in the temp directory, which keeps the machine untouched.
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "${major}" -ge 20 ] 2>/dev/null; then
      info "Using your Node $(node -v)"
      return 0
    fi
    info "Your Node $(node -v) is too old; fetching a newer one just for this build."
  else
    info "Node is not installed; fetching a copy just for this build."
  fi

  local tarball="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"

  curl -fsSL --max-time 900 -o "${WORK_DIR}/${tarball}" "${url}" \
    || die "Could not download Node from nodejs.org. Check your connection."
  tar -xzf "${WORK_DIR}/${tarball}" -C "${WORK_DIR}" \
    || die "Could not unpack the Node download."

  export PATH="${WORK_DIR}/node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin:${PATH}"
  info "Using Node $(node -v) (temporary)"
}

fetch_one_branch() {
  local branch="$1"

  if command -v git >/dev/null 2>&1; then
    if git clone --depth 1 --branch "${branch}" "https://github.com/${REPO}.git" \
         "${WORK_DIR}/src" >/dev/null 2>&1; then
      return 0
    fi
    rm -rf "${WORK_DIR}/src"
  fi

  # No git, or the clone failed: a tarball needs nothing but curl.
  if curl -fsSL --max-time 900 -o "${WORK_DIR}/src.tar.gz" \
       "https://codeload.github.com/${REPO}/tar.gz/refs/heads/${branch}" 2>/dev/null; then
    mkdir -p "${WORK_DIR}/src"
    if tar -xzf "${WORK_DIR}/src.tar.gz" -C "${WORK_DIR}/src" --strip-components 1 2>/dev/null; then
      return 0
    fi
    rm -rf "${WORK_DIR}/src"
  fi

  return 1
}

fetch_source() {
  if fetch_one_branch "${BRANCH}"; then
    info "Source: ${BRANCH}"
    return 0
  fi

  if [ "${BRANCH}" != "${FALLBACK_BRANCH}" ] && fetch_one_branch "${FALLBACK_BRANCH}"; then
    info "Branch '${BRANCH}' is gone; used '${FALLBACK_BRANCH}' instead."
    return 0
  fi

  die "Could not download the Radius source from ${REPO}."
}

try_build() {
  step "Building Radius from source..."
  info "This takes a few minutes and downloads about 400 MB. Nothing is installed system-wide."

  ensure_node
  fetch_source
  cd "${WORK_DIR}/src"

  # Build output goes to a log rather than the screen, so a failure can show
  # the tail of it instead of just saying "it failed".
  local log="${WORK_DIR}/build.log"

  info "Installing dependencies..."
  if ! { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } >"${log}" 2>&1; then
    tail -n 20 "${log}" >&2
    die "Installing dependencies failed. The last 20 lines are above."
  fi

  info "Compiling..."
  if ! npx electron-vite build >"${log}" 2>&1; then
    tail -n 20 "${log}" >&2
    die "The build step failed. The last 20 lines are above."
  fi

  info "Packaging the app..."
  if ! npx electron-builder --mac dir "--${ARCH}" --publish never >"${log}" 2>&1; then
    tail -n 20 "${log}" >&2
    die "Packaging failed. The last 20 lines are above."
  fi

  BUILT_APP="$(find "${WORK_DIR}/src/release" -maxdepth 2 -name "${APP_NAME}" -print -quit)"
  [ -n "${BUILT_APP}" ] || die "The build finished but produced no ${APP_NAME}."
}

# --------------------------------------------------------------- install ---

install_app() {
  local target="${INSTALL_DIR}/${APP_NAME}"

  # Apple Silicon refuses to run any unsigned executable. Radius has no paid
  # Apple identity, so it gets an ad-hoc signature -- enough for macOS to load
  # it, not enough to claim it came from an identified developer.
  step "Signing locally..."
  codesign --force --deep --sign - "${BUILT_APP}" >/dev/null 2>&1 \
    || warn "Ad-hoc signing failed; the app may refuse to open."

  step "Installing to ${INSTALL_DIR}"

  local sudo_prefix=""
  if [ ! -w "${INSTALL_DIR}" ]; then
    warn "${INSTALL_DIR} is not writable by your account, so this needs your password."
    sudo_prefix="sudo"
  fi

  if [ -e "${target}" ]; then
    info "Replacing the existing install."
    ${sudo_prefix} rm -rf "${target}" \
      || die "Could not remove the old ${APP_NAME}. Is Radius running?"
  fi

  ${sudo_prefix} cp -R "${BUILT_APP}" "${target}" \
    || die "Could not copy Radius into ${INSTALL_DIR}."
  ${sudo_prefix} xattr -dr com.apple.quarantine "${target}" 2>/dev/null || true

  printf '\n%sInstalled:%s %s\n\n' "${GREEN}" "${RESET}" "${target}"
}

# ------------------------------------------------------------------ main ---

main() {
  if ! try_download; then
    try_build
  fi

  install_app

  step "Opening Radius..."
  open "${INSTALL_DIR}/${APP_NAME}" || info "Open it yourself from your Applications folder."

  cat <<'NOTE'

    Radius is unsigned, so macOS may still ask you to confirm the first launch.
    If it refuses to open at all, right-click it in Applications and choose Open.

    To add an AI provider: open Settings (the gear), pick one from the list,
    paste a key. Ollama and LM Studio need no key at all.

NOTE
}

# Run unless sourced. Sourcing exposes the functions on their own, which is how
# scripts/test-install.sh exercises the install path without a Mac -- this file
# has broken on real hardware once, and static checks did not catch it.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main
fi

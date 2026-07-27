#!/bin/bash
#
# Exercises install-mac.sh's install path without a Mac.
#
# The installer shipped once with a bug that only appeared on real hardware:
# a Unicode ellipsis next to a variable expansion, which macOS's bash 3.2
# folded into the variable name and `set -u` then killed. `bash -n` passed it.
# Static rules now catch that specific shape, but rules only catch what someone
# thought to write down -- so this runs the real functions against stubbed
# macOS tools and checks what actually happened on disk.
#
#   bash scripts/test-install.sh
#
# What is genuinely covered: argument handling, the sudo decision, replacing an
# existing install, and that the app lands where it should. What is not: bash
# 3.2 itself, Gatekeeper, and whether the app launches.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/install-mac.sh"

PASS=0
FAIL=0

ok()   { printf '  ok    %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2', got '$1')"; fi; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/radius-install-test.XXXXXXXX")"
trap 'rm -rf "${SANDBOX}"' EXIT

# ------------------------------------------------------- stub macOS tools ---

STUB_BIN="${SANDBOX}/bin"
mkdir -p "${STUB_BIN}"

# Each stub records that it ran, so the test can assert on behaviour rather
# than just on the absence of an error.
make_stub() {
  local name="$1"
  shift
  cat > "${STUB_BIN}/${name}" <<STUB
#!/bin/bash
echo "${name} \$*" >> "${SANDBOX}/calls.log"
$*
exit 0
STUB
  chmod +x "${STUB_BIN}/${name}"
}

make_stub uname 'case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) echo Darwin ;; esac'
make_stub sw_vers 'echo 14.5.0'
make_stub codesign ''
make_stub xattr ''
make_stub ditto ''
make_stub open ''
# `sudo` runs the rest of the line, so the privileged branch is really tested.
make_stub sudo '"$@"'

export PATH="${STUB_BIN}:${PATH}"

# --------------------------------------------------------------- fixtures ---

make_fake_app() {
  local root="$1"
  mkdir -p "${root}/Radius.app/Contents/MacOS" "${root}/Radius.app/Contents/Resources"
  echo "binary" > "${root}/Radius.app/Contents/MacOS/Radius"
  echo "asar" > "${root}/Radius.app/Contents/Resources/app.asar"
}

# Sourcing runs the top-level guards (which the stubs satisfy) and defines the
# functions without running main.
# shellcheck disable=SC1090
load_installer() {
  RADIUS_INSTALL_DIR="$1" source "${INSTALLER}"
}

printf '\nRadius installer test\n---------------------\n'

# --------------------------------------------------- 1: clean install ---

(
  APPS="${SANDBOX}/Applications"
  mkdir -p "${APPS}"
  make_fake_app "${SANDBOX}/built"

  load_installer "${APPS}"
  BUILT_APP="${SANDBOX}/built/Radius.app"
  install_app >/dev/null 2>&1

  [ -f "${APPS}/Radius.app/Contents/MacOS/Radius" ] && echo INSTALLED || echo MISSING
) > "${SANDBOX}/r1" 2>&1
check "$(tail -n 1 "${SANDBOX}/r1")" "INSTALLED" "installs the app into a writable directory"

grep -q '^codesign --force --deep --sign -' "${SANDBOX}/calls.log" \
  && ok "ad-hoc signs before installing" \
  || bad "ad-hoc signs before installing"

grep -q '^xattr -dr com.apple.quarantine' "${SANDBOX}/calls.log" \
  && ok "clears the quarantine flag" \
  || bad "clears the quarantine flag"

# ------------------------------------------------ 2: replaces an install ---

(
  APPS="${SANDBOX}/Applications2"
  mkdir -p "${APPS}/Radius.app/Contents/MacOS"
  echo "old" > "${APPS}/Radius.app/Contents/MacOS/Radius"
  echo "stale" > "${APPS}/Radius.app/LEFTOVER"
  make_fake_app "${SANDBOX}/built2"

  load_installer "${APPS}"
  BUILT_APP="${SANDBOX}/built2/Radius.app"
  install_app >/dev/null 2>&1

  # A stale file surviving means the old bundle was merged into rather than
  # replaced, which is how you get an app with mismatched halves.
  if [ -e "${APPS}/Radius.app/LEFTOVER" ]; then echo LEFTOVER; else
    cat "${APPS}/Radius.app/Contents/MacOS/Radius"
  fi
) > "${SANDBOX}/r2" 2>&1
check "$(tail -n 1 "${SANDBOX}/r2")" "binary" "replaces an existing install completely"

# ------------------------------------------- 3: read-only target -> sudo ---

# `test -w` is true for root regardless of mode bits, so as root this branch is
# genuinely unreachable and asserting on it would be testing nothing. Say that
# out loud rather than quietly passing.
: > "${SANDBOX}/calls.log"
(
  APPS="${SANDBOX}/ReadOnly"
  mkdir -p "${APPS}"
  chmod 555 "${APPS}"
  make_fake_app "${SANDBOX}/built3"

  load_installer "${APPS}"
  BUILT_APP="${SANDBOX}/built3/Radius.app"
  install_app >/dev/null 2>&1

  chmod 755 "${APPS}"
  [ -f "${APPS}/Radius.app/Contents/MacOS/Radius" ] && echo INSTALLED || echo MISSING
) > "${SANDBOX}/r3" 2>&1
check "$(tail -n 1 "${SANDBOX}/r3")" "INSTALLED" "installs into a directory it cannot write directly"

if [ "$(id -u)" -eq 0 ]; then
  printf '  skip  sudo fallback (running as root, so -w is always true)\n'
else
  grep -q '^sudo cp -R' "${SANDBOX}/calls.log" \
    && ok "uses sudo only for the privileged copy" \
    || bad "uses sudo only for the privileged copy"
fi

# ------------------------------------- 4: a path with spaces in it ---

(
  APPS="${SANDBOX}/App lications"
  mkdir -p "${APPS}"
  make_fake_app "${SANDBOX}/built 4"

  load_installer "${APPS}"
  BUILT_APP="${SANDBOX}/built 4/Radius.app"
  install_app >/dev/null 2>&1

  [ -f "${APPS}/Radius.app/Contents/MacOS/Radius" ] && echo INSTALLED || echo MISSING
) > "${SANDBOX}/r4" 2>&1
check "$(tail -n 1 "${SANDBOX}/r4")" "INSTALLED" "handles paths containing spaces"

# ------------------------------------------------ 5: guards still refuse ---

REFUSED="$(PATH="${PATH}" bash -c '
  printf "#!/bin/bash\necho Linux\n" > '"${STUB_BIN}"'/uname
  chmod +x '"${STUB_BIN}"'/uname
  bash '"${INSTALLER}"' 2>&1 | tail -n 2 | head -n 1
')"
case "${REFUSED}" in
  *"for macOS"*) ok "refuses to run on a non-Mac" ;;
  *) bad "refuses to run on a non-Mac (got: ${REFUSED})" ;;
esac

# -------------------------------------------------------------------------

printf '\n%d passed, %d failed\n\n' "${PASS}" "${FAIL}"
[ "${FAIL}" -eq 0 ]

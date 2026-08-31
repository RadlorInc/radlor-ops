#!/usr/bin/env bash
#
# Run the suite against a DELIBERATELY BROKEN tree, then put the tree back — unconditionally, on
# success, on failure, on Ctrl-C.
#
# A check that has not been watched failing on the state it exists for is not a check. That means
# breaking the code on purpose, often, which means the restore has to be something other than a
# habit: this exists because "remember to commit before you break things" failed exactly once, and
# a `git checkout -- src/` ate forty minutes of uncommitted work.
#
#   scripts/break-check.sh "<shell command that applies the break>" [playwright args…]
#
# e.g.
#   scripts/break-check.sh "perl -pi -e 's/const TOKEN_LIMIT = 10\b/const TOKEN_LIMIT = 10000/' \
#     src/app/api/notes/route.ts" e2e/rate-limit.spec.ts
#
# It refuses to run a break that changes nothing — a positive control on the control, because a
# no-op break produces a green run that looks exactly like a passing check.

set -uo pipefail
cd "$(dirname "$0")/.."

[ $# -ge 1 ] || { echo "usage: $0 \"<break command>\" [playwright args…]" >&2; exit 2; }
BREAK="$1"; shift

STASHED=0
restore() {
  local rc=$?
  # 1. Stash the BREAK away and drop it. This also removes any file the break created.
  if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    git stash push --include-untracked --quiet -m "break-check: the break (dropped)" && git stash drop --quiet
  fi
  # 2. Put your own work back.
  if [ "$STASHED" = 1 ]; then git stash pop --quiet; fi
  echo
  echo "--- tree after restore (must match what you started with) ---"
  git status --short
  git stash list | grep -q 'break-check' && echo "⚠️  a break-check stash survived — inspect 'git stash list'"
  exit $rc
}
trap restore EXIT INT TERM

# Park any uncommitted work so the break cannot be confused with it, and so the restore is a
# mechanical `git stash pop` rather than a judgement call about which hunks were yours.
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git stash push --include-untracked --quiet -m "break-check: your work"
  STASHED=1
  echo "· parked your uncommitted work in a stash"
fi

echo "· applying break: $BREAK"
eval "$BREAK"

# ⚠️ A break that edited nothing (a `sed` whose pattern stopped matching after a refactor) makes the
# whole run meaningless AND reports green. Fail loudly instead.
if git diff --quiet HEAD && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "✗ the break changed nothing — the pattern no longer matches. Nothing was tested." >&2
  exit 3
fi
echo "· broke:"; git --no-pager diff --stat HEAD

echo "· running: npx playwright test $*"
npx playwright test "$@"
RC=$?
echo
if [ $RC -eq 0 ]; then
  echo "✗ THE SUITE PASSED ON THE BROKEN STATE. The check does not bind — you have the mechanism wrong."
else
  echo "✓ red on the broken state, which is what makes the green meaningful."
fi
exit $RC

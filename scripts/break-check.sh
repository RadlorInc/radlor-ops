#!/usr/bin/env bash
#
# Run one spec against a DELIBERATELY BROKEN tree, prove the red is attributable to that spec's own
# assertion, and put the tree back — unconditionally, on success, on failure, on Ctrl-C.
#
#   scripts/break-check.sh <spec expected to go red> "<shell command that applies the break>" [playwright args…]
#
# e.g.
#   scripts/break-check.sh e2e/rate-limit.spec.ts \
#     "perl -pi -e 's/const TOKEN_LIMIT = 10\$/const TOKEN_LIMIT = 10000/' src/app/api/notes/route.ts"
#
# Two things it exists to stop, both of which look like a successful broken-state run:
#
#   1. THE RESTORE BEING A HABIT. "Commit before you break things" failed exactly once and a
#      `git checkout -- src/` ate forty minutes of uncommitted work. The trap below does it whether
#      or not anyone remembers.
#
#   2. ⚠️ RED FOR THE WRONG REASON. A break that stops the code compiling, or throws before the
#      assertion runs, turns EVERY spec red — and a script that accepts any red then certifies a
#      check that would also go red if you deleted a semicolon. That is green-for-the-wrong-reason
#      wearing the other hat, and it fails in the confident direction. `break-verdict.mjs` requires
#      the named spec to have failed on an `expect(...)`.
#
# Exit codes are about THE CHECK, not about playwright — 0 means "your check binds":
#   0  the named spec went red on its own assertion
#   1  the named spec passed on the broken state          → the check is decorative
#   2  usage
#   3  the break edited nothing (its pattern has drifted) → nothing was tested
#   4  the named spec went red, but not on an assertion   → red for the wrong reason
#   5  the run never reached the named spec               → nothing was tested

set -uo pipefail
cd "$(dirname "$0")/.."

[ $# -ge 2 ] || { echo "usage: $0 <spec expected to go red> \"<break command>\" [playwright args…]" >&2; exit 2; }
SPEC="$1"; shift
BREAK="$1"; shift
[ -f "$SPEC" ] || { echo "no such spec: $SPEC" >&2; exit 2; }

# ⚠️ THE VERDICT SCRIPT IS COPIED OUT OF THE TREE BEFORE ANYTHING IS STASHED.
# Found the hard way: `git stash --include-untracked` parked `break-verdict.mjs` (still untracked at
# the time) and the run died on MODULE_NOT_FOUND — the tool removed itself as part of doing its job.
# The same would happen to any untracked file the run needs. Copying it out makes that impossible
# regardless of what is or is not committed.
WORK="$(mktemp -d -t break-check)"
REPORT="$WORK/report.json"
cp scripts/break-verdict.mjs "$WORK/verdict.mjs"
STASHED=0

dirty() { ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; }

restore() {
  local rc=$?
  # 1. Stash the BREAK away and drop it — this also removes any file the break created.
  if dirty; then
    git stash push --include-untracked --quiet -m "break-check: the break (dropped)" && git stash drop --quiet
  fi
  # 2. Put your own work back.
  if [ "$STASHED" = 1 ]; then git stash pop --quiet; fi
  rm -rf "$WORK"
  echo
  echo "--- tree after restore (must match what you started with) ---"
  git status --short
  git stash list | grep -q 'break-check' && echo "⚠️  a break-check stash survived — inspect 'git stash list'"
  exit $rc
}
trap restore EXIT INT TERM

# Park any uncommitted work so the break cannot be confused with it, and so the restore is a
# mechanical `git stash pop` rather than a judgement call about which hunks were yours.
if dirty; then
  git stash push --include-untracked --quiet -m "break-check: your work"
  STASHED=1
  echo "· parked your uncommitted work in a stash"
fi

echo "· applying break: $BREAK"
eval "$BREAK"

# ⚠️ A break that edited nothing (a `perl -pi` whose pattern stopped matching after a refactor)
# makes the whole run meaningless AND reports green. Fail loudly instead.
if ! dirty; then
  echo "✗ the break changed nothing — the pattern no longer matches. Nothing was tested." >&2
  exit 3
fi
echo "· broke:"; git --no-pager diff --stat HEAD

echo "· running: npx playwright test $SPEC $*"
PLAYWRIGHT_JSON_OUTPUT_NAME="$REPORT" npx playwright test "$SPEC" "$@" --reporter=list,json
echo
node "$WORK/verdict.mjs" "$REPORT" "$SPEC"

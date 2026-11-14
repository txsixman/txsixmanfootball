#!/usr/bin/env bash
# CI's checks on this machine, without the production build (never run `next build` locally; CI builds every PR).
# It runs the same commands as ci.yml's `data` and `web-checks` jobs; the page tests and Lighthouse need CI's build.
#
#   scripts/check.sh            every check (about 2-3 minutes once the packages are installed)
#   scripts/check.sh --quick    skips the throwaway-database tests and the stories build (well under a minute)
#
# Packages install only where node_modules is missing. Every check runs even after one fails; the summary names each
# failure and the script exits 1 if any failed.
set -u
cd "$(dirname "$0")/.." || exit 2

quick=false
[ "${1:-}" = "--quick" ] && quick=true

# Keep these versions the same as ci.yml.
KNIP=knip@6.45.1
RUFF=ruff@0.17.4
ACTIONLINT=1.7.12

passed=()
failed=()
skipped=()

run() {
  local name="$1"
  shift
  printf '\n== %s\n' "$name"
  local start=$SECONDS
  if "$@"; then
    passed+=("$name ($((SECONDS - start))s)")
  else
    failed+=("$name")
  fi
}

install() {
  [ -d "$1/node_modules" ] || npm ci --prefix "$1" --no-audit --no-fund
}

need() {
  command -v "$1" >/dev/null && return 0
  printf '\n== %s\nmissing: %s (install it, or this check runs in CI only)\n' "$2" "$1"
  skipped+=("$2 (no $1)")
  return 1
}

same_as_ci() {
  grep -q "$KNIP" .github/workflows/ci.yml && grep -q "$RUFF" .github/workflows/ci.yml && grep -q "ACTIONLINT: $ACTIONLINT" .github/workflows/ci.yml && return 0
  echo "scripts/check.sh pins $KNIP, $RUFF and actionlint $ACTIONLINT, but ci.yml uses other versions; make them match"
  return 1
}
run "Tool versions match ci.yml" same_as_ci

# The `data` job.
run "Token guard" bash .github/scripts/token-guard.sh
if [ -n "$(git rev-list origin/main..HEAD 2>/dev/null)" ]; then
  run "Commit addresses (since origin/main)" bash .github/scripts/commit-emails.sh origin/main..HEAD
else
  echo "Commit addresses: skipped, no commits since origin/main (CI checks every pull request)"
fi
if need actionlint "Workflow lint (actionlint with shellcheck)" && need shellcheck "Workflow lint (actionlint with shellcheck)"; then
  actionlint_same() {
    local here
    here="$(actionlint -version | head -1)"
    if [ "$here" != "$ACTIONLINT" ]; then
      echo "actionlint here is $here; CI pins $ACTIONLINT (https://github.com/rhysd/actionlint/releases)"
      return 1
    fi
    actionlint -no-color
  }
  run "Workflow lint (actionlint with shellcheck)" actionlint_same
fi
run "Site freshness, post-deploy smoke and results commit" sh -c 'node --test .github/scripts/*.test.mjs'
if $quick; then
  skipped+=("Migrations and seeds on a throwaway database (--quick)")
else
  run "Migrations and seeds on a throwaway database" sh -c 'npm ci --prefix packages/db --no-audit --no-fund >/dev/null && npm --prefix packages/db test'
fi
run "League readers" sh -c 'npm ci --prefix tools/league-watch --no-audit --no-fund >/dev/null && npm --prefix tools/league-watch test'
run "Push alert sender" sh -c 'npm ci --prefix tools/push --no-audit --no-fund >/dev/null && npm --prefix tools/push test'
run "School logos, colors and mascots" npm --prefix tools/school-identity test
run "History readers" npm --prefix tools/history test
if need uvx "Ruff lint and format"; then
  run "Ruff lint and format" sh -c "uvx $RUFF check && uvx $RUFF format --check"
fi
if need uv "Ratings model"; then
  run "Ratings model" uv run --directory services/ratings pytest -q
fi

# The `web-checks` job.
run "Site packages" install apps/web
run "Data checks, files and cross-file" node apps/web/scripts/check-data.mjs
run "Typecheck" npm --prefix apps/web run typecheck
run "Database package (PGlite, for the route tests)" install packages/db
run "Data checks, route tests and build-script tests" sh -c 'node --test apps/web/scripts/*.test.mjs'
run "Knip" sh -c "cd apps/web && npx --yes $KNIP --no-progress"
if $quick; then
  skipped+=("Stories build (--quick)")
else
  run "Stories build" npm --prefix apps/web run stories:build
fi

printf '\n== Summary\n'
for p in ${passed[@]+"${passed[@]}"}; do printf '  pass  %s\n' "$p"; done
for s in ${skipped[@]+"${skipped[@]}"}; do printf '  skip  %s\n' "$s"; done
for f in ${failed[@]+"${failed[@]}"}; do printf '  FAIL  %s\n' "$f"; done
printf 'Not run here: the production build, page tests and Lighthouse (CI only).\n'
[ ${#failed[@]} -eq 0 ]

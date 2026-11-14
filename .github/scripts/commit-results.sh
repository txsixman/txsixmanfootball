#!/usr/bin/env bash
# Results watch's commit (results-watch.yml): this read's captures to the private data repo first, then the facts
# published from them and rerated to this repo, each on its newest main, with retries. Run from this repo's root, the
# private repo checked out at ./private, after the MaxPreps read wrote its captures there. The finals cross-check's report
# (ADR 0026), when a run wrote one, is two files in the private repo's `davecampbells-<season>/` (finals-check.csv,
# team-ids.json); they go in the same private commit by name, never the folder, so a file someone else keeps there is
# never put back to an older copy (ADR 0032). They never reach this repo.
#
#   .github/scripts/commit-results.sh <season>
#
# Env: WRITE (true pushes; anything else reports what would be pushed), DATA_PRIVATE_TOKEN (the private repo's token,
# handed to git for fetch and push there only; see pgit), INTEGRITY and INTEGRITY_REPORT (passed to
# apps/web/scripts/check-data.mjs: cross-file failures are written down, not blocking; the workflow fails the job from
# that file after the push), GITHUB_STEP_SUMMARY, GITHUB_OUTPUT (sha=<the pushed commit>), RUNNER_TEMP, and DETAILS: the
# game details (kickoffs and sites) read earlier in the run, when there are any. They are merged into the newest main's
# data/seed/game-details/<season>.csv after the reset, never overwriting a filled value (ADR 0041), and committed with it.
# Exits 1 when a push fails three times or a Zod check fails; the private commit, once pushed, stays.
# Tested against local bare repos in commit-results.test.mjs.
set -euo pipefail

year="${1:?usage: commit-results.sh <season>}"
dir="maxpreps-$year"
# What this run wrote to the private repo: the reader's captures (its whole folder), and the finals cross-check's two
# files by name when there are any.
private_paths=("$dir")
for f in finals-check.csv team-ids.json; do [ ! -f "private/davecampbells-$year/$f" ] || private_paths+=("davecampbells-$year/$f"); done
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
output="${GITHUB_OUTPUT:-/dev/null}"
read="${RUNNER_TEMP:?RUNNER_TEMP is needed}/read"

rm -rf "$read" && mkdir -p "$read"
for p in "${private_paths[@]}"; do mkdir -p "$(dirname "$read/$p")" && cp -r "private/$p" "$read/$p"; done
for repo in private .; do
  git -C "$repo" config user.name "github-actions[bot]"
  git -C "$repo" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
done

# Git on the private repo with the token (DATA_PRIVATE_TOKEN, when set) as a header for that one command, handed over by
# environment variable: it is never written to private/.git/config (the checkout keeps no credentials) or into a
# command line. Only fetch and push need it; the rest of the script uses plain git.
auth=""
if [ -n "${DATA_PRIVATE_TOKEN:-}" ]; then
  auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$DATA_PRIVATE_TOKEN" | base64 | tr -d '\n')"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::add-mask::${auth#AUTHORIZATION: basic }"; fi
fi
pgit() {
  if [ -z "$auth" ]; then git -C private "$@"; return; fi
  # A subshell with the next free GIT_CONFIG slot (a runner may already use some), so the exports end with the call.
  (
    n="${GIT_CONFIG_COUNT:-0}"
    export GIT_CONFIG_COUNT=$((n + 1))
    export "GIT_CONFIG_KEY_$n=http.https://github.com/.extraheader" "GIT_CONFIG_VALUE_$n=$auth"
    git -C private "$@"
  )
}
message="Results and ratings from MaxPreps, $(date -u +%Y-%m-%d)"

# 1. The private repo: this read's captures laid on its newest main. Only this workflow writes them.
for try in 1 2 3 4; do
  [ "$try" -le 3 ] || exit 1
  pgit fetch -q origin main
  git -C private reset -q --hard origin/main
  for p in "${private_paths[@]}"; do rm -rf "private/${p:?}" && mkdir -p "$(dirname "private/$p")" && cp -r "$read/$p" "private/$p"; done
  if [ -z "$(git -C private status --porcelain -- "${private_paths[@]}")" ]; then
    echo "Private repo: no new captures." >> "$summary"
    break
  fi
  if [ "${WRITE:-}" != true ]; then
    echo "Private repo: new captures, not pushed (not live, no \`write\` input)." >> "$summary"
    break
  fi
  git -C private add -- "${private_paths[@]}"
  git -C private commit -q -m "$message"
  pgit push -q origin HEAD:main && break
  echo "data-private main moved; try $try again"
done

# 2. This repo: the facts published from the private files and rerated, on the newest main. It runs even when the
# private repo had nothing new, so a run whose public push failed is repaired here, with nothing lost. Another commit
# (CI's ratings table, a hand capture) may land meanwhile, so up to three tries.
for try in 1 2 3; do
  git fetch -q origin main
  git reset -q --hard origin/main
  node tools/league-watch/publish.mjs "private/$dir" "data/seed/$dir"
  uv run --directory services/ratings python run.py --season "$year"
  details="data/seed/game-details/$year.csv"
  if [ -n "${DETAILS:-}" ] && [ -s "$DETAILS" ]; then
    mkdir -p "$(dirname "$details")"
    node tools/league-watch/davecampbells.mjs --merge-details "$DETAILS" --out "$details"
  fi
  if git diff --quiet -- data && [ -z "$(git ls-files --others --exclude-standard data)" ]; then
    echo "No new results." >> "$summary"
    exit 0
  fi
  # Zod checks on every file the site reads: a bad row fails the run here and never reaches main. Then the cross-file
  # checks (a program twice on one date, a playoff game missing from games.csv, a bracket team that lost its last
  # round...), in report mode: written to INTEGRITY_REPORT and the summary, the push goes ahead, and the workflow's last
  # step fails the job. The checks' packages install only when there is something new to check (most game-day ticks
  # have nothing).
  [ -d apps/web/node_modules ] || npm ci --prefix apps/web --no-audit --no-fund
  if [ -n "${INTEGRITY_REPORT:-}" ]; then : > "$INTEGRITY_REPORT"; fi
  node apps/web/scripts/check-data.mjs
  if [ "${WRITE:-}" != true ]; then
    { echo "New results, not pushed (not live, no \`write\` input):"; git diff --stat -- data; } >> "$summary"
    exit 0
  fi
  # The published facts by name, never the folder (ADR 0029): a stray file there (a capture written outside the private
  # repo) stays unstaged, and the data checks above have already failed the run over it.
  public=()
  for f in games.csv playoffs.csv; do [ ! -f "data/seed/$dir/$f" ] || public+=("data/seed/$dir/$f"); done
  [ ! -f "$details" ] || public+=("$details")
  git add -- "${public[@]}" data/ratings
  git commit -q -m "$message"
  if git push -q origin HEAD:main; then
    echo "sha=$(git rev-parse HEAD)" >> "$output"
    head -3 "private/$dir/coverage.txt" >> "$summary" || true
    exit 0
  fi
  echo "main moved; try $try again"
done
exit 1

#!/usr/bin/env bash
# Results watch's commit (results-watch.yml): this read's captures to the private data repo first, then the facts
# published from them and rerated to this repo, each on its newest main, with retries. Run from this repo's root, the
# private repo checked out at ./private, after the MaxPreps read wrote its captures there.
#
#   .github/scripts/commit-results.sh <season>
#
# Env: WRITE (true pushes; anything else reports what would be pushed), INTEGRITY and INTEGRITY_REPORT (passed to
# apps/web/scripts/check-data.mjs: cross-file failures are written down, not blocking; the workflow fails the job from
# that file after the push), GITHUB_STEP_SUMMARY, GITHUB_OUTPUT (sha=<the pushed commit>), RUNNER_TEMP.
# Exits 1 when a push fails three times or a Zod check fails; the private commit, once pushed, stays.
# Tested against local bare repos in commit-results.test.mjs.
set -euo pipefail

year="${1:?usage: commit-results.sh <season>}"
dir="maxpreps-$year"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
output="${GITHUB_OUTPUT:-/dev/null}"
read="${RUNNER_TEMP:?RUNNER_TEMP is needed}/read"

rm -rf "$read"
cp -r "private/$dir" "$read"
for repo in private .; do
  git -C "$repo" config user.name "github-actions[bot]"
  git -C "$repo" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
done
message="Results and ratings from MaxPreps, $(date -u +%Y-%m-%d)"

# 1. The private repo: this read's captures laid on its newest main. Only this workflow writes them.
for try in 1 2 3 4; do
  [ "$try" -le 3 ] || exit 1
  git -C private fetch -q origin main
  git -C private reset -q --hard origin/main
  rm -rf "private/$dir" && cp -r "$read" "private/$dir"
  if [ -z "$(git -C private status --porcelain -- "$dir")" ]; then
    echo "Private repo: no new captures." >> "$summary"
    break
  fi
  if [ "${WRITE:-}" != true ]; then
    echo "Private repo: new captures, not pushed (not live, no \`write\` input)." >> "$summary"
    break
  fi
  git -C private add "$dir"
  git -C private commit -q -m "$message"
  git -C private push -q origin HEAD:main && break
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
  git add "data/seed/$dir" data/ratings
  git commit -q -m "$message"
  if git push -q origin HEAD:main; then
    echo "sha=$(git rev-parse HEAD)" >> "$output"
    head -3 "private/$dir/coverage.txt" >> "$summary" || true
    exit 0
  fi
  echo "main moved; try $try again"
done
exit 1

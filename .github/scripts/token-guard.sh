#!/usr/bin/env bash
# Fails if a workflow that a pull request starts can reach DATA_PRIVATE_TOKEN (read and write on txsixman/data-private).
# Only push-to-main, schedule and dispatch runs may use it (main.yml, results-watch.yml, supabase.yml). A pull-request
# workflow must not name it, nor pass every secret on to a called workflow (secrets: inherit), which would hand it over
# unnamed. Comment lines are skipped. Run by CI's data job:  bash .github/scripts/token-guard.sh [.github/workflows]
set -u
dir="${1:-.github/workflows}"
bad=0
checked=0
for f in "$dir"/*.yml "$dir"/*.yaml; do
  [ -f "$f" ] || continue
  grep -qE '^[[:space:]]*pull_request(_target)?[[:space:]]*:|^on:.*pull_request' "$f" || continue
  checked=$((checked + 1))
  hits=$(grep -nE 'DATA_PRIVATE_TOKEN|secrets:[[:space:]]*inherit' "$f" | grep -vE '^[0-9]+:[[:space:]]*#')
  if [ -n "$hits" ]; then
    echo "$hits"
    echo "::error file=$f::a pull-request workflow names DATA_PRIVATE_TOKEN or passes secrets: inherit"
    bad=1
  fi
done
[ "$checked" -gt 0 ] || { echo "::error::no pull-request workflow found in $dir; the guard checked nothing"; exit 1; }
echo "$checked pull-request workflow(s) checked: $([ $bad = 0 ] && echo 'none can reach the private data token' || echo 'FAILED')"
exit $bad

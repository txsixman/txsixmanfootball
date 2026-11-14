#!/usr/bin/env bash
# Fails if any commit in a range has an author or committer address other than the project's own or GitHub's bots, so a
# personal address can never reach the public history through a pull request. Allowed: contact@txsixmanfootball.com,
# the github-actions bot (workflow commits), and Dependabot with GitHub's noreply committer (its weekly update PRs).
# Run by CI's commit-emails job on every pull request:  bash .github/scripts/commit-emails.sh <base>..<head>
set -u
range="${1:?usage: commit-emails.sh <base>..<head>}"
ok='^(contact@txsixmanfootball\.com|41898282\+github-actions\[bot\]@users\.noreply\.github\.com|49699333\+dependabot\[bot\]@users\.noreply\.github\.com|noreply@github\.com)$'
log=$(git log --format='%h %ae %ce' "$range") || { echo "::error::cannot read commits in $range"; exit 1; }
[ -n "$log" ] || { echo "::error::no commits in $range; the check checked nothing"; exit 1; }
checked=0
bad=0
while read -r h a c; do
  checked=$((checked + 1))
  # The address itself is never printed: CI logs are public, and printing it would publish what this check keeps out.
  for who in author committer; do
    addr=$([ $who = author ] && echo "$a" || echo "$c")
    echo "$addr" | grep -Eq "$ok" || { echo "::error::commit $h: the $who address is not allowed"; bad=1; }
  done
done <<< "$log"
echo "$checked commit(s) checked: $([ $bad = 0 ] && echo 'every address is allowed' || echo 'FAILED')"
exit $bad

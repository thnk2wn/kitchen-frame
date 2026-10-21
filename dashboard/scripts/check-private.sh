#!/bin/bash
# Stops a push that would publish household details: names, addresses, places, ids. Runs as the
# pre-push hook (dashboard/scripts/install-hooks.sh), or by hand with a range: check-private.sh A..B
#
# The words to look for are in .private-terms at the repo root (gitignored, so the list itself is never
# published): one per line, matched case-insensitively as plain text; # starts a comment. It checks
# the lines each pushed commit adds and the commit messages. A match lists where, and the push stops.
root=$(git rev-parse --show-toplevel) || exit 1
terms="$root/.private-terms"
if [ ! -s "$terms" ]; then echo "check-private: no $terms; nothing to check (see dashboard/scripts/check-private.sh)" >&2; exit 0; fi
pattern=$(grep -v '^[[:space:]]*#' "$terms" | sed '/^[[:space:]]*$/d' | sed 's/[][\.*^$/(){}+?|]/\\&/g' | paste -sd'|' -)
[ -z "$pattern" ] && exit 0

# --staged (the pre-commit hook): the lines about to be committed, before they're a commit at all.
if [ "${1:-}" = "--staged" ]; then
  hits=$(git diff --cached --no-color | grep '^+' | grep -v '^+++' | grep -inE "$pattern")
  if [ -n "$hits" ]; then
    echo "check-private: these staged lines have household details:" >&2
    echo "$hits" | sed 's/^/    /' | cut -c1-160 >&2
    echo "check-private: commit stopped. Replace them with made-up examples, then commit again." >&2
    exit 1
  fi
  exit 0
fi

ranges=()
if [ $# -gt 0 ]; then ranges=("$@")
else
  # As a pre-push hook: "<local ref> <local sha> <remote ref> <remote sha>" per line on stdin.
  zero=0000000000000000000000000000000000000000
  while read -r _ local _ remote; do
    [ "$local" = "$zero" ] && continue                                   # a branch being deleted
    if [ "$remote" = "$zero" ]; then ranges+=("$local" --not --remotes)  # a new branch: what no remote has
    else ranges+=("$remote..$local"); fi
  done
fi
[ ${#ranges[@]} -eq 0 ] && exit 0

found=0
for c in $(git rev-list "${ranges[@]}"); do
  hits=$( { git show --format= --no-color "$c" | grep '^+' | grep -v '^+++' ; git log -1 --format=%B "$c"; } | grep -inE "$pattern")
  if [ -n "$hits" ]; then
    found=1
    echo "check-private: $(git log -1 --format='%h %s' "$c")" >&2
    echo "$hits" | sed 's/^/    /' | cut -c1-160 >&2
  fi
done
# Cloudflare deploys main on the push: say so when this Mac has dashboard changes the push won't carry
# (deployed from here earlier, they'd be replaced by what's pushed). A warning; the push goes ahead.
if [ $found -eq 0 ] && [ -n "$(git -C "$root" status --porcelain -- dashboard 2>/dev/null)" ]; then
  echo "check-private: note: dashboard/ has changes that aren't committed. Cloudflare deploys what's pushed, so if they're live from a local deploy, they'll be replaced." >&2
fi
if [ $found -eq 1 ]; then
  echo "check-private: push stopped. Replace the household details above with made-up examples (and reword the commit message if it's there), then push again." >&2
  exit 1
fi
exit 0

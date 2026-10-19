#!/bin/bash
# Installs this repo's git hooks in this clone (hooks aren't cloned): pre-push runs
# dashboard/scripts/check-private.sh, which stops a push carrying household details listed in
# .private-terms at the repo root (gitignored).
root=$(git rev-parse --show-toplevel) || exit 1
hook="$(git rev-parse --git-path hooks)/pre-push"
printf '#!/bin/bash\nexec "%s/dashboard/scripts/check-private.sh"\n' "$root" > "$hook"
chmod +x "$hook" "$root/dashboard/scripts/check-private.sh"
echo "Installed $hook"

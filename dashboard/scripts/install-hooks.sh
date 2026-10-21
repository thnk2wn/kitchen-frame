#!/bin/bash
# Installs this repo's git hooks in this clone (hooks aren't cloned): pre-commit and pre-push run
# dashboard/scripts/check-private.sh, which stops a commit or a push carrying household details listed
# in .private-terms at the repo root (gitignored).
set -e
root=$(git rev-parse --show-toplevel)
hooks="$(git rev-parse --git-path hooks)"
printf '#!/bin/bash\nexec "%s/dashboard/scripts/check-private.sh"\n' "$root" > "$hooks/pre-push"
printf '#!/bin/bash\nexec "%s/dashboard/scripts/check-private.sh" --staged\n' "$root" > "$hooks/pre-commit"
chmod +x "$hooks/pre-push" "$hooks/pre-commit" "$root/dashboard/scripts/check-private.sh"
echo "Installed $hooks/pre-commit and $hooks/pre-push"

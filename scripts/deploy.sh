#!/usr/bin/env bash
# Production deploy of apps/web (SPA + Pages Function) to Cloudflare Pages. See docs/deploy.md.
set -euo pipefail

# Pinned so a deploy can never land in another account, whatever wrangler is logged in to.
readonly ACCOUNT_ID="00000000000000000000000000000000"
readonly PROJECT="cube-rule-oracle"
readonly BRANCH="main"
# Absolute og:url and og:image in index.html. Point this at the custom domain once it is live.
SITE_URL="${SITE_URL:-https://cube-rule-oracle.pages.dev}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="$root/apps/web"
cd "$root"

fail() {
  echo "deploy: $*" >&2
  exit 1
}

wrangler() {
  (cd "$web" && pnpm exec wrangler "$@")
}

[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty; commit or remove changes first."
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "production deploys run from $BRANCH only."

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

whoami_json="$(wrangler whoami --json 2>/dev/null)" || fail "wrangler is not logged in; run 'pnpm --filter @cube/web exec wrangler login'."
node -e '
  const { accounts = [] } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  process.exit(accounts.some((account) => account.id === process.argv[1]) ? 0 : 1);
' "$ACCOUNT_ID" <<<"$whoami_json" || fail "wrangler is not logged in to account $ACCOUNT_ID."

# Without the secret the Function serves mock rulings in production.
wrangler pages secret list --project-name "$PROJECT" 2>/dev/null | grep -q "TYPESAFE_API_KEY" ||
  fail "Pages secret TYPESAFE_API_KEY is missing; see docs/deploy.md."

pnpm check
echo "deploy: building with SITE_URL=$SITE_URL"
SITE_URL="$SITE_URL" pnpm --filter @cube/web build

# Run from apps/web: wrangler finds functions/ and wrangler.jsonc relative to its cwd.
wrangler pages deploy dist \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-hash "$(git rev-parse HEAD)" \
  --commit-message "$(git log -1 --pretty=%s)"

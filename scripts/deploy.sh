#!/usr/bin/env bash
# Production deploy of apps/web (SPA + Pages Function) to Cloudflare Pages. See docs/deploy.md.
set -euo pipefail

# Pinned so a deploy can never land in another account, whatever wrangler is logged in to.
readonly ACCOUNT_ID="00000000000000000000000000000000"
readonly PROJECT="cube-rule-oracle"
readonly BRANCH="main"
readonly DATABASE="cube-rule-oracle"
readonly SECRETS=(TYPESAFE_API_KEY TURNSTILE_SECRET_KEY SESSION_SECRET)
# Absolute og:url and og:image in index.html.
SITE_URL="${SITE_URL:-https://typesafe-ai-cube-rule.codyswartz.us}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="$root/apps/web"
cd "$root"

# The public Turnstile sitekey is baked into the SPA. Take it from the environment or the root .env.
if [[ -z "${VITE_TURNSTILE_SITE_KEY:-}" && -f "$root/.env" ]]; then
  VITE_TURNSTILE_SITE_KEY="$(sed -n 's/^VITE_TURNSTILE_SITE_KEY=//p' "$root/.env" | tail -n 1)"
fi
VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-}"

fail() {
  echo "deploy: $*" >&2
  exit 1
}

wrangler() {
  (cd "$web" && pnpm exec wrangler "$@")
}

[[ -n "$VITE_TURNSTILE_SITE_KEY" ]] ||
  fail "VITE_TURNSTILE_SITE_KEY is not set, so the SPA could not pass the human check; see docs/deploy.md."
# Cloudflare's test sitekeys start with 1x, 2x or 3x and only mint dummy tokens a real secret rejects.
[[ ! "$VITE_TURNSTILE_SITE_KEY" =~ ^[123]x0+[A-F]{2}$ ]] ||
  fail "VITE_TURNSTILE_SITE_KEY is a Turnstile test key; use the production sitekey."
if grep -q '"database_id": "00000000-0000-0000-0000-000000000000"' "$web/wrangler.jsonc"; then
  fail "apps/web/wrangler.jsonc still has the placeholder D1 database_id; see docs/deploy.md."
fi

[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty; commit or remove changes first."
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "production deploys run from $BRANCH only."

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

whoami_json="$(wrangler whoami --json 2>/dev/null)" || fail "wrangler is not logged in; run 'pnpm --filter @cube/web exec wrangler login'."
node -e '
  const { accounts = [] } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  process.exit(accounts.some((account) => account.id === process.argv[1]) ? 0 : 1);
' "$ACCOUNT_ID" <<<"$whoami_json" || fail "wrangler is not logged in to account $ACCOUNT_ID."

# Without TYPESAFE_API_KEY production serves mock rulings. Without the other two, the Function
# either skips the human check or refuses every new ruling.
# Captured first: with pipefail, grep -q closing the pipe early could fail the check spuriously.
secrets="$(wrangler pages secret list --project-name "$PROJECT" 2>/dev/null)" ||
  fail "could not list Pages secrets for $PROJECT; does the project exist?"
for secret in "${SECRETS[@]}"; do
  grep -q "$secret" <<<"$secrets" || fail "Pages secret $secret is missing; see docs/deploy.md."
done

# The Function refuses new rulings until the spend-cap tables exist.
migrations="$(wrangler d1 migrations list "$DATABASE" --remote 2>&1)" ||
  fail "could not list D1 migrations for $DATABASE; see docs/deploy.md."
grep -q "No migrations to apply" <<<"$migrations" ||
  fail "D1 has unapplied migrations; run 'pnpm --filter @cube/web exec wrangler d1 migrations apply $DATABASE --remote'."

pnpm check
echo "deploy: building with SITE_URL=$SITE_URL and sitekey $VITE_TURNSTILE_SITE_KEY"
SITE_URL="$SITE_URL" VITE_TURNSTILE_SITE_KEY="$VITE_TURNSTILE_SITE_KEY" pnpm --filter @cube/web build

# Run from apps/web: wrangler finds functions/ and wrangler.jsonc relative to its cwd.
wrangler pages deploy dist \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-hash "$(git rev-parse HEAD)" \
  --commit-message "$(git log -1 --pretty=%s)"

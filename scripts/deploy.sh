#!/usr/bin/env bash
# Production deploy of apps/web (SPA + Pages Function) to Cloudflare Pages. See docs/deploy.md.
set -euo pipefail

readonly PROJECT="cube-rule-oracle"
readonly BRANCH="main"
readonly DATABASE="cube-rule-oracle"
readonly SECRETS=(TYPESAFE_API_KEY TURNSTILE_SECRET_KEY SESSION_SECRET)
# Absolute og:url and og:image in index.html.
SITE_URL="${SITE_URL:-https://cube-rule-oracle.pages.dev}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="$root/apps/web"
cd "$root"

# The public Turnstile sitekey is baked into the SPA. Take it from the environment or the root .env.
if [[ -z "${VITE_TURNSTILE_SITE_KEY:-}" && -f "$root/.env" ]]; then
  VITE_TURNSTILE_SITE_KEY="$(sed -n 's/^VITE_TURNSTILE_SITE_KEY=//p' "$root/.env" | tail -n 1)"
fi
VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-}"

# The deploy only ever targets this account, whatever wrangler is logged in to. It lives in the
# gitignored root .env rather than in the repo.
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" && -f "$root/.env" ]]; then
  CLOUDFLARE_ACCOUNT_ID="$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' "$root/.env" | tail -n 1)"
fi
readonly ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"

fail() {
  echo "deploy: $*" >&2
  exit 1
}

[[ "$ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] ||
  fail "set CLOUDFLARE_ACCOUNT_ID in the root .env to your Cloudflare account id ('wrangler whoami' shows it)."

wrangler() {
  (cd "$web" && pnpm exec wrangler "$@")
}

[[ -n "$VITE_TURNSTILE_SITE_KEY" ]] ||
  fail "VITE_TURNSTILE_SITE_KEY is not set, so the SPA could not pass the human check; see docs/deploy.md."
# Cloudflare's test sitekeys start with 1x, 2x or 3x and only mint dummy tokens a real secret rejects.
[[ ! "$VITE_TURNSTILE_SITE_KEY" =~ ^[123]x0+[A-F]{2}$ ]] ||
  fail "VITE_TURNSTILE_SITE_KEY is a Turnstile test key; use the production sitekey."
[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty; commit or remove changes first."
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "production deploys run from $BRANCH only."

# The committed wrangler.jsonc carries placeholder KV and D1 ids. The real ones live in the root .env
# and go into the gitignored wrangler.production.jsonc, which every remote command below uses.
readonly PRODUCTION_CONFIG="wrangler.production.jsonc"
node "$root/scripts/cloudflare-config.mjs" >/dev/null || fail "could not write apps/web/$PRODUCTION_CONFIG."

# The footer, About and How Jev rules link to the repo, and GitHub answers 404 while it is private.
source_url="$(sed -n 's/^export const SOURCE_URL = "\(.*\)";$/\1/p' "$web/src/lib/links.ts")"
[[ -n "$source_url" ]] || fail "could not read SOURCE_URL from apps/web/src/lib/links.ts."
source_status="$(curl -s -o /dev/null -L --max-time 15 -w '%{http_code}' "$source_url" || true)"
[[ "$source_status" == "200" ]] ||
  fail "$source_url answered ${source_status:-nothing}; push $BRANCH and make the repo public first, since the site links to it."

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
migrations="$(wrangler d1 migrations list "$DATABASE" --remote -c "$PRODUCTION_CONFIG" 2>&1)" ||
  fail "could not list D1 migrations for $DATABASE; see docs/deploy.md."
grep -q "No migrations to apply" <<<"$migrations" ||
  fail "D1 has unapplied migrations; run 'pnpm migrate:remote'."

pnpm check
echo "deploy: building with SITE_URL=$SITE_URL and sitekey $VITE_TURNSTILE_SITE_KEY"
SITE_URL="$SITE_URL" VITE_TURNSTILE_SITE_KEY="$VITE_TURNSTILE_SITE_KEY" pnpm --filter @cube/web build

# Pages refuses a custom config path, so the upload swaps the real ids into wrangler.jsonc and puts
# the committed file back on exit, however the deploy ends.
trap 'git -C "$root" checkout -- apps/web/wrangler.jsonc' EXIT
cp "$web/$PRODUCTION_CONFIG" "$web/wrangler.jsonc"

# Run from apps/web: wrangler finds functions/ and wrangler.jsonc relative to its cwd.
wrangler pages deploy dist \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-hash "$(git rev-parse HEAD)" \
  --commit-message "$(git log -1 --pretty=%s)"

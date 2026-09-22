# Cube Rule Oracle

A fun web app built on [cuberule.com](https://cuberule.com/): type any food and TypeSafe's Jev model classifies it by where its structural starch sits (toast, sandwich, taco, sushi, quiche, calzone, salad, cake, nachos). Hosted on CloudFront so it can be shared with friends.

## TypeSafe / Jev

- Jev is a **System One** model, not a chat LLM. It takes `state` plus typed questions (Choice, Score, Noul) and returns probabilities. It does not generate text.
- The TypeSafe skill is installed at project scope (`.claude/settings.json`). Invoke `/typesafe:typesafe-ai` or say "use the TypeSafe skill". Live docs index: https://docs.typesafe.ai/llms.txt (append `.md` to any docs path).
- All questions and thresholds live in one file so they are easy to review. Keep it that way.
- The API key (`TYPESAFE_API_KEY`) is server-side only. It must never reach the browser bundle, a commit, or a log line.

## Git workflow

- Commit whenever a coherent unit of progress lands: a feature, a fix, a refactor, docs, infra. Do not batch a whole session into one commit, and do not commit broken builds.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`. Optional scope, e.g. `feat(web): ...`.
- Stage explicit paths, never `git add -A` blindly. Check `git status` for `.env` or `*.tfstate` before every commit.
- Run `pnpm check` (typecheck, lint, tests) before committing code.

## Releases

- Tag releases with annotated semver tags: `git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"`.
- Every tag gets a matching entry in `CHANGELOG.md` (Keep a Changelog format), committed before tagging.
- Bump `version` in the root `package.json` to match the tag.
- Semver: MINOR for user-visible features, PATCH for fixes and polish. Stay on `0.x` until the first real deploy with a live API key; that deploy becomes `v1.0.0`.
- Tag after a milestone is committed and `pnpm check` passes, not before.

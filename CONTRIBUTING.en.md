# Contributing to RUin

[Čeština](CONTRIBUTING.md) · **English**

Thanks for wanting to contribute. This document describes the recommended process, so that the review goes quickly and without unnecessary back-and-forth.

## Types of contributions

- bug fixes
- UX/UI improvements
- accessibility improvements
- tests and documentation
- refactoring without changing functional behavior

## Before you start

1. Check the existing issues and pull requests to see whether someone is already working on the same thing.
2. For bigger changes, open an issue with a proposed solution first.
3. Agree on the scope of the change, to keep conflicts to a minimum.

## Local development

Requirements:

- Node.js 22+
- npm 10+

Install and start:

```bash
npm install
npm run dev
```

Tests and checks:

```bash
npm test
npm run audit:a11y
npm run build
```

## Coding conventions

- Keep changes small and focused on a single topic.
- Keep variable and function names readable and consistent.
- Don't reformat unrelated parts of a file.
- When you change the UI, check both desktop and mobile.
- When you change accessibility, add or update the tests.

## Commit conventions

Recommended prefixes:

- `feat:` new functionality
- `fix:` bug fix
- `docs:` documentation
- `test:` tests
- `refactor:` structural change without a change in behavior
- `chore:` technical maintenance

Example:

```text
fix: correct duplicate phone validation in the RSVP flow
```

## Branch workflow (important)

For outside contributors:

- never push changes directly to `main`
- always create your own branch and send the change via a Pull Request

Recommended steps:

```bash
git checkout -b feat/short-description
# make your changes
git add .
git commit -m "feat: short description"
git push -u origin feat/short-description
```

Then open a Pull Request from your branch into `main`.

## Pull request checklist

Before submitting a PR, check that:

- [ ] the change is covered by tests (or it's clearly explained why not)
- [ ] the build passed locally
- [ ] the tests relevant to the change passed locally
- [ ] the documentation is updated (README or other)
- [ ] the PR describes what changed, why, and how it was verified

## What the PR description should contain

- A short summary of the change.
- Motivation and context.
- Step-by-step testing instructions.
- Screenshots/videos for UI changes (where it makes sense).

## Security

Don't report vulnerabilities you find publicly in an issue. Follow the process in [SECURITY.md](SECURITY.md).

Before you change RLS policies or RPC functions, or add a new table, read
[SECURITY_MODEL.md](SECURITY_MODEL.md) - it describes how the app handles (and
doesn't handle) identity and authorization (no authentication, `organizer_token`
as the only bearer credential, why RLS must deny everything by default and
authorization is only checked by the RPC functions). Without this context it's
easy to unknowingly repeat a mistake the project has already made once, which
is documented in [CODE_REVIEW.md](CODE_REVIEW.md). All three documents are in
Czech.

# Quality gates

Every check that runs, what it protects, and how to run it locally.

```bash
npm run check       # everything that runs without native toolchains
npm run check:all   # adds Swift/Kotlin lint, audit, licenses
```

## Code

| Gate | Command | Protects against |
|---|---|---|
| ESLint | `npm run lint` | `any` in the public API, untyped imports, stray `console.log` |
| Prettier | `npm run format:check` | formatting churn in diffs |
| TypeScript | `npm run typecheck` | strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Knip | `npm run deadcode` | unused exports, unused dependencies, orphaned files |

`--max-warnings=0` — warnings are errors. A warning nobody fixes is noise that hides real ones.

## Docs

Documentation is a first-class artifact here, so it gets the same treatment as code.

| Gate | Command | Protects against |
|---|---|---|
| markdownlint | `npm run lint:md` | inconsistent structure, broken tables |
| cspell | `npm run spell` | typos in user-facing docs |
| lychee (CI) | — | dead links, internal and external |

Project vocabulary lives in `.cspell-project.txt`. Add terms there rather than adding inline
ignores.

## Native

| Gate | Command | Protects against |
|---|---|---|
| SwiftLint | `npm run lint:swift` | `force_unwrapping`, `force_try`, `force_cast` — all **errors** |
| SwiftFormat | via lint-staged | formatting drift |
| ktlint | `npm run lint:kotlin` | Kotlin style |

Force-unwrapping is an error rather than a warning because the frame path is where crashes
live, and an unexpected nil there takes the app down mid-session.

## Package

| Gate | Command | Protects against |
|---|---|---|
| publint | `npm run check:package` | malformed `exports`, wrong `main`/`types` |
| Are The Types Wrong | `npm run check:package` | type resolution failures for consumers |
| Tarball guard (CI) | — | **model files leaking into the tarball**; tarball over 2 MB |

The tarball guard is the important one. [ADR 0002](./adr/0002-models-fetched-not-bundled.md) is
the whole reason this package is small; a stray `files[]` entry would silently undo it. CI fails
the build rather than letting it ship.

## Security

| Gate | Command | Protects against |
|---|---|---|
| npm audit (prod) | `npm run audit:deps` | shipped vulnerabilities at high or above |
| npm audit (dev) | `npm run audit:dev` | build-chain vulnerabilities at critical |
| License check | `npm run audit:license` | copyleft contamination |
| CodeQL (CI) | — | static analysis, weekly and per-PR |
| Dependabot | — | stale dependencies |

The production audit uses `--omit=dev` because **this package ships zero JavaScript
dependencies** — nothing in `node_modules` reaches a user's app. Dev-chain advisories (Metro,
Expo tooling) are gated separately at `critical`, since "fixing" them often means downgrading
React Native, which is worse than the advisory.

The license allowlist is `MIT · Apache-2.0 · BSD-2/3 · ISC · 0BSD · Unlicense · CC0`.
This is not ceremony: pose estimation is full of AGPL-3.0 models and toolkits — Ultralytics
YOLO-pose among them — and a single AGPL dependency would make this package unusable in the
closed-source apps it is built for.

Dependabot is configured to **never** bump MediaPipe. That version is pinned deliberately —
see [ADR 0003](./adr/0003-pin-mediapipe-0-10-21.md).

## Commits

| Gate | Protects against |
|---|---|
| commitlint | non-conventional messages, unknown scopes |
| husky `commit-msg` | catching it before push |
| CI `commits` job | catching it on the PR |

Format, type list, and scope list: [contributing → Commits](./contributing.md#commits).
Conventional commits are what make automated changelog generation possible — the type decides
whether a release is major, minor, or patch.

## Pre-commit

`lint-staged` runs on staged files only — ESLint, Prettier, markdownlint, cspell, SwiftFormat,
SwiftLint, ktlint. Fast enough not to be bypassed, which is the only property that matters
in a pre-commit hook.

## Device tests

Not part of `npm run check` — they need hardware. See [testing](./testing.md). Phase 6 adds
them on a schedule, plus the build matrix: platform × install method × architecture.

## Adding a gate

A new check must be **fast, deterministic, and actionable**. A gate that fails intermittently,
or whose failure message doesn't say what to do, will be disabled within a month — and then
so will the ones next to it.

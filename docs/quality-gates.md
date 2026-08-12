# Quality gates

Every check that runs, what it protects, and how to run it locally.

```bash
npm run check       # everything that runs without native toolchains
npm run check:all   # adds Swift/Kotlin lint, audit, licenses
```

## Code

| Gate | Command | Protects against |
| --- | --- | --- |
| ESLint | `npm run lint` | `any` in the public API, untyped imports, stray `console.log` |
| Prettier | `npm run format:check` | formatting churn in diffs |
| TypeScript | `npm run typecheck` | strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Tests | `npm test` | the wire format, the accessors, trigger validation, the joint tables |
| Knip | `npm run deadcode` | unused exports, unused dependencies, orphaned files |

`--max-warnings=0`, warnings are errors. A warning nobody fixes is noise that hides real ones.

`npm test` compiles `packages/core/tests/` and runs it on Node's built-in runner. No
test framework is installed. See [testing](./testing.md) for what the 60 tests cover and, more
importantly, what they do not.

## Docs

Documentation is a first-class artifact here, so it gets the same treatment as code.

| Gate | Command | Protects against |
| --- | --- | --- |
| markdownlint | `npm run lint:md` | inconsistent structure, broken tables |
| cspell | `npm run spell` | typos in user-facing docs |
| lychee | `npm run lint:links` | dead links, internal and external |

Project vocabulary lives in `.cspell-project.txt`. Add terms there rather than adding inline
ignores.

## Native

| Gate | Command | Protects against |
| --- | --- | --- |
| SwiftLint | `npm run lint:swift` | `force_unwrapping`, `force_try`, `force_cast` (all **errors**) |
| SwiftFormat | via lint-staged | formatting drift |
| ktlint | `npm run lint:kotlin` | Kotlin style |

Force-unwrapping is an error rather than a warning because the frame path is where crashes
live, and an unexpected nil there takes the app down mid-session.

## Package

| Gate | Command | Protects against |
| --- | --- | --- |
| publint | `npm run check:package` | malformed `exports`, wrong `main`/`types`, ESM/CJS mismatch |
| Are The Types Wrong | `npm run check:package` | type resolution failures across node10, node16, bundler |
| Tarball guard (CI) | n/a | **model files leaking into the tarball**; a missing build artifact; tarball over 2 MB |
| Packed CLI smoke test (CI) | n/a | a `bin` that only works from a checkout |

The tarball guard is the important one. [ADR 0002](./adr/0002-models-fetched-not-bundled.md) is
the whole reason this package is small; a stray `files[]` entry would silently undo it. CI fails
the build rather than letting it ship.

It also asserts the opposite direction, that `build/`, `plugin/build/`, `cli/index.js`,
`app.plugin.js` and `expo-module.config.json` are all present. The `package` job deliberately does
not run `npm run build` first: every step packs the way `npm publish` does, through the package's
own `prepack`, so a publish path that forgets to build the config plugin fails in CI instead of
shipping a plugin-less tarball.

`exports` in `packages/core/package.json` is a gate too, not just metadata. It closes deep imports
like `react-native-pose-detection/build/wire`, which would otherwise make every internal file
public API by accident.

## Security

| Gate | Command | Protects against |
| --- | --- | --- |
| Zero runtime deps | `npm run audit:deps` | a dependency reaching a consumer's app at all |
| npm audit (dev) | `npm run audit:dev` | build-chain vulnerabilities at critical |
| License check | `npm run audit:license` | copyleft contamination |
| CodeQL | `.github/workflows/codeql.yml` | static analysis on JavaScript and TypeScript, per PR and weekly |
| Dependabot | `.github/dependabot.yml` | security advisories, and GitHub Actions whose tag moved or was yanked |

`audit:deps` asserts that `react-native-pose-detection` declares no `dependencies`, which is the
whole of what a consumer installs. It does not run `npm audit --omit=dev`: since the example apps
exist, that walks Expo's build tooling, and reporting prebuild-time advisories under a
consumer-facing gate describes risk nobody carries. Dev-chain advisories are gated separately at
`critical`, because "fixing" them usually means downgrading React Native, which is worse than the
advisory. The moment a runtime dependency is added, `audit:deps` fails and says to audit it
properly.

The license allowlist is `MIT · Apache-2.0 · BSD-2/3 · ISC · 0BSD · Unlicense · CC0`.
This is not ceremony: pose estimation is full of AGPL-3.0 models and toolkits, Ultralytics
YOLO-pose among them. And a single AGPL dependency would make this package unusable in the
closed-source apps it is built for.

`audit:license` runs `scripts/no-runtime-deps.sh` first, then scans from `packages/core` rather
than from the repository root. The root's production tree is the two example apps, which no
consumer installs; the package's is what ships. `license-checker` prints an error and still exits
0 on an empty tree, which once made this gate one that could never fail.

### Dependabot policy

| Setting | Why |
| --- | --- |
| npm: `open-pull-requests-limit: 0` | Routine version PRs are off. The toolchain was brought current in August 2026 and there is no release cadence yet, so a monthly batch of bumps would be noise nobody triages |
| GitHub Actions: monthly, up to 5 | Actions are pinned to commit SHAs, so an update PR is the only way a moved tag or a yanked action ever reaches a reviewer |
| `typescript` majors ignored | `typescript-eslint` peers on `typescript <6.1.0`, so a 7.x bump breaks linting |
| `expo`, `expo-module-scripts`, `react`, `react-native` ignored | Peer-satisfying devDependencies that must match a combination tested on device |
| MediaPipe ignored | Pinned: see [ADR 0007](./adr/0007-pin-mediapipe-0-10-35.md) |

**Security advisories are unaffected by the zero limit.** They come from the security alerts
system rather than from this schedule, so an advisory affecting the repository still opens a PR.
Raising the npm limit is the one-line change that turns routine updates back on once someone is
around to triage them.

## Commits

| Gate | Protects against |
| --- | --- |
| commitlint | non-conventional messages, unknown scopes |
| husky `commit-msg` | catching it before push |
| CI `commits` job | catching it on the PR |

Format, type list, and scope list: [contributing → Commits](./contributing.md#commits).
Conventional commits are what make automated changelog generation possible, the type decides
whether a release is major, minor, or patch.

## Pre-commit

`lint-staged` runs on staged files only, ESLint, Prettier, markdownlint, cspell, SwiftFormat,
SwiftLint, ktlint. Fast enough not to be bypassed, which is the only property that matters
in a pre-commit hook. The native linters go through `scripts/optional-lint.sh`, so a contributor
who installed none of the Homebrew tools is not blocked from committing. CI runs ktlint on every
PR, and SwiftLint once Swift sources exist, and blocks there. The hook also skips `npm test`, to
stay under a couple of seconds; CI runs the tests on the push.

## Device tests

Not part of `npm run check`, and not part of CI either: they need hardware, and the two example
apps they would run in do not exist yet. Phase 6 adds them on a schedule, plus the build matrix
of platform × install method × architecture. See [testing](./testing.md).

## Running links locally

`lint:links` needs the `lychee` binary:

```bash
brew install lychee   # macOS
```

It is not part of `npm run check` for that reason, but it runs on every PR. Run it before
pushing documentation changes. A hand-rolled grep will miss malformed links like
`](.reference/file.md)`, which resolve to nothing but look plausible.

## What CI actually runs

One job per line, in `.github/workflows/ci.yml`, plus CodeQL in its own workflow.

| Job | Runner | Steps |
| --- | --- | --- |
| `code` | ubuntu, Node 22.22.1 **and** 24 | `lint`, `format:check`, `typecheck`, `test`, `deadcode` |
| `docs` | ubuntu | `lint:md`, `spell`, and lychee for links |
| `kotlin` | ubuntu | ktlint over `packages/core/android` |
| `swift-sources` | ubuntu | Looks for `*.swift` and reports whether the macOS job should start |
| `swift` | macOS, gated on the above | `swiftlint lint --strict` |
| `package` | ubuntu, Node 22.22.1 **and** 24 | `check:package`, the tarball guard, and a smoke test of the packed CLI |
| `security` | ubuntu | `audit:deps`, `audit:license`, `audit:dev` |
| `android-expo` | ubuntu | Prebuilds `example/expo`, builds the APK, asserts four ABIs and one model |
| `android-bare` | ubuntu | Installs the model into `example/bare` with the CLI, runs `doctor`, builds the APK, asserts four ABIs, one model, and that the module was autolinked |
| `commits` | ubuntu, pull requests only | commitlint from the base commit to HEAD |
| CodeQL | ubuntu | Per PR and weekly, JavaScript and TypeScript |

Two details worth knowing before editing the file. Every action is pinned to a commit SHA rather
than a tag, because a tag is a pointer its owner can move onto different code after review.
And `swift` is split from `swift-sources` so the macOS runner, billed at ten times the Linux
rate, never starts while there is no Swift to lint. The detection needs a checkout, so it cannot
be a job-level `if`.

The Node versions in `code` and `package` are the floor from `engines` and the version `.nvmrc`
pins, which makes the floor a tested promise rather than a guess.

## Adding a gate

A new check must be **fast, deterministic, and actionable**. A gate that fails intermittently,
or whose failure message doesn't say what to do, will be disabled within a month, and then
so will the ones next to it.

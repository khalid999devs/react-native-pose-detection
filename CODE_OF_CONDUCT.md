# Code of Conduct

`react-native-pose-detection` runs a camera and a neural network on a user's device, continuously,
inside someone else's application. That responsibility sets the tone here: the project is run
seriously, carefully, and with respect for everyone taking part.

Two things follow from it. How we treat each other, and the standard a change is held to. Both
apply to everyone, maintainers included.

## Our pledge

We pledge to make participation a harassment-free experience for everyone, regardless of age, body
size, disability, ethnicity, gender identity and expression, level of experience, nationality,
personal appearance, race, religion, or sexual identity and orientation. We pledge to act in ways
that keep this project open, welcoming, and professional.

## Expected conduct

- Communicate clearly and courteously, including in disagreement.
- Assume competence and good faith, and offer the same in return.
- Review the work, not the person.
- Accept that a maintainer may decline a change, and that a decision comes with a reason.
- Read the existing documentation and issues before opening a new one.

## Unacceptable behavior

- Sexualized language or imagery, and unwelcome sexual attention.
- Trolling, insults, derogatory comments, and personal or political attacks.
- Public or private harassment.
- Publishing someone's private information without their explicit permission.
- Sustained disruption of discussions, issues, or reviews.
- Anything else that would be inappropriate in a professional setting.

## Contributions

Questions, bug reports, reproductions, and documentation fixes are welcome from anyone and are
genuinely useful to this project. Nothing below applies to them.

Changes to the native layer or the public API are different, because they carry real risk for every
application that installs this package. One is expected to show working knowledge of the ground it
touches.

| Area | What that means |
| --- | --- |
| React Native and Expo | New Architecture, Expo Modules, autolinking, config plugins, and what crossing into native costs |
| Android, in Kotlin | CameraX, the Android lifecycle, threading and memory on a real device, native libraries through JNI |
| iOS, in Swift | AVFoundation, Objective-C interop, CocoaPods and Swift Package Manager, Xcode project structure |
| On-device inference | MediaPipe Tasks or a comparable runtime, delegate selection, and what a GPU delegate does when it fails |

Such a contribution should also:

1. Explain the problem it solves and why this approach is the right one.
2. Come with evidence it works. Anything touching the camera or the model needs a real device, on
   both platforms where the change affects both. See the pull request template.
3. Pass every gate in [quality gates](./docs/quality-gates.md).
4. Follow the conventions already in the codebase rather than introduce new ones.

New to one of these areas and want to contribute anyway? Say so when you open the issue or the
draft pull request. That is welcome, and it makes the review more useful to you. What causes
problems is a large native change presented as finished when it has never run on hardware.

## Reporting

Report unacceptable behavior to <khalidahammeduzzal@gmail.com>. Reports are reviewed promptly and
held in confidence. You will receive a response, and a reporter's identity is never disclosed to
the person reported.

Please do not use public issues for this.

## Enforcement

Maintainers clarify and enforce these standards, and may remove, edit, or reject contributions that
do not align with this document, with an explanation where appropriate. Action follows the impact
of the behavior.

| Step | Response |
| --- | --- |
| Correction | A private written note explaining what was inappropriate. A public apology may be requested |
| Warning | A warning with consequences for continued behavior, and no interaction with those involved for a stated period |
| Temporary ban | A temporary ban from any interaction with the project |
| Permanent ban | A permanent ban from public interaction with the project |

Maintainers who do not enforce this in good faith may face the same consequences, decided by the
rest of the project's leadership.

## Scope and attribution

This applies in all project spaces, including the repository, issues, pull requests, and
discussions, and whenever someone is officially representing the project in public.

The conduct sections are adapted from the
[Contributor Covenant](https://www.contributor-covenant.org/), version 2.1. The contribution
standard is specific to this project.

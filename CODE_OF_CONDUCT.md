# Code of Conduct

## Purpose

`react-native-pose-detection` is production software. Applications depend on it to run a camera
and a neural network on a user's device, continuously, without draining the battery or crashing
the host app. That responsibility sets the tone for how this project is run: seriously, carefully,
and with respect for everyone who takes part.

This document covers two things. How we treat each other, and the standard a contribution is held
to. Both apply to everyone, maintainers included.

## Our pledge

We pledge to make participation in this project a harassment-free experience for everyone,
regardless of age, body size, disability, ethnicity, gender identity and expression, level of
experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

We pledge to act and interact in ways that keep this project open, welcoming, and professional.

## Expected conduct

- Communicate clearly and courteously, including in disagreement.
- Assume competence and good faith in others, and offer the same in return.
- Give and receive review feedback on the work rather than the person.
- Accept that a maintainer may decline a change, and that a decision comes with a reason.
- Respect the time of others. Read the existing documentation and issues before opening a new one.

## Unacceptable behavior

- Sexualized language or imagery, and unwelcome sexual attention or advances.
- Trolling, insulting or derogatory comments, and personal or political attacks.
- Public or private harassment.
- Publishing another person's private information, such as a physical or email address, without
  their explicit permission.
- Sustained disruption of discussions, issues, or reviews.
- Any other conduct that would reasonably be considered inappropriate in a professional setting.

## Standard for contributions

The conduct standards above are about people and apply to everyone without qualification. This
section is about code, and it describes what a change must demonstrate before it can be merged.
It is not a barrier to participation. Questions, bug reports, reproductions, and documentation
corrections are welcome from anyone, and are genuinely valuable to this project.

Changes to the native or public-API surface, however, carry real risk for every application that
installs this package. A contribution touching those areas is expected to show working knowledge
of the relevant ground:

- **React Native and Expo.** The New Architecture, Expo Modules, autolinking, config plugins, and
  how a native module reaches JavaScript. A change to the bridge surface should be made by someone
  who understands what crossing it costs.
- **Android, in Kotlin.** CameraX, the Android lifecycle, threading and memory on a real device,
  and the behavior of native libraries reached through JNI.
- **iOS, in Swift.** AVFoundation, the Objective-C interop boundary, CocoaPods and the Swift
  Package Manager, and Xcode project structure.
- **On-device inference.** MediaPipe Tasks, or comparable experience with a mobile inference
  runtime, including delegate selection and what a GPU delegate does when it fails.

In practice this means a contribution should:

1. Explain the problem it solves and why the chosen approach is the right one.
2. Come with evidence it works. For anything touching the camera or the model, that means a real
   device, and both platforms where the change affects both. See the pull request template.
3. Pass every quality gate in [docs/quality-gates.md](./docs/quality-gates.md).
4. Match the conventions already in the codebase rather than introducing new ones.

If you are new to one of these areas and want to contribute anyway, please say so when you open
the issue or draft the pull request. Stating it plainly is welcome and makes the review more
useful to you. What causes problems is a large unreviewed change to the native layer presented as
finished when it has not been run on hardware.

## Reporting

Report unacceptable behavior to <khalidahammeduzzal@gmail.com>. Reports are reviewed promptly and
treated confidentially. You will receive a response, and the reporter's identity is not disclosed
to the person reported.

Please do not use public issues to report a conduct concern.

## Enforcement

Maintainers are responsible for clarifying and enforcing these standards, and will take fair
corrective action in response to any behavior they consider inappropriate. They may remove, edit,
or reject contributions that do not align with this document, with an explanation where
appropriate.

Enforcement follows the impact of the behavior:

1. **Correction.** A private, written note explaining what was inappropriate and why. A public
   apology may be requested.
2. **Warning.** A warning, with consequences for continued behavior, and no interaction with the
   people involved for a stated period.
3. **Temporary ban.** A temporary ban from any interaction with the project.
4. **Permanent ban.** A permanent ban from public interaction with the project.

Maintainers who do not follow or enforce this Code of Conduct in good faith may face temporary or
permanent repercussions determined by other members of the project's leadership.

## Scope

This Code of Conduct applies in all project spaces, including the repository, issues, pull
requests, and discussions, and it applies when an individual is officially representing the
project in public.

## Attribution

The conduct sections are adapted from the
[Contributor Covenant](https://www.contributor-covenant.org/), version 2.1. The standard for
contributions is specific to this project.

# Security Policy

## Supported versions

Pre-release. Once `0.1.0` ships, the latest minor receives security fixes.

| Version | Supported |
| ------- | --------- |
| `0.1.x` | pending release |

## Reporting a vulnerability

> **Security vulnerabilities only.** For ordinary bugs, crashes, and questions, please
> [open a public issue](https://github.com/khalid999devs/react-native-pose-detection/issues).
> that's the fastest way to get them fixed.

For anything with security impact, report it **privately** first:

1. [**Report a vulnerability**](https://github.com/khalid999devs/react-native-pose-detection/security/advisories/new)
  , GitHub's private advisory form (preferred)
2. Email <khalidahammeduzzal@gmail.com> if you can't use GitHub

Reporting privately is not about secrecy. A public issue describing an unpatched vulnerability
is a working exploit handed to attackers before any user can update. This follows
[coordinated vulnerability disclosure](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/about-coordinated-disclosure-of-security-vulnerabilities),
the practice recommended by GitHub, CISA, and CERT/CC.

### What to include

- What an attacker can achieve, and what access they need to start
- Steps to reproduce, ideally a minimal project
- Affected version, platform, and device
- Any proof-of-concept code

### What to expect

| | |
| --- | --- |
| Acknowledgement | within **72 hours** |
| Initial assessment | within **7 days** |
| Fix and advisory | target **90 days**, sooner where practical |
| Credit | your name or handle in the advisory, unless you prefer otherwise |

If a fix will take longer than 90 days, we'll say so and agree a date with you rather than
letting it drift.

### Safe harbor

We will not pursue or support legal action against anyone who reports a vulnerability in good
faith under this policy, meaning you made a genuine effort to avoid privacy violations, data
destruction, and service disruption, and you gave us reasonable time to respond before any
public disclosure.

If a third party brings action against you for research conducted under this policy, we will
make it known that your actions were authorized.

## Scope

This library runs entirely on-device. It does not transmit video, images, or landmark data
anywhere, and makes **no network calls at runtime**.

The single network operation happens **at build time**: the config plugin downloads a model
file from Google's storage over HTTPS and verifies it against a SHA-256 checksum committed in
this repository. A checksum mismatch is a hard failure, never a warning.

### In scope

- Model download integrity, checksum bypass, TLS handling, cache poisoning
- The CLI or config plugin writing outside intended project directories
- Memory safety in the native frame path
- Camera permission handling and lifecycle
- Anything causing landmark or image data to leave the device

### Out of scope

- Vulnerabilities in MediaPipe itself, report to
  [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe/security)
- Vulnerabilities in React Native, Expo, or the build chain, report upstream
- Issues requiring physical access to an unlocked device
- Denial of service through obviously unreasonable configuration (`maxPoses: 5` at 60 fps on a
  low-end device is a performance question, not a vulnerability)
- Dev-only dependency advisories that cannot reach a shipped app, this package has **zero
  runtime JavaScript dependencies**

## Privacy

No telemetry. No analytics. No network calls at runtime. No data leaves the device.

The [logging channel](./guides/troubleshooting.md) is off by default. When enabled, entries are
delivered only to listeners registered inside your own app and are never transmitted anywhere.

## For maintainers

Enable **Settings → Code security → Private vulnerability reporting** on the repository. The
file alone doesn't create the reporting form, the setting does.

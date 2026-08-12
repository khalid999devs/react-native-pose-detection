# Recipes

Copy-paste trigger configurations. **None of this ships in the library** — pose detection
provides primitives; domain logic is yours. These are starting points, not defaults.

Tune every threshold against your own users and camera placement.

| | |
|---|---|
| [strength.md](./strength.md) | Squat, push-up |
| [jump.md](./jump.md) | Vertical jump, flight time |
| [holds.md](./holds.md) | Plank and isometric timers |
| [mobility.md](./mobility.md) | Arm raise, seated posture |
| [tuning.md](./tuning.md) | Fixing triggers that misfire |

New to triggers? Read [guides/triggers.md](../triggers.md) first.

## Contributing a recipe

Recipes are documentation, not code. Open a PR against the relevant file with the config, what
it's for, and the camera placement it assumes.

A recipe belongs here — not in the library — if it needs to know what activity the user is
doing. That's the whole line between the two.

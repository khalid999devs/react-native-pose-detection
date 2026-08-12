# Holds & isometrics

## Plank hold timer

```ts
{
  id: 'plank',
  enter: { all: [
    { angle: 'leftHip',      between: [160, 180] },
    { angle: 'leftShoulder', between: [70,  110] },
  ]},
  emit: 'while',
  throttleMs: 1000,
  minDurationMs: 2000,
}
```

An angle is the unsigned angle between two limb segments, so it never exceeds 180 and a bound
above that is rejected at validation. `[160, 180]` is the straight-body window; it cannot tell a
slightly piked hip from a slightly arched one, only how far from straight the hip is.

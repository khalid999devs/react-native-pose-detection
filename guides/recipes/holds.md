# Holds & isometrics

## Plank hold timer

```ts
{
  id: 'plank',
  enter: { all: [
    { angle: 'leftHip',      between: [160, 200] },
    { angle: 'leftShoulder', between: [70,  110] },
  ]},
  emit: 'while',
  throttleMs: 1000,
  minDurationMs: 2000,
}
```

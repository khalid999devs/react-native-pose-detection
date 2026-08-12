# Strength & reps

## Squat rep counter

```ts
{
  id: 'squat',
  enter: { all: [
    { visibility: 'leftKnee', above: 0.6 },
    { angle: 'leftKnee', below: 90 },
  ]},
  exit: { angle: 'leftKnee', above: 160 },
  emit: 'cycle',
  debounceMs: 300,
}
```

## Push-up

```ts
{
  id: 'pushup',
  enter: { angle: 'leftElbow', below: 90 },
  exit:  { angle: 'leftElbow', above: 160 },
  emit: 'cycle',
  debounceMs: 250,
}
```

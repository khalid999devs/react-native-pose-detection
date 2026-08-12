# Mobility & posture

## Arm raise

```ts
{
  id: 'armRaise',
  enter: { landmarkY: 'leftWrist', above: 'leftShoulder' },
  exit:  { landmarkY: 'leftWrist', below: 'leftShoulder' },
  emit: 'cycle',
  debounceMs: 200,
}
```

## Posture warning (seated)

```ts
{
  id: 'slouch',
  enter: { landmarkY: 'nose', below: 'leftShoulder' },
  emit: 'enter',
  minDurationMs: 3000,
}
```

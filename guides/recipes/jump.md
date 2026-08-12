# Jump

## Vertical jump

```ts
{
  id: 'jump',
  enter: { velocityY: 'centerOfMass', above: 0.5 },
  exit:  { visibility: 'leftAnkle', above: 0.7 },
  emit: 'cycle',
  snapshot: true,
}
```

```tsx
onTrigger={(e) => {
  // durationMs is only present on a 'cycle' phase, so it is optional on the event.
  if (e.durationMs === undefined) return;
  const flightTime = e.durationMs / 1000;
  const heightMeters = (9.81 * (flightTime / 2) ** 2) / 2;
}}
```

Flight-time estimation assumes takeoff and landing at the same height and is sensitive to
frame rate. Treat it as relative, not absolute.

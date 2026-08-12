# Tuning triggers

| Symptom | Fix |
|---|---|
| Fires twice per rep | Widen the gap between `enter` and `exit`; add `debounceMs` |
| Misses reps | Loosen thresholds, or check the joint is visible throughout |
| Fires when nobody is there | Gate with `{ visibility: joint, above: 0.6 }` |
| Works close, fails far away | Use ratios against `bodySpan` instead of absolute distances |
| Erratic at frame edges | Raise `minVisibility`; reposition the camera |

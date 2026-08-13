import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PoseCamera } from 'react-native-pose-detection';
import type { Trigger, TriggerEvent } from 'react-native-pose-detection';

import { Button, CameraGate, Panel, Segmented, Stat } from '../components';
import { mono, theme } from '../theme';

type RecipeId = 'squat' | 'pushup' | 'jump' | 'plank';

/**
 * Copied from `guides/recipes/`, not rewritten. If a recipe in the docs stops working this screen
 * stops working with it, which is the only way a documented snippet stays true.
 */
const RECIPES: Record<RecipeId, { trigger: Trigger; blurb: string; source: string }> = {
  squat: {
    trigger: {
      id: 'squat',
      enter: {
        all: [
          { visibility: 'leftKnee', above: 0.6 },
          { angle: 'leftKnee', below: 90 },
        ],
      },
      exit: { angle: 'leftKnee', above: 160 },
      emit: 'cycle',
      debounceMs: 300,
    },
    blurb: 'Stand side-on to the camera. A rep counts on the way back up, not on the way down.',
    source: 'guides/recipes/strength.md',
  },
  pushup: {
    trigger: {
      id: 'pushup',
      enter: { angle: 'leftElbow', below: 90 },
      exit: { angle: 'leftElbow', above: 160 },
      emit: 'cycle',
      debounceMs: 250,
    },
    blurb: 'Side-on again. The elbow is the whole measurement, so the far arm can be out of frame.',
    source: 'guides/recipes/strength.md',
  },
  jump: {
    trigger: {
      id: 'jump',
      enter: { velocityY: 'centerOfMass', above: 0.5 },
      exit: { visibility: 'leftAnkle', above: 0.7 },
      emit: 'cycle',
      snapshot: true,
    },
    blurb: 'Height is estimated from flight time, so it is relative rather than absolute.',
    source: 'guides/recipes/jump.md',
  },
  plank: {
    trigger: {
      id: 'plank',
      enter: {
        all: [
          { angle: 'leftHip', between: [160, 180] },
          { angle: 'leftShoulder', between: [70, 110] },
        ],
      },
      emit: 'while',
      throttleMs: 1000,
      minDurationMs: 2000,
    },
    blurb: 'Fires once a second while the body stays straight, after holding it for two seconds.',
    source: 'guides/recipes/holds.md',
  },
};

const IDS: readonly RecipeId[] = ['squat', 'pushup', 'jump', 'plank'];

export function RecipesScreen() {
  const [recipe, setRecipe] = React.useState<RecipeId>('squat');
  const [reps, setReps] = React.useState(0);
  const [lastMs, setLastMs] = React.useState<number | null>(null);
  const [heightCm, setHeightCm] = React.useState<number | null>(null);
  const [holdSeconds, setHoldSeconds] = React.useState(0);
  const [hasSnapshot, setHasSnapshot] = React.useState(false);

  const triggers = React.useMemo(() => [RECIPES[recipe].trigger], [recipe]);

  const onTrigger = React.useCallback(
    (event: TriggerEvent) => {
      if (event.phase === 'enter' && recipe === 'plank') {
        setHoldSeconds((seconds) => seconds + 1);
        return;
      }

      setReps(event.count);
      setHasSnapshot(event.snapshot !== undefined);

      // Only a 'cycle' phase carries a duration, which is why the type has it optional.
      if (event.durationMs === undefined) return;
      setLastMs(event.durationMs);

      if (recipe === 'jump') {
        const flightTime = event.durationMs / 1000;
        setHeightCm(((9.81 * (flightTime / 2) ** 2) / 2) * 100);
      }
    },
    [recipe],
  );

  const reset = () => {
    setReps(0);
    setLastMs(null);
    setHeightCm(null);
    setHoldSeconds(0);
    setHasSnapshot(false);
  };

  const entry = RECIPES[recipe];

  return (
    <View style={styles.screen}>
      <View style={styles.preview}>
        <CameraGate>
          <PoseCamera
            style={StyleSheet.absoluteFill}
            overlay={{ connections: true }}
            triggers={triggers}
            onTrigger={onTrigger}
          />
        </CameraGate>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.stats}>
          {recipe === 'plank' ? (
            <Stat label="hold" value={`${holdSeconds}s`} />
          ) : (
            <Stat label="reps" value={String(reps)} />
          )}
          <Stat label="last" value={lastMs === null ? '--' : `${Math.round(lastMs)} ms`} />
          {recipe === 'jump' ? (
            <Stat label="height" value={heightCm === null ? '--' : `${heightCm.toFixed(0)} cm`} />
          ) : null}
          {entry.trigger.snapshot ? (
            <Stat
              label="snapshot"
              value={hasSnapshot ? 'yes' : 'no'}
              tone={hasSnapshot ? 'ok' : undefined}
            />
          ) : null}
        </View>

        <Panel title="Recipe">
          <Segmented
            options={IDS}
            value={recipe}
            onChange={(next) => {
              setRecipe(next);
              reset();
            }}
          />
          <Text style={styles.blurb}>{entry.blurb}</Text>
          <Button label="Reset" onPress={reset} />
        </Panel>

        <Panel title="The trigger">
          <Text style={styles.code}>{JSON.stringify(entry.trigger, null, 2)}</Text>
          <Text style={styles.source}>{entry.source}</Text>
        </Panel>

        <Panel title="Why these are recipes">
          <Text style={styles.blurb}>
            None of this is in the package. A rep is a domain idea, and a squat threshold that suits
            a gym app is wrong for a physiotherapy one. What the package ships is the primitive the
            recipe is written in: an angle, a velocity, and a state machine over them.
          </Text>
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  blurb: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  code: {
    color: theme.text,
    fontFamily: mono,
    fontSize: 11,
    lineHeight: 16,
  },
  list: { gap: 12, paddingBottom: 24 },
  preview: { borderRadius: 16, height: 240, overflow: 'hidden' },
  screen: { flex: 1, gap: 12 },
  source: { color: theme.muted, fontSize: 11 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

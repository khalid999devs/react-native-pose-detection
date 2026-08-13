import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/** A number worth watching while the camera runs, sized to be readable at arm's length. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'bad';
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, tone === 'ok' && styles.ok, tone === 'bad' && styles.bad]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bad: { color: theme.danger },
  label: { color: theme.muted, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  ok: { color: theme.ok },
  tile: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderRadius: 10,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: 96,
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  value: { color: theme.text, fontSize: 18, fontVariant: ['tabular-nums'], fontWeight: '700' },
});

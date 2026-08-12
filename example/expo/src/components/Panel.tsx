import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  title: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});

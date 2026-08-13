import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/**
 * One choice out of a few. Scrolls horizontally rather than wrapping, so a long option list
 * never changes the height of the panel it sits in and the controls below it stay put.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              style={[styles.item, selected && styles.selected]}
              onPress={() => onChange(option)}
            >
              <Text style={[styles.text, selected && styles.textSelected]}>{option}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  label: { color: theme.muted, fontSize: 12 },
  row: { gap: 6, paddingRight: 6 },
  selected: { backgroundColor: theme.accent, borderColor: theme.accent },
  text: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  textSelected: { color: '#04121f' },
  wrap: { gap: 6 },
});

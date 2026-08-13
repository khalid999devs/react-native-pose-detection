import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { theme } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** A round control for the floating rail over the camera. */
export function IconButton({
  icon,
  label,
  active,
  size = 46,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  size?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.icon,
        { width: size, height: size },
        active && styles.iconActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={Math.round(size * 0.42)}
        color={active ? theme.color.accent : theme.color.text}
      />
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  tone = 'accent',
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  tone?: 'accent' | 'quiet' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.button,
        tone === 'accent' && styles.buttonAccent,
        tone === 'danger' && styles.buttonDanger,
        inert && styles.buttonInert,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone === 'accent' ? theme.color.background : theme.color.text} />
      ) : (
        <Text style={[styles.buttonLabel, tone === 'accent' && styles.buttonLabelAccent]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** One switch and its explanation, the unit of every control panel over the camera. */
export function ToggleRow({
  title,
  note,
  value,
  onChange,
}: {
  title: string;
  note?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={title}
        trackColor={{ false: theme.color.borderStrong, true: theme.color.accent }}
        thumbColor={theme.color.background}
        ios_backgroundColor={theme.color.borderStrong}
      />
    </View>
  );
}

/** A row of mutually exclusive choices, for the settings a switch cannot express. */
export function Choice<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.choice}>
      <Text style={styles.rowTitle}>{title}</Text>
      {/* Scrolls rather than wraps: five profile names do not fit a phone's width, and a wrapped
          second line makes a row of chips read as two separate settings. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choiceRow}
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{option}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Separates groups inside a control panel. */
export function Rule() {
  return <View style={styles.rule} />;
}

const styles = StyleSheet.create({
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.border,
    marginVertical: theme.space(0.5),
  },
  icon: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  iconActive: {
    backgroundColor: theme.color.accentSoft,
    borderColor: theme.color.accent,
  },
  pressed: {
    opacity: 0.6,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: theme.space(5),
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  buttonAccent: {
    backgroundColor: theme.color.text,
    borderColor: theme.color.text,
  },
  buttonDanger: {
    borderColor: theme.color.danger,
  },
  buttonInert: {
    opacity: 0.45,
  },
  buttonLabel: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  buttonLabelAccent: {
    color: theme.color.background,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
  },
  rowText: {
    flex: 1,
    gap: theme.space(0.5),
  },
  rowTitle: {
    color: theme.color.text,
    fontSize: theme.font.label,
    fontWeight: '600',
  },
  rowNote: {
    color: theme.color.faint,
    fontSize: theme.font.tiny,
  },
  choice: {
    gap: theme.space(2),
  },
  choiceRow: {
    flexDirection: 'row',
    gap: theme.space(2),
    paddingRight: theme.space(4),
  },
  chip: {
    paddingVertical: theme.space(2),
    paddingHorizontal: theme.space(3.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  chipSelected: {
    backgroundColor: theme.color.accentSoft,
    borderColor: theme.color.accent,
  },
  chipLabel: {
    color: theme.color.muted,
    fontSize: theme.font.tiny,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: theme.color.accent,
  },
});

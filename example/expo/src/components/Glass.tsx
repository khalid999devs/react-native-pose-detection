import { BlurView } from 'expo-blur';
import * as React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { theme } from '../theme';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rounded corners have to be on the blur itself, or it bleeds past them on Android. */
  radius?: number;
  intensity?: number;
};

/**
 * A translucent panel for the camera screen.
 *
 * Blur alone will not keep dark text readable over a bright frame, so every panel also carries a
 * near-white scrim and a hairline edge: the blur gives depth, the scrim gives contrast, and the
 * edge is what stops the panel dissolving into a pale background.
 *
 * `dimezisBlurView` is asked for by name because Android's default blur is a flat tint; without it
 * the same component is glass on one platform and a grey box on the other, and these two apps are
 * meant to be indistinguishable.
 */
export function Glass({ children, style, radius = theme.radius.lg, intensity = 40 }: Props) {
  return (
    <BlurView
      intensity={intensity}
      tint="light"
      experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
      // The scrim is the blur's own background rather than an absolutely positioned child: on
      // Android the Dimezis blur lays a child like that out in the padded content box, which draws
      // a square white slab inside the rounded card.
      style={[styles.blur, { borderRadius: radius }, style]}
    >
      {children}
    </BlurView>
  );
}

/** The same shape without the blur, for panels that sit on the page rather than over the camera. */
export function Card({ children, style, radius = theme.radius.md }: Props) {
  return <View style={[styles.card, { borderRadius: radius }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  blur: {
    backgroundColor: theme.color.scrim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(12,13,15,0.10)',
    overflow: 'hidden',
    ...theme.lift,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
});

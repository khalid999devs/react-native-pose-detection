import { Platform } from 'react-native';

/**
 * One palette, one scale.
 *
 * Light by default, with a single accent taken from the cyan the package paints with, darkened
 * enough to hold contrast on white. Everything else is neutral: on a screen whose subject is a
 * camera frame or a painted photo, the interface should be the quietest thing on it.
 */
export const theme = {
  color: {
    /** A tinted page with white cards on it, rather than white on white: depth without shadow. */
    background: '#F4F6F8',
    surface: '#FFFFFF',
    surfaceSunken: '#E9EDF1',
    border: '#DDE2E8',
    borderStrong: '#C6CDD6',

    text: '#0B1220',
    muted: '#5A6472',
    faint: '#8B95A3',

    accent: '#0B7C93',
    accentSoft: '#DBF1F6',
    /** What the overlay paints with. Vivid, because it sits on video rather than on paper. */
    overlay: '#00E5FF',

    danger: '#D93A4B',
    dangerSoft: '#FDECEE',
    good: '#12925A',

    /** Behind glass over the camera, so a control stays readable on a bright frame. */
    scrim: 'rgba(255,255,255,0.72)',
    /** Android has no blur behind a camera surface, so its panels carry the contrast alone. */
    scrimSolid: 'rgba(255,255,255,0.94)',
  },

  space: (steps: number) => steps * 4,

  radius: {
    sm: 12,
    md: 18,
    lg: 26,
    pill: 999,
  },

  font: {
    display: 32,
    title: 19,
    body: 15,
    label: 13,
    tiny: 11,
  },

  /** One soft shadow, used only where an element genuinely floats. */
  /**
   * One soft shadow, used only where an element genuinely floats.
   *
   * Android's `elevation` follows a different curve from an iOS shadow, and a value that reads as a
   * gentle lift on one reads as a dark halo on the other, so the two are tuned apart rather than
   * shared.
   */
  lift: Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 6 },
    },
    default: { elevation: 2 },
  }),

  /**
   * For the one element that floats over everything else.
   *
   * iOS renders a wide, soft, tinted shadow and needs a strong one before it reads as lifted at
   * all. Android's `elevation` draws a tighter grey shape that turns into a dark halo at the same
   * apparent strength, so it goes the other way. The two numbers are not a conversion of each
   * other; they are what each platform needs to produce the same impression.
   */
  liftStrong: Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 12 },
    },
    default: { elevation: 3 },
  }),
} as const;

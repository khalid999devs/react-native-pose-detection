export type ScreenId =
  | 'home'
  | 'basic'
  | 'playground'
  | 'triggers'
  | 'data'
  | 'performance'
  | 'recipes'
  | 'angles'
  | 'overlay'
  | 'static'
  | 'console'
  | 'scenarios'
  | 'about';

export type ScreenEntry = {
  id: Exclude<ScreenId, 'home'>;
  title: string;
  blurb: string;
};

/** The order they appear on Home: the two that prove the package first, then the rest. */
export const SCREENS: readonly ScreenEntry[] = [
  {
    id: 'basic',
    title: 'Basic',
    blurb: 'Camera, detection, and the native skeleton overlay. The happy path and nothing else.',
  },
  {
    id: 'playground',
    title: 'Playground',
    blurb:
      'Every prop with a live control, and what each one resolved to next to what you asked for.',
  },
  {
    id: 'triggers',
    title: 'Triggers',
    blurb: 'Build and edit triggers live. Fired events stream into a list with their counts.',
  },
  {
    id: 'data',
    title: 'Data modes',
    blurb: 'off, throttled, batched and live, with the crossings per second each one costs.',
  },
  {
    id: 'performance',
    title: 'Performance',
    blurb: 'Calibration, the thermal ladder, and every performance change with its reason.',
  },
  {
    id: 'recipes',
    title: 'Recipes',
    blurb: 'Squat, push-up, jump and plank, running the triggers the guides print.',
  },
  {
    id: 'angles',
    title: 'Angles',
    blurb: 'Arcs drawn natively, degrees read off the frame, and the two compared.',
  },
  {
    id: 'overlay',
    title: 'Overlay',
    blurb: 'Colors, line width, joint subset, and angle arcs.',
  },
  {
    id: 'static',
    title: 'Static input',
    blurb: 'Detection on an image or a video from the library, with no camera involved.',
  },
  {
    id: 'console',
    title: 'Console',
    blurb: 'The native log stream, filtered by level and category.',
  },
  {
    id: 'scenarios',
    title: 'Scenarios',
    blurb: 'The stress panel: camera switches, remounts, toggles, and a ten minute soak.',
  },
  {
    id: 'about',
    title: 'About',
    blurb: 'What this build contains and what has never run on a device.',
  },
];

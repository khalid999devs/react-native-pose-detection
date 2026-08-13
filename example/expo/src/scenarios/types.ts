import type { PoseCameraRef } from 'react-native-pose-detection';

export type ScenarioReport = {
  readonly id: string;
  readonly passed: boolean;
  readonly iterations: number;
  readonly elapsedMs: number;
  readonly detail: string;
  readonly heapBefore: number | null;
  readonly heapAfter: number | null;
};

export type ScenarioContext = {
  /** Null between a remount's teardown and the next mount, which is a case every runner hits. */
  readonly camera: { current: PoseCameraRef | null };
  /** Unmounts and remounts the camera, resolving on the next `onReady` rather than on a timer. */
  readonly remount: () => Promise<void>;
  /** Trigger counts by id, as the last `onTrigger` reported them. */
  readonly counts: () => Readonly<Record<string, number>>;
  /** A line in the scenario's own log, shown under the report. */
  readonly log: (line: string) => void;
};

export type Scenario = {
  readonly id: string;
  readonly title: string;
  readonly verifies: string;
  readonly run: (context: ScenarioContext) => Promise<ScenarioReport>;
};

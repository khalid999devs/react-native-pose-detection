export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Runtime categories only. The config plugin's `plugin` category is build-time output from Node
 * and never reaches this channel.
 */
export type LogCategory = 'camera' | 'detector' | 'engine' | 'triggers' | 'calibration' | 'overlay';

export const LOG_LEVELS: readonly LogLevel[] = [
  'off',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

export const LOG_CATEGORIES: readonly LogCategory[] = [
  'camera',
  'detector',
  'engine',
  'triggers',
  'calibration',
  'overlay',
] as const;

/** One level for everything, or per category so `trace` on triggers does not drown you in camera. */
export type LogLevelConfig = LogLevel | Readonly<Partial<Record<LogCategory, LogLevel>>>;

export type LogEntry = {
  readonly level: Exclude<LogLevel, 'off'>;
  readonly category: LogCategory;
  readonly message: string;
  /** Same monotonic clock as `PoseFrame.timestamp`, so a log line maps to the frame that caused it. */
  readonly timestamp: number;
  readonly data?: Readonly<Record<string, number | string | boolean>>;
};

/**
 * Entries arrive batched, roughly every 250 ms. When a slow listener causes the native ring buffer
 * to drop entries, the batch opens with a `warn` entry carrying `data.droppedCount`.
 */
export type LogListener = (entries: readonly LogEntry[]) => void;

export type Subscription = {
  remove(): void;
};

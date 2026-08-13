/**
 * React Native exposes no memory API, and the memory that matters here is native anyway: the
 * camera's buffers, MediaPipe's arena and the overlay's layers are all outside the JavaScript
 * heap, so a JS number would move by kilobytes while a real leak moved by megabytes.
 *
 * Hermes may grow `performance.memory` later, so it is read when present, and the scenario
 * reports say plainly when it is not rather than printing a zero.
 */
export function jsHeapBytes(): number | null {
  const perf = globalThis.performance as { memory?: { usedJSHeapSize?: unknown } } | undefined;
  const used = perf?.memory?.usedJSHeapSize;
  return typeof used === 'number' ? used : null;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

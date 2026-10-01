// F2: event-log rotation policy — pure helpers, used by src/main/log.ts.

export const LOG_MAX_BYTES = 10 * 1024 * 1024;

// The single rotated file kept alongside the live log (events.jsonl →
// events.1.jsonl, overwriting any previous one).
export function rotatedPath(logFile: string): string {
  return logFile.replace(/\.jsonl$/, '.1.jsonl');
}

export function shouldRotate(writtenBytes: number, lineBytes: number, maxBytes: number): boolean {
  return writtenBytes > 0 && writtenBytes + lineBytes > maxBytes;
}

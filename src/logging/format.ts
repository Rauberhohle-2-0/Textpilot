/**
 * One log entry as one line.
 *
 * Every transport that writes text shares this, so the file and the
 * console can never disagree about what a run looked like.
 */
import type { LogEntry } from "./logger.ts";

const LEVEL_LABEL: Record<LogEntry["level"], string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

export function format(entry: LogEntry): string {
  const time = entry.time.toISOString();
  const scope = entry.scope ? ` [${entry.scope}]` : "";
  const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `${time} ${LEVEL_LABEL[entry.level]}${scope} ${entry.message}${data}`;
}

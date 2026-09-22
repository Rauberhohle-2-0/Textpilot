/**
 * Writes entries to stdout/stderr: normal levels to stdout, warn and error
 * to stderr so redirects keep working.
 */
import { format } from "../format.ts";
import type { LogEntry } from "../logger.ts";
import type { Transport } from "../transport.ts";

export class ConsoleTransport implements Transport {
  readonly name = "console";

  write(entry: LogEntry): void {
    const line = format(entry);
    if (entry.level === "warn" || entry.level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

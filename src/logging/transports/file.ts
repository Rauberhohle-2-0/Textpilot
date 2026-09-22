/**
 * Appends entries to a log file.
 *
 * `truncate: true` is what makes "overwritten after every run" work: the
 * entry point that owns the process lifetime creates this transport with
 * truncation, so each run starts with an empty file while every append
 * inside the run keeps history.
 */
import { appendFileSync, mkdirSync, truncateSync } from "node:fs";
import { dirname } from "node:path";
import { format } from "../format.ts";
import type { LogEntry } from "../logger.ts";
import type { Transport } from "../transport.ts";

export interface FileTransportOptions {
  /** Log file path; missing parent directories are created. */
  path: string;
  /** Empty the file when the transport is created (start of a run). */
  truncate?: boolean;
}

export class FileTransport implements Transport {
  readonly name = "file";

  constructor(private readonly options: FileTransportOptions) {
    mkdirSync(dirname(options.path), { recursive: true });
    if (options.truncate) {
      try {
        truncateSync(options.path);
      } catch {
        // A missing file is fine - it is created on the first write.
      }
    }
  }

  write(entry: LogEntry): void {
    appendFileSync(this.options.path, `${format(entry)}\n`);
  }
}

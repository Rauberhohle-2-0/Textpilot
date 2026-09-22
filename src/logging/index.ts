/**
 * Assembles the application logger: console + file, from `appConfig`.
 *
 * The single place that knows which transports a run gets. Entry points
 * create one logger here and hand children down to the modules, so every
 * part of the app logs through the same pipe.
 */
import { appConfig } from "../config/app.ts";
import { Logger } from "./logger.ts";
import type { Transport } from "./transport.ts";
import { ConsoleTransport } from "./transports/console.ts";
import { FileTransport } from "./transports/file.ts";

export { Logger } from "./logger.ts";
export type { LogEntry } from "./logger.ts";
export type { Transport } from "./transport.ts";

export function createLogger(): Logger {
  const transports: Transport[] = [new ConsoleTransport()];
  // The log file lives under the project root, which a packaged app cannot
  // write to (its bundle is signed and read-only once installed). Losing
  // the console because the file cannot be created would turn a degraded
  // run into a crash at startup, so a file that cannot be opened degrades
  // to console-only instead.
  try {
    transports.push(new FileTransport({ path: appConfig.logging.file, truncate: true }));
  } catch {
    // Console-only from here; the run still logs somewhere.
  }
  return new Logger({
    level: appConfig.logging.level,
    transports,
  });
}

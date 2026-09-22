/**
 * Shared bootstrap for the entry points: logger first, then the one-time
 * import of old data into the library, then the app.
 *
 * Everything a run needs before a server or a window exists happens here,
 * so `main.ts` and `dev.ts` stay thin and cannot drift apart. It is async
 * because the migration is awaited: it must finish before the first
 * request could see an empty document list and decide to migrate again.
 */
import { appConfig, ignoredPortEnv } from "./config/app.ts";
import { createLogger } from "./logging/index.ts";
import { Logger } from "./logging/logger.ts";
import { createApp } from "./server/app.ts";
import { migrateIntoTextpilot } from "./server/features/migration/migrate-into-textpilot.ts";

export interface Bootstrap {
  app: ReturnType<typeof createApp>;
  logger: Logger;
}

export async function bootstrap(): Promise<Bootstrap> {
  const logger = createLogger();
  logger.info(`${appConfig.name} ${appConfig.version} starting`, {
    identifier: appConfig.identifier,
  });

  if (ignoredPortEnv !== null) {
    logger.warn(`ignoring PORT=${ignoredPortEnv}`, { using: appConfig.server.port });
  }

  await migrateIntoTextpilot({
    root: appConfig.data.root,
    legacyNote: appConfig.data.legacy.note,
    legacyDocuments: appConfig.data.legacy.documents,
    legacyFolders: appConfig.data.legacy.folders,
    logger,
  });

  return { app: createApp({ logger }), logger };
}

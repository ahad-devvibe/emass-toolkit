import "dotenv/config";
import { app } from "./app.js";
import { env } from "./configs/env.js";
import { logger } from "./configs/logger.js";
import { emailWorker } from "./services/email/email-worker.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server is listening");
  // Resume bulk mail left unsent by a restart or deploy
  emailWorker.kick();
});

// Release uploads stream up to MAX_UPLOAD_BYTES through one request; Node's
// 300 s default would cut them off. Only settable server-wide.
server.requestTimeout = env.UPLOAD_TIMEOUT_MS;

// pm2 restarts send SIGINT/SIGTERM: stop taking requests, let the email
// worker finish its current send (the rest stays queued), then exit
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  server.close();
  await emailWorker.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

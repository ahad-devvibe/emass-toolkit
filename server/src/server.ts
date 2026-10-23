import "dotenv/config";
import { app } from "./app.js";
import { env } from "./configs/env.js";
import { logger } from "./configs/logger.js";
import { startScheduler } from "./services/scheduler/scheduler.service.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server is listening");
  startScheduler();
});

// Release uploads stream up to MAX_UPLOAD_BYTES through one request; Node's
// 300 s default would cut them off. Only settable server-wide.
server.requestTimeout = env.UPLOAD_TIMEOUT_MS;

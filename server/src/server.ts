import "dotenv/config";
import { app } from "./app.js";
import { env } from "./configs/env.js";
import { logger } from "./configs/logger.js";
import { startScheduler } from "./services/scheduler/scheduler.service.js";

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server is listening");
  startScheduler();
});

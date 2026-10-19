import cron from "node-cron";
import { logger } from "../../configs/logger.js";
import { env } from "../../configs/env.js";
import { sendDueSetPasswordReminders } from "../auth/set-password.service.js";

const REMINDER_CRON = "*/30 * * * *";

export function startScheduler(): void {
  if (process.env.NODE_ENV === "test") return;
  if (!env.SET_PASSWORD_REMINDER_HOURS) return;

  cron.schedule(REMINDER_CRON, () => {
    sendDueSetPasswordReminders()
      .then((sent) => {
        if (sent > 0) {
          logger.info({ sent }, "set-password reminders sent");
        }
      })
      .catch((err) => {
        logger.error({ err }, "set-password reminder sweep failed");
      });
  });
  logger.info({ cron: REMINDER_CRON }, "scheduler started");
}

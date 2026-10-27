import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import { env } from "./configs/env.js";
import { logger } from "./configs/logger.js";
import routes from "./routes/index.js";
import { ApiError } from "./utils/api-error.utils.js";
import { errorHandler } from "./utils/error-handler.utils.js";

export const app = express();

if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

app.use(pinoHttp({ logger }));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      try {
        const { hostname } = new URL(origin);
        const isLocalhost =
          hostname === "localhost" || hostname === "127.0.0.1";
        const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(
          hostname,
        );
        if (isLocalhost || isPrivate) return callback(null, true);
      } catch {
        // invalid origin URL — fall through to rejection below
      }
      callback(
        new ApiError(
          403,
          "This origin is not allowed to call the API",
          "CORS_ORIGIN_DENIED",
          { origin },
        ),
      );
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));

app.use("/api", routes);

app.use(errorHandler);

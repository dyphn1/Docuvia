import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import githubWebhooksRouter from "./routes/github_webhooks";
import { llmProxyRouter } from "./proxy/llm-proxy.js";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  const origins = corsOrigin.split(",").map((o) => o.trim());
  app.use(cors({ origin: origins }));
} else if (process.env.NODE_ENV === "production") {
  app.use(cors({ origin: false }));
} else {
  app.use(cors());
}

// Mount webhook route with raw body BEFORE express.json() so HMAC validation works
app.use("/api/webhooks/github", express.raw({ type: "application/json" }), githubWebhooksRouter);

app.use("/proxy/v1", llmProxyRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;

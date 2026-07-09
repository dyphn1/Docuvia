import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import "./di.js"; // Ensure DI is initialized before routes
import { routes as router } from "./routes";
import { githubWebhooksRouter } from "./routes/github-webhooks";
import { llmProxyRouter } from "./proxy/llm-proxy.js";
import { logger } from "@workspace/core";
import { standardLimiter, mcpLimiter } from "./lib/rate-limit.js";
import {
  EXPRESS_TRUST_PROXY_HOPS,
  ROUTE_WEBHOOKS_GITHUB,
  ROUTE_PROXY_V1,
  ROUTE_API_PREFIX,
  MIME_TYPE_JSON,
} from "./constants/index.js";

const app: Express = express();
app.set("trust proxy", EXPRESS_TRUST_PROXY_HOPS);

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

// Mount webhook route with raw body BEFORE express.json() so HMAC validation works.
// Mounted ahead of the /api router (and its standardLimiter), so apply rate limiting directly here.
app.use(
  ROUTE_WEBHOOKS_GITHUB,
  standardLimiter,
  express.raw({ type: MIME_TYPE_JSON }),
  githubWebhooksRouter
);

// LLM-heavy proxy — also mounted ahead of /api, use the stricter cost-prevention limiter.
app.use(ROUTE_PROXY_V1, mcpLimiter, llmProxyRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(ROUTE_API_PREFIX, router);

export default app;

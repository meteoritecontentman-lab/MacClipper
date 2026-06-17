import express from "express";
import {
  API_BASE_PATH,
  FUNCTIONS_REGION,
  FUNCTIONS_TIMEOUT_SECONDS
} from "./config";
import * as functions from "firebase-functions/v1";
import { initializeFirebaseAdmin } from "./firestore";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { createBotRoutes } from "./routes/botRoutes";
import { createPublicRoutes } from "./routes/publicRoutes";

initializeFirebaseAdmin();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(`${API_BASE_PATH}/billing/webhook`, express.raw({ type: "application/json" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(API_BASE_PATH, createPublicRoutes());
app.use(API_BASE_PATH, createBotRoutes());
app.use(notFoundHandler);
app.use(errorHandler);

export const api = functions
  .region(FUNCTIONS_REGION)
  .runWith({
    timeoutSeconds: FUNCTIONS_TIMEOUT_SECONDS,
    memory: "1GB"
  })
  .https.onRequest(app);
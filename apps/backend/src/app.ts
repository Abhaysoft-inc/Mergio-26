import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./env";
import { errorHandler, notFound } from "./middleware/error";
import { healthRouter } from "./routes/health";

export const app = express();

// In production the API sits behind one reverse proxy (see deploy/README.md); trust its
// X-Forwarded-* headers so req.ip and req.protocol are the client's, not the proxy's.
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());

app.use("/health", healthRouter);

app.use(notFound);
app.use(errorHandler);

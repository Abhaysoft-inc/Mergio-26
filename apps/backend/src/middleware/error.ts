import type { ErrorRequestHandler, RequestHandler } from "express";
import { env } from "../env";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
};

// Express only treats a middleware as an error handler when it declares four parameters,
// so `_next` must stay even though it is unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: env.isProduction ? "Internal server error" : String(err?.message ?? err),
  });
};

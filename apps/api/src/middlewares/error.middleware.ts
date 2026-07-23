import type { ErrorRequestHandler } from "express";

export const errorMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  response.status(500).json({ error: message });
};

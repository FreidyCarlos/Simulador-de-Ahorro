import express from "express";
import helmet from "helmet";
import type { BackupManager } from "./backup";
import {
  RevisionConflictError,
  type StateDatabase,
} from "./database";
import {
  MAX_JSON_BYTES,
  StateValidationError,
} from "./validation";

export interface AppDependencies {
  database: StateDatabase;
  backups: BackupManager;
}

export const createApp = ({ database, backups }: AppDependencies) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: MAX_JSON_BYTES, strict: true }));

  app.get("/api/health", (_request, response) => {
    try {
      const state = database.getMetadata();
      response.json({
        status: "ok",
        database: "connected",
        schemaVersion: state.schemaVersion,
        revision: state.revision,
        updatedAt: state.updatedAt,
      });
    } catch {
      response.status(503).json({
        error: "database_unavailable",
        message: "La base de datos local no está disponible.",
      });
    }
  });

  app.get("/api/state", (_request, response) => {
    try {
      response.json(database.getState());
    } catch {
      response.status(500).json({
        error: "read_error",
        message: "No fue posible leer el estado compartido.",
      });
    }
  });

  app.put("/api/state", (request, response) => {
    const body = request.body as {
      expectedRevision?: unknown;
      data?: unknown;
    };
    if (
      !body ||
      !Number.isInteger(body.expectedRevision) ||
      (body.expectedRevision as number) < 1
    ) {
      response.status(400).json({
        error: "validation_error",
        message: "El estado recibido no es válido.",
        path: "expectedRevision",
        detail: "Debe ser un entero positivo.",
      });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(body, "data")) {
      response.status(400).json({
        error: "validation_error",
        message: "El estado recibido no es válido.",
        path: "data",
        detail: "Es obligatorio.",
      });
      return;
    }
    try {
      response.json(
        database.saveState(body.expectedRevision as number, body.data),
      );
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        response.status(409).json({
          error: "revision_conflict",
          message: error.message,
          currentRevision: error.currentRevision,
          updatedAt: error.updatedAt,
        });
        return;
      }
      if (error instanceof StateValidationError) {
        response.status(400).json({
          error: "validation_error",
          message: "El estado recibido no es válido.",
          path: error.path,
          detail: error.detail,
        });
        return;
      }
      response.status(500).json({
        error: "write_error",
        message: "No fue posible guardar el estado compartido.",
      });
    }
  });

  app.post("/api/backups", async (_request, response) => {
    try {
      response.status(201).json(await backups.create());
    } catch {
      response.status(500).json({
        error: "backup_error",
        message: "No fue posible crear el respaldo SQLite.",
      });
    }
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({
      error: "not_found",
      message: "La ruta solicitada no existe.",
    });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const tooLarge =
        error instanceof Error &&
        ("type" in error && error.type === "entity.too.large");
      response.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "payload_too_large" : "invalid_json",
        message: tooLarge
          ? "El cuerpo supera el límite de 5 MB."
          : "El cuerpo JSON no es válido.",
      });
    },
  );

  return app;
};

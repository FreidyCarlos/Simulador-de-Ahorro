import type { StoredApplicationData } from "../domain/types";
import { parseApplicationData } from "../utils/storage";

export interface ServerHealth {
  status: "ok";
  database: "connected";
  schemaVersion: number;
  revision: number;
  updatedAt: string;
}

export interface ServerState {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  data: StoredApplicationData;
  isInitialState: boolean;
}

export interface SaveStateResponse {
  saved: true;
  revision: number;
  updatedAt: string;
}

export interface BackupResponse {
  created: true;
  file: string;
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
  path?: string;
  detail?: string;
  currentRevision?: number;
  updatedAt?: string;
}

export class StateApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly path?: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "StateApiError";
  }
}

export class RevisionConflictApiError extends StateApiError {
  constructor(
    message: string,
    public readonly currentRevision: number,
    public readonly updatedAt: string,
  ) {
    super(message, "revision_conflict", 409);
    this.name = "RevisionConflictApiError";
  }
}

const request = async <T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new StateApiError(
      "No fue posible conectarse con el servidor local.",
      "network_error",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StateApiError(
      "El servidor devolvió una respuesta inválida.",
      "invalid_response",
      response.status,
    );
  }

  if (!response.ok) {
    const api = payload as ApiErrorPayload;
    if (
      response.status === 409 &&
      api.error === "revision_conflict" &&
      typeof api.currentRevision === "number" &&
      typeof api.updatedAt === "string"
    ) {
      throw new RevisionConflictApiError(
        api.message ?? "El estado fue modificado desde otro dispositivo.",
        api.currentRevision,
        api.updatedAt,
      );
    }
    throw new StateApiError(
      api.message ?? "La solicitud al servidor falló.",
      api.error ?? "api_error",
      response.status,
      api.path,
      api.detail,
    );
  }
  return payload as T;
};

const validTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export const getServerHealth = async (signal?: AbortSignal) => {
  const health = await request<ServerHealth>(
    "/api/health",
    undefined,
    signal,
  );
  if (
    health.status !== "ok" ||
    health.database !== "connected" ||
    !Number.isInteger(health.schemaVersion) ||
    !Number.isInteger(health.revision) ||
    !validTimestamp(health.updatedAt)
  ) {
    throw new StateApiError(
      "La respuesta de salud del servidor no es válida.",
      "invalid_response",
    );
  }
  return health;
};

export const getServerState = async (signal?: AbortSignal) => {
  const state = await request<ServerState>("/api/state", undefined, signal);
  if (
    !Number.isInteger(state.schemaVersion) ||
    !Number.isInteger(state.revision) ||
    !validTimestamp(state.updatedAt) ||
    typeof state.isInitialState !== "boolean"
  ) {
    throw new StateApiError(
      "La respuesta de estado del servidor no es válida.",
      "invalid_response",
    );
  }
  try {
    state.data = parseApplicationData(JSON.stringify(state.data));
  } catch (error) {
    throw new StateApiError(
      `El servidor devolvió un estado incompatible: ${
        error instanceof Error ? error.message : "estructura inválida"
      }`,
      "invalid_state",
    );
  }
  return state;
};

export const saveServerState = (
  data: StoredApplicationData,
  expectedRevision: number,
  signal?: AbortSignal,
) =>
  request<SaveStateResponse>(
    "/api/state",
    {
      method: "PUT",
      body: JSON.stringify({ expectedRevision, data }),
    },
    signal,
  );

export const createServerBackup = (signal?: AbortSignal) =>
  request<BackupResponse>(
    "/api/backups",
    { method: "POST", body: "{}" },
    signal,
  );

import type { StoredApplicationData } from "../src/domain/types";
import {
  parseApplicationData,
  serializeApplicationData,
  STORAGE_VERSION,
} from "../src/utils/storage";

export const MAX_JSON_BYTES = 5 * 1024 * 1024;

export class StateValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = "StateValidationError";
  }
}

const validationPathFromMessage = (message: string) => {
  const match = message.match(
    /^((?:version|planConfiguration|actualTracking)(?:[\w.[\]]*)?)(?::|\s)/,
  );
  return match?.[1] ?? "data";
};

const validationDetailFromMessage = (message: string, path: string) =>
  message
    .replace(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*`), "")
    .trim() || "El valor no es válido.";

const validTimestamp = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

const requireTimestamp = (value: unknown, path: string) => {
  if (typeof value !== "string" || !validTimestamp(value)) {
    throw new StateValidationError(path, "Debe ser un timestamp ISO 8601 válido.");
  }
};

const validateTimestamps = (data: StoredApplicationData) => {
  data.planConfiguration.transfers.forEach((transfer, index) => {
    requireTimestamp(
      transfer.createdAt,
      `planConfiguration.transfers[${index}].createdAt`,
    );
    if (transfer.updatedAt !== undefined) {
      requireTimestamp(
        transfer.updatedAt,
        `planConfiguration.transfers[${index}].updatedAt`,
      );
    }
  });
  (data.planConfiguration.annualValueRevisions ?? []).forEach(
    (revision, index) =>
      requireTimestamp(
        revision.changedAt,
        `planConfiguration.annualValueRevisions[${index}].changedAt`,
      ),
  );
  data.actualTracking.records.forEach((record, index) => {
    requireTimestamp(
      record.createdAt,
      `actualTracking.records[${index}].createdAt`,
    );
    requireTimestamp(
      record.updatedAt,
      `actualTracking.records[${index}].updatedAt`,
    );
  });
  data.actualTracking.revisions.forEach((revision, index) => {
    requireTimestamp(
      revision.changedAt,
      `actualTracking.revisions[${index}].changedAt`,
    );
    requireTimestamp(
      revision.previousValues.createdAt,
      `actualTracking.revisions[${index}].previousValues.createdAt`,
    );
    requireTimestamp(
      revision.previousValues.updatedAt,
      `actualTracking.revisions[${index}].previousValues.updatedAt`,
    );
  });
};

export const validateApplicationState = (
  value: unknown,
): StoredApplicationData => {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    throw new StateValidationError("data", "No se pudo serializar el estado.");
  }
  if (!raw) {
    throw new StateValidationError("data", "Debe ser un objeto.");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) {
    throw new StateValidationError(
      "data",
      "El estado supera el límite de 5 MB.",
    );
  }
  try {
    const validated = parseApplicationData(raw);
    if (validated.version !== STORAGE_VERSION) {
      throw new StateValidationError(
        "version",
        `Debe ser ${STORAGE_VERSION}.`,
      );
    }
    validateTimestamps(validated);
    return validated;
  } catch (error) {
    if (error instanceof StateValidationError) throw error;
    const message =
      error instanceof Error ? error.message : "El estado no es válido.";
    const path = validationPathFromMessage(message);
    throw new StateValidationError(
      path,
      validationDetailFromMessage(message, path),
    );
  }
};

export const serializeValidatedState = (value: unknown) => {
  const data = validateApplicationState(value);
  return {
    data,
    json: serializeApplicationData(data),
  };
};

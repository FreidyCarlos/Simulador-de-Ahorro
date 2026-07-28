import type { StoredApplicationData } from "../domain/types";
import {
  parseApplicationData,
  serializeApplicationData,
  STORAGE_KEY,
  type StorageLike,
} from "../utils/storage";

export const MIGRATION_BACKUP_KEY = "ahorro-u-data-v2-migrated-backup";
export const MIGRATION_COMPLETED_KEY = "ahorro-u-server-migration-completed";

export const readLegacyMigrationCandidate = (
  storage: StorageLike,
  serverIsInitial: boolean,
): StoredApplicationData | null => {
  if (
    !serverIsInitial ||
    storage.getItem(MIGRATION_COMPLETED_KEY) === "true"
  ) {
    return null;
  }
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return parseApplicationData(raw);
  } catch {
    return null;
  }
};

export const completeLegacyMigration = (
  storage: StorageLike,
  data: StoredApplicationData,
) => {
  storage.setItem(MIGRATION_BACKUP_KEY, serializeApplicationData(data));
  storage.setItem(MIGRATION_COMPLETED_KEY, "true");
  storage.removeItem(STORAGE_KEY);
};

export const statesAreEqual = (
  left: StoredApplicationData,
  right: StoredApplicationData,
) => serializeApplicationData(left) === serializeApplicationData(right);

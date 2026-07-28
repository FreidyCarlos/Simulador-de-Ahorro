import type { StoredApplicationData } from "../src/domain/types";

export interface StoredStateRow {
  id: 1;
  schema_version: number;
  revision: number;
  data_json: string;
  created_at: string;
  updated_at: string;
}

export interface StateSnapshot {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  data: StoredApplicationData;
  isInitialState: boolean;
}

export interface SaveStateResult {
  saved: true;
  revision: number;
  updatedAt: string;
}

export interface DatabaseOptions {
  databasePath: string;
  backupsDirectory: string;
  initialData?: StoredApplicationData;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  path?: string;
  detail?: string;
  currentRevision?: number;
  updatedAt?: string;
}

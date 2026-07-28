import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { StoredApplicationData } from "../src/domain/types";
import {
  createDefaultApplicationData,
  STORAGE_VERSION,
} from "../src/utils/storage";
import {
  serializeValidatedState,
  validateApplicationState,
} from "./validation";
import type {
  DatabaseOptions,
  SaveStateResult,
  StateSnapshot,
  StoredStateRow,
} from "./types";

export class RevisionConflictError extends Error {
  constructor(
    public readonly currentRevision: number,
    public readonly updatedAt: string,
  ) {
    super("El estado fue modificado desde otro dispositivo.");
    this.name = "RevisionConflictError";
  }
}

export class StateDatabase {
  readonly databasePath: string;
  readonly backupsDirectory: string;
  private readonly connection: Database.Database;

  constructor(options: DatabaseOptions) {
    this.databasePath = resolve(options.databasePath);
    this.backupsDirectory = resolve(options.backupsDirectory);
    mkdirSync(dirname(this.databasePath), { recursive: true });
    mkdirSync(this.backupsDirectory, { recursive: true });

    this.connection = new Database(this.databasePath);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const existing = this.selectRow();
    if (!existing) {
      const initial = options.initialData ?? createDefaultApplicationData();
      const deterministicInitial: StoredApplicationData = {
        ...initial,
        actualTracking: {
          ...initial.actualTracking,
          deviceId: "shared-server",
        },
      };
      const { json } = serializeValidatedState(deterministicInitial);
      const now = new Date().toISOString();
      this.connection
        .prepare(
          `INSERT INTO app_state
             (id, schema_version, revision, data_json, created_at, updated_at)
           VALUES (1, ?, 1, ?, ?, ?)`,
        )
        .run(STORAGE_VERSION, json, now, now);
    } else {
      if (existing.schema_version !== STORAGE_VERSION) {
        throw new Error(
          `La base de datos usa el esquema ${existing.schema_version}; se esperaba ${STORAGE_VERSION}.`,
        );
      }
      validateApplicationState(JSON.parse(existing.data_json));
    }
  }

  private selectRow() {
    return this.connection
      .prepare(
        `SELECT id, schema_version, revision, data_json, created_at, updated_at
         FROM app_state WHERE id = 1`,
      )
      .get() as StoredStateRow | undefined;
  }

  getState(): StateSnapshot {
    const row = this.selectRow();
    if (!row) throw new Error("No existe el estado principal.");
    const data = validateApplicationState(JSON.parse(row.data_json));
    return {
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
      data,
      isInitialState: row.revision === 1,
    };
  }

  getMetadata() {
    const row = this.connection
      .prepare(
        `SELECT schema_version, revision, updated_at
         FROM app_state WHERE id = 1`,
      )
      .get() as
      | {
          schema_version: number;
          revision: number;
          updated_at: string;
        }
      | undefined;
    if (!row) throw new Error("No existe el estado principal.");
    return {
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  saveState(expectedRevision: number, value: unknown): SaveStateResult {
    const { json } = serializeValidatedState(value);
    const saveTransaction = this.connection.transaction(() => {
      const current = this.selectRow();
      if (!current) throw new Error("No existe el estado principal.");
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(
          current.revision,
          current.updated_at,
        );
      }
      const updatedAt = new Date().toISOString();
      const nextRevision = current.revision + 1;
      const result = this.connection
        .prepare(
          `UPDATE app_state
           SET schema_version = ?, revision = ?, data_json = ?, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(
          STORAGE_VERSION,
          nextRevision,
          json,
          updatedAt,
          expectedRevision,
        );
      if (result.changes !== 1) {
        const latest = this.selectRow();
        throw new RevisionConflictError(
          latest?.revision ?? expectedRevision,
          latest?.updated_at ?? updatedAt,
        );
      }
      return {
        saved: true as const,
        revision: nextRevision,
        updatedAt,
      };
    });
    return saveTransaction();
  }

  async backupTo(destination: string) {
    await this.connection.backup(resolve(destination));
  }

  close() {
    this.connection.close();
  }
}

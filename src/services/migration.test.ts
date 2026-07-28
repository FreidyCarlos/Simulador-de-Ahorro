import { describe, expect, it } from "vitest";
import { createDefaultApplicationData } from "../utils/storage";
import {
  completeLegacyMigration,
  MIGRATION_BACKUP_KEY,
  MIGRATION_COMPLETED_KEY,
  readLegacyMigrationCandidate,
  statesAreEqual,
} from "./migration";
import {
  serializeApplicationData,
  STORAGE_KEY,
  type StorageLike,
} from "../utils/storage";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("migración financiera desde localStorage", () => {
  it("ofrece datos válidos solo si SQLite sigue inicial", () => {
    const storage = new MemoryStorage();
    const data = createDefaultApplicationData();
    storage.setItem(STORAGE_KEY, serializeApplicationData(data));
    expect(readLegacyMigrationCandidate(storage, true)).toEqual(data);
    expect(readLegacyMigrationCandidate(storage, false)).toBeNull();
  });

  it("una migración inválida conserva el contenido del navegador", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{incompleto");
    expect(readLegacyMigrationCandidate(storage, true)).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBe("{incompleto");
  });

  it("no migra automáticamente: solo devuelve un candidato", () => {
    const storage = new MemoryStorage();
    const data = createDefaultApplicationData();
    const raw = serializeApplicationData(data);
    storage.setItem(STORAGE_KEY, raw);
    readLegacyMigrationCandidate(storage, true);
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(storage.getItem(MIGRATION_COMPLETED_KEY)).toBeNull();
  });

  it("al completar conserva respaldo y elimina la clave financiera activa", () => {
    const storage = new MemoryStorage();
    const data = createDefaultApplicationData();
    storage.setItem(STORAGE_KEY, serializeApplicationData(data));
    completeLegacyMigration(storage, data);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.getItem(MIGRATION_BACKUP_KEY)).toBe(
      serializeApplicationData(data),
    );
    expect(storage.getItem(MIGRATION_COMPLETED_KEY)).toBe("true");
  });

  it("no vuelve a ofrecer una migración completada", () => {
    const storage = new MemoryStorage();
    const data = createDefaultApplicationData();
    storage.setItem(STORAGE_KEY, serializeApplicationData(data));
    storage.setItem(MIGRATION_COMPLETED_KEY, "true");
    expect(readLegacyMigrationCandidate(storage, true)).toBeNull();
  });

  it("compara exactamente el estado verificado por el servidor", () => {
    const first = createDefaultApplicationData();
    const second = JSON.parse(
      serializeApplicationData(first),
    ) as typeof first;
    expect(statesAreEqual(first, second)).toBe(true);
    second.planConfiguration.scenarios[0].name = "Distinto";
    expect(statesAreEqual(first, second)).toBe(false);
  });
});

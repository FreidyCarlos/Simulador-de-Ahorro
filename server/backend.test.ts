import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../vite.config";
import { createEmptyActualRecord } from "../src/data/defaultActualTracking";
import {
  calculateActualTracking,
} from "../src/domain/actualTracking";
import { simulate } from "../src/domain/simulation";
import {
  createDefaultApplicationData,
  parseApplicationData,
  serializeApplicationData,
} from "../src/utils/storage";
import { createApp } from "./app";
import { BackupManager } from "./backup";
import { SERVER_HOST, SERVER_PORT } from "./config";
import {
  RevisionConflictError,
  StateDatabase,
} from "./database";
import {
  StateValidationError,
  validateApplicationState,
} from "./validation";

interface TestContext {
  directory: string;
  databasePath: string;
  backupsPath: string;
  database: StateDatabase;
  backups: BackupManager;
  app: ReturnType<typeof createApp>;
}

const contexts: TestContext[] = [];

const createContext = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ahorro-u-test-"));
  const databasePath = join(directory, "data", "test.sqlite");
  const backupsPath = join(directory, "backups");
  const database = new StateDatabase({
    databasePath,
    backupsDirectory: backupsPath,
  });
  const backups = new BackupManager(database);
  const context = {
    directory,
    databasePath,
    backupsPath,
    database,
    backups,
    app: createApp({ database, backups }),
  };
  contexts.push(context);
  return context;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

afterEach(() => {
  vi.restoreAllMocks();
  while (contexts.length) {
    const context = contexts.pop()!;
    try {
      context.database.close();
    } catch {
      // La prueba pudo cerrar la conexión para verificar un reinicio.
    }
    rmSync(context.directory, { recursive: true, force: true });
  }
});

describe("SQLite compartido", () => {
  it("crea la base y sus directorios", async () => {
    const context = await createContext();
    expect(existsSync(context.databasePath)).toBe(true);
    expect(existsSync(context.backupsPath)).toBe(true);
  });

  it("crea exactamente una fila activa con id 1", async () => {
    const context = await createContext();
    const observer = new Database(context.databasePath, { readonly: true });
    const rows = observer
      .prepare("SELECT id, revision FROM app_state")
      .all() as Array<{ id: number; revision: number }>;
    observer.close();
    expect(rows).toEqual([{ id: 1, revision: 1 }]);
  });

  it("inicializa de forma idempotente sin cambiar la revisión", async () => {
    const context = await createContext();
    const initial = context.database.getState();
    context.database.close();
    const reopened = new StateDatabase({
      databasePath: context.databasePath,
      backupsDirectory: context.backupsPath,
    });
    context.database = reopened;
    expect(reopened.getState().revision).toBe(initial.revision);
    expect(reopened.getState().updatedAt).toBe(initial.updatedAt);
  });

  it("lee el estado inicial oficial validado", async () => {
    const context = await createContext();
    const state = context.database.getState();
    expect(state.schemaVersion).toBe(2);
    expect(state.revision).toBe(1);
    expect(state.isInitialState).toBe(true);
    expect(state.data.planConfiguration.scenarios).toHaveLength(1);
    expect(state.data.actualTracking.deviceId).toBe("shared-server");
  });

  it("guarda un estado válido e incrementa la revisión", async () => {
    const context = await createContext();
    const state = context.database.getState();
    const changed = clone(state.data);
    changed.planConfiguration.scenarios[0].name = "Compartido";
    const saved = context.database.saveState(state.revision, changed);
    expect(saved.revision).toBe(2);
    expect(context.database.getState().data.planConfiguration.scenarios[0].name)
      .toBe("Compartido");
  });

  it("persiste después de cerrar y reabrir SQLite", async () => {
    const context = await createContext();
    const state = context.database.getState();
    const changed = clone(state.data);
    changed.planConfiguration.scenarios[0].savingsRate = 61;
    context.database.saveState(1, changed);
    context.database.close();
    const reopened = new StateDatabase({
      databasePath: context.databasePath,
      backupsDirectory: context.backupsPath,
    });
    context.database = reopened;
    expect(reopened.getState().revision).toBe(2);
    expect(reopened.getState().data.planConfiguration.scenarios[0].savingsRate)
      .toBe(61);
  });

  it("rechaza un estado incompleto", () => {
    expect(() => validateApplicationState({ version: 2 })).toThrow(
      StateValidationError,
    );
  });

  it("rechaza números no finitos", () => {
    const data = createDefaultApplicationData();
    data.planConfiguration.scenarios[0].savingsRate = Number.POSITIVE_INFINITY;
    expect(() => validateApplicationState(data)).toThrow(StateValidationError);
  });

  it("rechaza texto en campos numéricos", () => {
    const data = createDefaultApplicationData() as unknown as {
      planConfiguration: { scenarios: Array<{ savingsRate: unknown }> };
    };
    data.planConfiguration.scenarios[0].savingsRate = "50";
    expect(() => validateApplicationState(data)).toThrow(StateValidationError);
  });

  it("rechaza meses reales duplicados", () => {
    const data = createDefaultApplicationData();
    const first = createEmptyActualRecord("2026-09");
    const second = { ...createEmptyActualRecord("2026-09"), id: "second" };
    data.actualTracking.records = [first, second];
    expect(() => validateApplicationState(data)).toThrow(
      /actualTracking\.records\.month/,
    );
  });

  it("rechaza años de ingreso duplicados", () => {
    const data = createDefaultApplicationData();
    data.planConfiguration.incomes.push({
      ...data.planConfiguration.incomes[0],
      id: "duplicate-income",
    });
    expect(() => validateApplicationState(data)).toThrow(
      /planConfiguration\.incomes\.year/,
    );
  });

  it("rechaza identificadores de matrícula duplicados", () => {
    const data = createDefaultApplicationData();
    data.planConfiguration.tuitionEvents.push({
      ...data.planConfiguration.tuitionEvents[0],
      date: "2028-02",
    });
    expect(() => validateApplicationState(data)).toThrow(
      /planConfiguration\.tuitionEvents\.id/,
    );
  });

  it("rechaza timestamps inválidos", () => {
    const data = createDefaultApplicationData();
    data.planConfiguration.transfers.push({
      id: "transfer-invalid-date",
      scenarioId: data.planConfiguration.scenarios[0].id,
      date: "2026-09",
      amount: 0,
      status: "pending",
      note: "",
      createdAt: "ayer",
    });
    expect(() => validateApplicationState(data)).toThrow(
      /planConfiguration\.transfers\[0\]\.createdAt/,
    );
  });

  it("conserva el estado anterior tras una validación fallida", async () => {
    const context = await createContext();
    const before = context.database.getState();
    const invalid = clone(before.data);
    invalid.planConfiguration.scenarios[0].savingsRate = 150;
    expect(() => context.database.saveState(1, invalid)).toThrow(
      StateValidationError,
    );
    expect(context.database.getState()).toEqual(before);
  });

  it("hace la escritura condicional dentro de una transacción", async () => {
    const context = await createContext();
    const state = context.database.getState();
    const first = clone(state.data);
    first.planConfiguration.scenarios[0].name = "Cliente A";
    context.database.saveState(1, first);
    const second = clone(state.data);
    second.planConfiguration.scenarios[0].name = "Cliente B";
    expect(() => context.database.saveState(1, second)).toThrow(
      RevisionConflictError,
    );
    expect(context.database.getState().data.planConfiguration.scenarios[0].name)
      .toBe("Cliente A");
  });

  it("mantiene idénticos los resultados financieros al persistir", async () => {
    const context = await createContext();
    const data = createDefaultApplicationData();
    const idealBefore = simulate(data.planConfiguration);
    const actualBefore = calculateActualTracking(
      data.actualTracking,
      data.planConfiguration,
    );
    context.database.saveState(1, data);
    const loaded = context.database.getState().data;
    expect(simulate(loaded.planConfiguration)).toEqual(idealBefore);
    expect(
      calculateActualTracking(loaded.actualTracking, loaded.planConfiguration),
    ).toEqual(actualBefore);
  });

  it("mantiene la igualdad financiera después de reiniciar", async () => {
    const context = await createContext();
    const data = createDefaultApplicationData();
    const expected = simulate(data.planConfiguration);
    context.database.saveState(1, data);
    context.database.close();
    const reopened = new StateDatabase({
      databasePath: context.databasePath,
      backupsDirectory: context.backupsPath,
    });
    context.database = reopened;
    expect(simulate(reopened.getState().data.planConfiguration)).toEqual(
      expected,
    );
  });

  it("exportar, validar e importar reproduce el mismo estado", async () => {
    const context = await createContext();
    const source = createDefaultApplicationData();
    source.planConfiguration.scenarios[0].name = "Exportado";
    const exported = serializeApplicationData(source);
    const imported = parseApplicationData(exported);
    context.database.saveState(1, imported);
    expect(serializeApplicationData(context.database.getState().data)).toBe(
      serializeApplicationData(imported),
    );
  });
});

describe("API local", () => {
  it("health es ligero y no devuelve datos financieros", async () => {
    const { app, database } = await createContext();
    const fullState = vi.spyOn(database, "getState");
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body).toMatchObject({
      status: "ok",
      database: "connected",
      schemaVersion: 2,
      revision: 1,
    });
    expect(response.body.data).toBeUndefined();
    expect(fullState).not.toHaveBeenCalled();
  });

  it("GET /api/state devuelve el documento compartido", async () => {
    const { app } = await createContext();
    const response = await request(app).get("/api/state").expect(200);
    expect(response.body.revision).toBe(1);
    expect(response.body.data.version).toBe(2);
  });

  it("PUT /api/state guarda y devuelve la nueva revisión", async () => {
    const { app } = await createContext();
    const current = await request(app).get("/api/state");
    current.body.data.planConfiguration.scenarios[0].name = "API";
    const response = await request(app)
      .put("/api/state")
      .send({ expectedRevision: 1, data: current.body.data })
      .expect(200);
    expect(response.body).toMatchObject({ saved: true, revision: 2 });
  });

  it("devuelve la ruta exacta de un error de validación", async () => {
    const { app } = await createContext();
    const data = createDefaultApplicationData();
    data.actualTracking.startMonth = "2026-13";
    const response = await request(app)
      .put("/api/state")
      .send({ expectedRevision: 1, data })
      .expect(400);
    expect(response.body).toMatchObject({
      error: "validation_error",
      path: "actualTracking.startMonth",
    });
  });

  it("un cuerpo inválido nunca modifica SQLite", async () => {
    const context = await createContext();
    const before = context.database.getState();
    await request(context.app)
      .put("/api/state")
      .send({ expectedRevision: 1, data: { version: 2 } })
      .expect(400);
    expect(context.database.getState()).toEqual(before);
  });

  it("responde 409 cuando dos clientes escriben la misma revisión", async () => {
    const { app } = await createContext();
    const clientA = (await request(app).get("/api/state")).body;
    const clientB = (await request(app).get("/api/state")).body;
    clientA.data.planConfiguration.scenarios[0].name = "Cliente A";
    clientB.data.planConfiguration.scenarios[0].name = "Cliente B";
    await request(app)
      .put("/api/state")
      .send({ expectedRevision: clientA.revision, data: clientA.data })
      .expect(200);
    const conflict = await request(app)
      .put("/api/state")
      .send({ expectedRevision: clientB.revision, data: clientB.data })
      .expect(409);
    expect(conflict.body).toMatchObject({
      error: "revision_conflict",
      currentRevision: 2,
    });
    const final = await request(app).get("/api/state");
    expect(final.body.data.planConfiguration.scenarios[0].name).toBe(
      "Cliente A",
    );
  });

  it("dos clientes leen el mismo estado después de resolver el conflicto", async () => {
    const { app } = await createContext();
    const first = (await request(app).get("/api/state")).body;
    first.data.planConfiguration.scenarios[0].name = "Común";
    await request(app)
      .put("/api/state")
      .send({ expectedRevision: 1, data: first.data })
      .expect(200);
    const clientA = (await request(app).get("/api/state")).body;
    const clientB = (await request(app).get("/api/state")).body;
    expect(clientA).toEqual(clientB);
    expect(clientA.revision).toBe(2);
  });

  it("rechaza cuerpos superiores a 5 MB", async () => {
    const { app } = await createContext();
    const body = JSON.stringify({ value: "x".repeat(5 * 1024 * 1024) });
    const response = await request(app)
      .put("/api/state")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(413);
    expect(response.body.error).toBe("payload_too_large");
  }, 15_000);

  it("no sirve el directorio data", async () => {
    const { app } = await createContext();
    await request(app).get("/data/ahorro-u.sqlite").expect(404);
  });

  it("no sirve el directorio backups", async () => {
    const { app } = await createContext();
    await request(app).get("/backups/copia.sqlite").expect(404);
  });

  it("no habilita CORS general ni expone Express", async () => {
    const { app } = await createContext();
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "https://ejemplo.invalid")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("Respaldos y red", () => {
  it("crea un respaldo SQLite manual consistente", async () => {
    const context = await createContext();
    const result = await context.backups.create(
      new Date("2026-07-28T20:30:10.000Z"),
    );
    const path = join(context.backupsPath, result.file);
    expect(existsSync(path)).toBe(true);
    const backup = new Database(path, { readonly: true });
    const row = backup.prepare("SELECT revision FROM app_state WHERE id = 1")
      .get() as { revision: number };
    backup.close();
    expect(row.revision).toBe(1);
  });

  it("crea como máximo un respaldo automático por día", async () => {
    const context = await createContext();
    const date = new Date(2026, 6, 28, 15, 30, 0);
    expect((await context.backups.createDailyIfNeeded(date)).created).toBe(true);
    expect((await context.backups.createDailyIfNeeded(date)).created).toBe(false);
    expect(
      readdirSync(context.backupsPath).filter((file) =>
        file.startsWith("ahorro-u-2026-07-28-"),
      ),
    ).toHaveLength(1);
  });

  it("el respaldo previo conserva el estado anterior a una importación", async () => {
    const context = await createContext();
    const backupResult = await context.backups.create(
      new Date(2026, 6, 28, 15, 31, 0),
    );
    const imported = createDefaultApplicationData();
    imported.planConfiguration.scenarios[0].name = "Importado";
    context.database.saveState(1, imported);
    const backup = new Database(
      join(context.backupsPath, backupResult.file),
      { readonly: true },
    );
    const row = backup.prepare("SELECT revision, data_json FROM app_state")
      .get() as { revision: number; data_json: string };
    backup.close();
    expect(row.revision).toBe(1);
    expect(row.data_json).not.toContain("Importado");
  });

  it("el cliente no controla nombre, ruta ni extensión del respaldo", async () => {
    const context = await createContext();
    const response = await request(context.app)
      .post("/api/backups")
      .send({ file: "../controlado.txt", directory: resolve(".") })
      .expect(201);
    expect(response.body.file).toMatch(
      /^ahorro-u-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.sqlite$/,
    );
    expect(existsSync(join(context.directory, "controlado.txt"))).toBe(false);
  });

  it("Vite publica el frontend y reenvía /api al backend local", () => {
    const config = viteConfig;
    expect(config.server?.host).toBe("0.0.0.0");
    expect(config.server?.allowedHosts).toBe(true);
    expect(config.server?.proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:3001",
      changeOrigin: false,
    });
  });

  it("el backend está configurado solo en loopback y puerto 3001", () => {
    expect(SERVER_HOST).toBe("127.0.0.1");
    expect(SERVER_PORT).toBe(3001);
    const source = readFileSync(
      resolve("server", "index.ts"),
      "utf8",
    );
    expect(source).toContain("SERVER_HOST");
    expect(source).not.toContain('listen(SERVER_PORT, "0.0.0.0"');
  });
});

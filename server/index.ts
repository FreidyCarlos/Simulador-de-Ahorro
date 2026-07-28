import { resolve } from "node:path";
import { createApp } from "./app";
import { BackupManager } from "./backup";
import { SERVER_HOST, SERVER_PORT } from "./config";
import { StateDatabase } from "./database";

const database = new StateDatabase({
  databasePath: resolve("data", "ahorro-u.sqlite"),
  backupsDirectory: resolve("backups"),
});
const backups = new BackupManager(database);

try {
  await backups.createDailyIfNeeded();
} catch (error) {
  console.error(
    "No fue posible crear el respaldo diario:",
    error instanceof Error ? error.message : "error desconocido",
  );
}

const server = createApp({ database, backups }).listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Backend local disponible en http://${SERVER_HOST}:${SERVER_PORT}`);
});

const shutdown = () => {
  server.close(() => {
    database.close();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

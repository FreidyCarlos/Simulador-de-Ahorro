import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StateDatabase } from "./database";

const pad = (value: number) => String(value).padStart(2, "0");

const parts = (date: Date) => ({
  date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
});

export class BackupManager {
  constructor(private readonly database: StateDatabase) {}

  async create(now = new Date()) {
    const stamp = parts(now);
    const file = `ahorro-u-${stamp.date}-${stamp.time}.sqlite`;
    await this.database.backupTo(
      join(this.database.backupsDirectory, file),
    );
    return { created: true as const, file };
  }

  async createDailyIfNeeded(now = new Date()) {
    const { date } = parts(now);
    const prefix = `ahorro-u-${date}-`;
    const exists = existsSync(this.database.backupsDirectory)
      ? readdirSync(this.database.backupsDirectory).some(
          (file) => file.startsWith(prefix) && file.endsWith(".sqlite"),
        )
      : false;
    if (exists) return { created: false as const };
    return this.create(now);
  }
}

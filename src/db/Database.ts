import mysql, { Pool } from "mysql2/promise";

/**
 * Wrapper نازک روی connection pool.
 * همه‌ی Repositoryها از طریق این کلاس به دیتابیس وصل می‌شوند
 * تا اگر بعداً خواستیم از mysql2 به چیز دیگری کوچ کنیم، فقط همینجا تغییر کند.
 */
export class Database {
  private static instance: Database;
  public readonly pool: Pool;

  private constructor() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER ?? "root",
      password: process.env.DB_PASSWORD ?? "",
      database: process.env.DB_NAME ?? "uspto_downloader",
      waitForConnections: true,
      connectionLimit: 10,
      dateStrings: true,
    });
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

import { Database } from "./Database";
import { LogLevel } from "../types";
import { nowStamp } from "../utils/timestamp";

export class LogRepository {
  constructor(private db: Database = Database.getInstance()) {}

  async log(
    urlId: number | null,
    step: string,
    message: string,
    level: LogLevel = "info",
    fileId: number | null = null
  ): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO url_event_logs (url_id, file_id, level, step, message)
       VALUES (?, ?, ?, ?, ?)`,
      [urlId, fileId, level, step, message]
    );

    // همچنین در کنسول هم چاپ می‌کنیم تا هنگام توسعه راحت‌تر دیده شود
    //const prefix = `[url:${urlId ?? "system"}]${fileId ? `[file:${fileId}]` : ""} ${step}`;

    const prefix = `[${nowStamp()}] [url:${urlId ?? "system"}]${fileId ? `[file:${fileId}]` : ""} ${step}`;
    if (level === "error") console.error(prefix, "-", message);
    else if (level === "warning") console.warn(prefix, "-", message);
    else console.log(prefix, "-", message);

  }
}

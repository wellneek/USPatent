import { Database } from "./Database";
import { FileRecord, FileStatus, ScannedFileCandidate } from "../types";

export class FileRepository {
  constructor(private db: Database = Database.getInstance()) {}

  /**
   * فایل‌های کاندید استخراج‌شده از اسکن صفحه را ثبت می‌کند (اگر قبلا ثبت نشده باشند).
   * از UNIQUE KEY (url_id, file_name) برای جلوگیری از تکرار استفاده می‌کنیم.
   */
  async registerScannedFiles(
    urlId: number,
    candidates: ScannedFileCandidate[]
  ): Promise<void> {
    for (const c of candidates) {
      await this.db.pool.query(
        `INSERT IGNORE INTO files (url_id, file_name, expected_size_bytes, status)
         VALUES (?, ?, ?, 'registered')`,
        [urlId, c.fileName, c.expectedSizeBytes]
      );
    }
  }

  /**
 * فایل‌هایی که وسط دانلود مانده‌اند (downloading) یا قبلاً شکست خورده‌اند (failed)
 * دوباره registered می‌شوند تا در صف دانلود بیایند.
 * فایل‌های downloaded / verified_healthy دست‌نخورده می‌مانند.
 */
  async resetInterruptedFiles(urlId: number): Promise<number> {
    const [res] = await this.db.pool.query(
      `UPDATE files SET status = 'registered'
     WHERE url_id = ? AND status IN ('downloading', 'failed')`,
      [urlId]
    );
    return (res as any).affectedRows ?? 0;
  }

  async countAll(urlId: number): Promise<number> {
    const [rows] = await this.db.pool.query(
      `SELECT COUNT(*) AS total FROM files WHERE url_id = ?`,
      [urlId]
    );
    return Number((rows as any[])[0].total);
  }

  async getPendingFiles(urlId: number): Promise<FileRecord[]> {
    const [rows] = await this.db.pool.query(
      `SELECT * FROM files WHERE url_id = ? AND status = 'registered' ORDER BY id ASC`,
      [urlId]
    );
    return (rows as any[]).map(this.mapRow);
  }

  async getDownloadedFiles(urlId: number): Promise<FileRecord[]> {
    const [rows] = await this.db.pool.query(
      `SELECT * FROM files WHERE url_id = ? AND status = 'downloaded' ORDER BY id ASC`,
      [urlId]
    );
    return (rows as any[]).map(this.mapRow);
  }

  async getStatusCounts(urlId: number): Promise<Record<FileStatus, number>> {
    const result: Record<FileStatus, number> = {
      registered: 0,
      downloading: 0,
      downloaded: 0,
      verified_healthy: 0,
      size_mismatch: 0,
      failed: 0,
    };
    const [rows] = await this.db.pool.query(
      `SELECT status, COUNT(*) AS total FROM files WHERE url_id = ? GROUP BY status`,
      [urlId]
    );
    for (const row of rows as any[]) {
      result[row.status as FileStatus] = Number(row.total);
    }
    return result;
  }

  async hasDownloadingFile(urlId: number): Promise<boolean> {
    const [rows] = await this.db.pool.query(
      `SELECT 1 FROM files WHERE url_id = ? AND status = 'downloading' LIMIT 1`,
      [urlId]
    );
    return (rows as any[]).length > 0;
  }

  /** بعد از مرگ ناگهانی برنامه: فایل‌های گیرکرده در downloading را آزاد می‌کند */
  async resetInterruptedDownloads(): Promise<number> {
    const [result] = await this.db.pool.query(
      `UPDATE files SET status = 'registered' WHERE status = 'downloading'`
    );
    return (result as any).affectedRows ?? 0;
  }

  async updateStatus(fileId: number, status: FileStatus): Promise<void> {
    await this.db.pool.query(`UPDATE files SET status = ? WHERE id = ?`, [
      status,
      fileId,
    ]);
  }

  async setDownloadResult(
    fileId: number,
    downloadedPath: string,
    actualSizeBytes: number
  ): Promise<void> {
    await this.db.pool.query(
      `UPDATE files
       SET downloaded_path = ?, actual_size_bytes = ?, status = 'downloaded'
       WHERE id = ?`,
      [downloadedPath, actualSizeBytes, fileId]
    );
  }

  private mapRow(row: any): FileRecord {
    return {
      id: row.id,
      urlId: row.url_id,
      fileName: row.file_name,
      expectedSizeBytes: row.expected_size_bytes,
      actualSizeBytes: row.actual_size_bytes,
      downloadedPath: row.downloaded_path,
      status: row.status,
    };
  }
}

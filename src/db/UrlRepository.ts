import { Database } from "./Database";
import { UrlJob, UrlJobStatus } from "../types";

export class UrlRepository {
    constructor(private db: Database = Database.getInstance()) {}

    async getById(id: number): Promise<UrlJob | null> {
        const [rows] = await this.db.pool.query(
            `SELECT * FROM urls WHERE id = ?`,
            [id]
        );
        const list = rows as any[];
        return list.length ? this.mapRow(list[0]) : null;
    }

    /**
     * جاب بعدی که باید پردازش شود.
     * اولویت با jobهای نیمه‌کاره (paused) است، بعد draft؛ داخل هر گروه قدیمی‌تر اول.
     */
    async getNextRunnableJob(): Promise<UrlJob | null> {
        const [rows] = await this.db.pool.query(
            `SELECT * FROM urls
             WHERE status IN ('paused', 'processing', 'scanning', 'draft')
             ORDER BY FIELD(status, 'paused', 'processing', 'scanning', 'draft'),
                      created_at ASC, id ASC
                 LIMIT 1`
        );
        const list = rows as any[];
        return list.length ? this.mapRow(list[0]) : null;
    }

    // async getNextRunnableJob(): Promise<UrlJob | null> {
    //     const [rows] = await this.db.pool.query(
    //         `SELECT * FROM urls
    //          WHERE status IN ('paused', 'draft')
    //          ORDER BY (status = 'paused') DESC, created_at ASC
    //              LIMIT 1`
    //     );
    //     const list = rows as any[];
    //     return list.length ? this.mapRow(list[0]) : null;
    // }

    /** جاب بعدی که باید پردازش شود (status = draft) */
    async getNextDraftJob(): Promise<UrlJob | null> {
        const [rows] = await this.db.pool.query(
            `SELECT * FROM urls WHERE status = 'draft' ORDER BY created_at ASC LIMIT 1`
        );
        const list = rows as any[];
        return list.length ? this.mapRow(list[0]) : null;
    }

    /**
     * جاب بعدی برای پردازش، با اولویت:
     * processing (نیمه‌کاره) > scanning (نیمه‌کاره) > draft (جدید)
     * داخل هر گروه، قدیمی‌ترین اول.
     */
    async getNextJobToProcess(): Promise<UrlJob | null> {
        const [rows] = await this.db.pool.query(
            `SELECT * FROM urls
     WHERE status IN ('processing', 'scanning', 'draft')
     ORDER BY FIELD(status, 'processing', 'scanning', 'draft'),
              created_at ASC, id ASC
     LIMIT 1`
        );
        const list = rows as any[];
        return list.length ? this.mapRow(list[0]) : null;
    }

    /** آخرین جابی که هنوز در حال پردازش است - برای keep-alive استفاده می‌شود */
    async getActiveProcessingJob(): Promise<UrlJob | null> {
        const [rows] = await this.db.pool.query(
            `SELECT * FROM urls WHERE status = 'processing' ORDER BY processing_started_at DESC LIMIT 1`
        );
        const list = rows as any[];
        return list.length ? this.mapRow(list[0]) : null;
    }

    async updateStatus(id: number, status: UrlJobStatus): Promise<void> {
        const timestampColumn =
            status === "scanning" || status === "processing"
                ? ", processing_started_at = COALESCE(processing_started_at, NOW())"
                : status === "downloaded"
                    ? ", download_finished_at = NOW()"
                    : "";

        await this.db.pool.query(
            `UPDATE urls SET status = ? ${timestampColumn} WHERE id = ?`,
            [status, id]
        );
    }

    /** بعد از مرگ ناگهانی برنامه: jobهای نیمه‌کاره را به paused برمی‌گرداند (نه draft) تا اولویتشان حفظ شود */
    async resetInterruptedJobs(): Promise<number> {
        const [result] = await this.db.pool.query(
            `UPDATE urls SET status = 'paused' WHERE status IN ('scanning', 'processing')`
        );
        return (result as any).affectedRows ?? 0;
    }

    async setFilesFoundCount(id: number, count: number): Promise<void> {
        await this.db.pool.query(
            `UPDATE urls SET files_found_count = ? WHERE id = ?`,
            [count, id]
        );
    }

    async incrementDownloadedFilesCount(id: number): Promise<void> {
        await this.db.pool.query(
            `UPDATE urls SET downloaded_files_count = downloaded_files_count + 1 WHERE id = ?`,
            [id]
        );
    }

    async syncDownloadedFilesCount(id: number): Promise<void> {
        await this.db.pool.query(
            `UPDATE urls
             SET downloaded_files_count = (
                 SELECT COUNT(*) FROM files
                 WHERE url_id = ? AND status IN ('downloaded', 'verified_healthy')
             )
             WHERE id = ?`,
            [id, id]
        );
    }

    private mapRow(row: any): UrlJob {
        return {
            id: row.id,
            dbType: row.db_type,
            dateFrom: row.date_from,
            dateTo: row.date_to,
            url: row.url,
            extensionsToDownload: String(row.extensions_to_download)
                .split(",")
                .map((s) => s.trim()),
            excludePatternRegex: row.exclude_pattern_regex,
            filesFoundCount: row.files_found_count,
            downloadedFilesCount: row.downloaded_files_count,
            status: row.status,
            createdAt: row.created_at,
            processingStartedAt: row.processing_started_at,
            downloadFinishedAt: row.download_finished_at,
        };
    }
}
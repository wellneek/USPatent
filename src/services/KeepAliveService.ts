import { BrowserContext } from "playwright";
import { UrlRepository } from "../db/UrlRepository";
import { LogRepository } from "../db/LogRepository";
import { FileRepository } from "../db/FileRepository";

export class KeepAliveService {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private pingInFlight = false;

    constructor(
        private context: BrowserContext,
        private urlRepo: UrlRepository,
        private fileRepo: FileRepository,
        private logRepo: LogRepository,
        private intervalMs: number = 4 * 60 * 1000,
        private pingUrl: string = "https://data.uspto.gov/"
    ) {}

    start(): void {
        if (this.intervalHandle) return;
        this.intervalHandle = setInterval(() => {
            this.pingIfDownloadInProgress().catch((err) =>
                console.error("Keep-alive ping error:", err)
            );
        }, this.intervalMs);
        this.intervalHandle.unref?.();
    }

    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    private async pingIfDownloadInProgress(): Promise<void> {
        if (this.pingInFlight) return;

        const activeJob = await this.urlRepo.getActiveProcessingJob();
        if (!activeJob) return;
        if (!(await this.fileRepo.hasDownloadingFile(activeJob.id))) return;

        this.pingInFlight = true;
        try {
            const res = await this.context.request.get(this.pingUrl, {
                timeout: 30_000,
                failOnStatusCode: false,
            });

            await this.logRepo.log(
                activeJob.id,
                "KEEP_ALIVE_PING",
                `keep-alive sent (status ${res.status()})`,
                res.ok() ? "info" : "warning"
            );
        } catch (err) {
            await this.logRepo.log(
                activeJob.id,
                "KEEP_ALIVE_PING_FAILED",
                `keep-alive error: ${(err as Error).message}`,
                "warning"
            );
        } finally {
            this.pingInFlight = false;
        }
    }
}
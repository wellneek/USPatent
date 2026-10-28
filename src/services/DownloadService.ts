import { Page, BrowserContext, Locator, Download } from "playwright";
import fs from "fs/promises";
import path from "path";
import { FileRecord, UrlJob } from "../types";
import { FileRepository } from "../db/FileRepository";
import { UrlRepository } from "../db/UrlRepository";
import { LogRepository } from "../db/LogRepository";
import { CaptchaService } from "./CaptchaService";
import { DownloadMonitor, formatBytes, formatDuration } from "./DownloadMonitor";
import {BrowserDiedError, isBrowserClosedError} from "../utils/browserErrors";
import { StopController } from "../utils/StopController";
import { nowStamp } from "../utils/timestamp";
import { AuthService } from "./AuthService";

const ADOPT_TOLERANCE_BYTES = 200 * 1024;

export interface DownloadServiceOptions {
    downloadDir: string;
    /** Same downloadsPath we gave to Playwright */
    incomingDir: string;
    perFileTimeoutMs: number;
    stallTimeoutMs?: number;
    delayBetweenFilesMs?: number;
}

export class DownloadService {
    private monitor: DownloadMonitor;

    constructor(
        private fileRepo: FileRepository,
        private urlRepo: UrlRepository,
        private logRepo: LogRepository,
        private captchaService: CaptchaService,
        private authService: AuthService,
        private options: DownloadServiceOptions,
        private stopController: StopController = new StopController(null)
    ) {
        this.monitor = new DownloadMonitor(options.incomingDir);
    }

    /**
     * "completed": queue fully processed. "stopped": some files still registered due to graceful stop.
     * Stop is only checked "before start" of each file; in-progress download always runs to completion.
     */
    async downloadPendingFiles(page: Page, context: BrowserContext, job: UrlJob): Promise<"completed" | "stopped"> {
        const pending = await this.fileRepo.getPendingFiles(job.id);
        const delayBetweenFilesMs = this.options.delayBetweenFilesMs ?? 5000;

        await this.logRepo.log(
            job.id,
            "DOWNLOAD_QUEUE_STARTED",
            `Starting sequential download of ${pending.length} files (one by one)`
        );

        for (let i = 0; i < pending.length; i++) {
            const stopReason = this.stopController.reason();
            if (stopReason) {
                await this.logRepo.log(
                    job.id,
                    "DOWNLOAD_QUEUE_STOPPED",
                    `Download queue stopped before file ${i + 1}/${pending.length} (${stopReason}). Remaining files will continue later.`,
                    "warning"
                );
                return "stopped";
            }

            const file = pending[i];

            if (await this.adoptIfAlreadyOnDisk(job, file)) continue;

            console.log(
                `\n[${nowStamp()}] 📦 [${i + 1}/${pending.length}] Starting download: ${file.fileName}` +
                (file.expectedSizeBytes ? ` (${formatBytes(file.expectedSizeBytes)})` : "")
            );

            await this.downloadOneFile(page, context, job, file);

            if (i < pending.length - 1) await sleep(delayBetweenFilesMs);
        }

        await this.urlRepo.syncDownloadedFilesCount(job.id);

        await this.logRepo.log(job.id, "DOWNLOAD_QUEUE_FINISHED", "Download queue for this URL finished");
        return "completed";
    }

    private async adoptIfAlreadyOnDisk(job: UrlJob, file: FileRecord): Promise<boolean> {
        if (file.expectedSizeBytes == null) return false;

        const finalPath = path.join(this.options.downloadDir, path.basename(file.fileName));
        let size: number;
        try {
            size = (await fs.stat(finalPath)).size;
        } catch {
            return false;
        }

        if (Math.abs(size - file.expectedSizeBytes) > ADOPT_TOLERANCE_BYTES) return false;

        await this.fileRepo.setDownloadResult(file.id, finalPath, size);
        await this.logRepo.log(
            job.id,
            "DOWNLOAD_SKIPPED_ALREADY_ON_DISK",
            `File ${file.fileName} already existed on disk; skipped re-download`,
            "info",
            file.id
        );
        console.log(`[${nowStamp()}]    ⏭️  Skipped (already downloaded): ${file.fileName}`);
        return true;
    }

    private async downloadOneFile(
        page: Page,
        context: BrowserContext,
        job: UrlJob,
        file: FileRecord
    ): Promise<void> {

        await this.authService.ensureLoggedIn(page, job.id);

        await this.logRepo.log(job.id, "DOWNLOAD_REQUEST", `Download requested: ${file.fileName}`, "info", file.id);
        await this.fileRepo.updateStatus(file.id, "downloading");

        await this.cleanIncomingDir();
        await this.ensureListPageReady(page, job);

        const waiter = this.armDownloadWaiter(context);
        let download: Download | null = null;

        try {
            const trigger = await this.findRowLinkByExactFileName(page, file.fileName);
            if (!trigger) throw new Error(`Row for file ${file.fileName} not found in table`);

            await trigger.click();

            const captchaOutcome = await this.captchaService.resolveIfPresent(page, job.id, file.id);
            if (captchaOutcome === "skipped") {
                await this.fileRepo.updateStatus(file.id, "failed");
                await this.logRepo.log(
                    job.id,
                    "DOWNLOAD_ABORTED_CAPTCHA_SKIPPED",
                    `Captcha for file ${file.fileName} was not solved; skipped`,
                    "warning",
                    file.id
                );
                return;
            }

            download = await withTimeout(
                waiter.promise,
                120_000,
                "Chrome did not start any download (click may have failed or download was blocked)"
            );

            await this.logRepo.log(job.id, "DOWNLOAD_STARTED", `Download started: ${download.suggestedFilename()}`, "info", file.id);

            let lastLoggedBucket = -1;
            const tempPath = await this.monitor.trackUntilComplete(download.path(), {
                expectedSizeBytes: file.expectedSizeBytes ?? null,
                pollIntervalMs: 3000,
                stallTimeoutMs: this.options.stallTimeoutMs ?? 10 * 60 * 1000,
                overallTimeoutMs: this.options.perFileTimeoutMs,
                onProgress: async (s) => {
                    process.stdout.write(
                        `\r[${nowStamp()}]    ⬇️  ${s.percent !== null ? s.percent.toFixed(1) + "%" : "?"} | ` +
                        `${formatBytes(s.bytesDownloaded)}` +
                        `${file.expectedSizeBytes ? " / " + formatBytes(file.expectedSizeBytes) : ""} | ` +
                        `${formatBytes(s.speedBytesPerSec)}/s | ` +
                        `ETA ${s.etaSeconds !== null ? formatDuration(s.etaSeconds) : "?"}   `
                    );
                    if (s.percent !== null) {
                        const bucket = Math.floor(s.percent / 10) * 10;
                        if (bucket > lastLoggedBucket) {
                            lastLoggedBucket = bucket;
                            await this.logRepo.log(
                                job.id,
                                "DOWNLOAD_PROGRESS",
                                `${file.fileName}: ${bucket}% (${formatBytes(s.bytesDownloaded)})`,
                                "info",
                                file.id
                            );
                        }
                    }
                },
            });
            process.stdout.write("\n");

            const failure = await download.failure();
            if (failure) throw new Error(`Download failed: ${failure}`);

            const finalPath = path.join(this.options.downloadDir, path.basename(file.fileName));
            await fs.rm(finalPath, { force: true });
            await fs.rename(tempPath, finalPath);

            const actualSize = (await fs.stat(finalPath)).size;
            await this.fileRepo.setDownloadResult(file.id, finalPath, actualSize);
            await this.urlRepo.incrementDownloadedFilesCount(job.id);

            console.log(`[${nowStamp()}]    ✅ Completed: ${finalPath} (${formatBytes(actualSize)})`);
            await this.logRepo.log(
                job.id,
                "DOWNLOAD_COMPLETED",
                `File downloaded: ${finalPath} (${actualSize} bytes)`,
                "info",
                file.id
            );
        } catch (err) {
            process.stdout.write("\n");

            if (isBrowserClosedError(err)) {
                await this.fileRepo.updateStatus(file.id, "registered");
                await this.logRepo.log(
                    job.id, "BROWSER_DIED",
                    `Browser died during download of ${file.fileName}; file released for retry`,
                    "error", file.id
                );
                throw new BrowserDiedError((err as Error).message);
            }

            await download?.cancel().catch(() => {});
            await this.fileRepo.updateStatus(file.id, "failed");
            await this.logRepo.log(
                job.id,
                "DOWNLOAD_ERROR",
                `Error downloading ${file.fileName}: ${(err as Error).message}`,
                "error",
                file.id
            );
            console.error(`[${nowStamp()}]    ❌ ${file.fileName}: ${(err as Error).message}`);
            console.error(
                `[${nowStamp()}]    🔎 tabs:`,
                context.pages().map((p) => `${p.isClosed() ? "closed" : p.url()}`)
            );

        } finally {
            waiter.dispose();
        }
    }

    /**
     * Waits for the download event on all current tabs and tabs opened from this moment
     * (BrowserContext does not have a download event, only Page does).
     */
    private armDownloadWaiter(context: BrowserContext): {
        promise: Promise<Download>;
        dispose: () => void;
    } {
        let resolve!: (d: Download) => void;
        const promise = new Promise<Download>((res) => (resolve = res));

        const onDownload = (d: Download) => resolve(d);
        const attach = (p: Page) => p.on("download", onDownload);

        context.pages().forEach(attach);
        context.on("page", attach);

        return {
            promise,
            dispose: () => {
                context.off("page", attach);
                context.pages().forEach((p) => p.off("download", onDownload));
            },
        };
    }

    private async cleanIncomingDir(): Promise<void> {
        const dir = this.options.incomingDir;
        for (const entry of await fs.readdir(dir).catch(() => [] as string[])) {
            await fs.rm(path.join(dir, entry), { force: true, recursive: true }).catch(() => {});
        }
    }

    private async ensureListPageReady(page: Page, job: UrlJob): Promise<void> {
        for (const p of page.context().pages()) {
            if (p !== page && !p.isClosed() && p.url() === "about:blank") {
                await p.close().catch(() => { });
            }
        }

        await page.bringToFront();

        const rowSelector = "table.p-datatable-table tbody tr";
        const hasRows = (await page.locator(rowSelector).count().catch(() => 0)) > 0;

        if (!page.url().startsWith(job.url) || !hasRows) {
            await this.logRepo.log(job.id, "LIST_PAGE_RELOAD", "Re-opening the files list page");
            await page.goto(job.url, { waitUntil: "networkidle" });
            await page.locator(rowSelector).first().waitFor({ state: "visible", timeout: 60_000 });
        }
    }

    private async findRowLinkByExactFileName(page: Page, fileName: string): Promise<Locator | null> {
        const rowSelector = "table.p-datatable-table tbody tr";
        const nextSelector = ".p-paginator-next:not(.p-disabled)";

        const firstBtn = page.locator(".p-paginator-first:not(.p-disabled)");
        if (await firstBtn.count() > 0) {
            await firstBtn.click();
            await page.waitForTimeout(500);
        }

        while (true) {
            const link = page
                .locator(rowSelector)
                .locator("td:first-child a")
                .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(fileName)}\\s*$`) })
                .first();

            if (await link.count() > 0) return link;

            const next = page.locator(nextSelector);
            if ((await next.count()) === 0) return null;

            await next.click();
            await page.waitForLoadState("networkidle").catch(() => { });
            await page.waitForTimeout(500);
        }
    }
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(message)), ms);
        p.then(
            (v) => { clearTimeout(t); resolve(v); },
            (e) => { clearTimeout(t); reject(e); }
        );
    });
}
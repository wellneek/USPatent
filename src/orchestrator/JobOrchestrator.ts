import { Page, BrowserContext } from "playwright";
import { AccountRepository } from "../db/AccountRepository";
import { UrlRepository } from "../db/UrlRepository";
import { FileRepository } from "../db/FileRepository";
import { LogRepository } from "../db/LogRepository";
import { AuthService } from "../services/AuthService";
import { CaptchaService } from "../services/CaptchaService";
import { ScannerService } from "../services/ScannerService";
import { DownloadService } from "../services/DownloadService";
import { HealthCheckService } from "../services/HealthCheckService";
import { KeepAliveService } from "../services/KeepAliveService";
import { StopController } from "../utils/StopController";
import { BrowserDiedError, PageLoadTimeoutError, isBrowserClosedError } from "../utils/browserErrors";

export class JobOrchestrator {
    constructor(
        private page: Page,
        private context: BrowserContext,
        private accountRepo: AccountRepository,
        private urlRepo: UrlRepository,
        private fileRepo: FileRepository,
        private logRepo: LogRepository,
        private authService: AuthService,
        private captchaService: CaptchaService,
        private scannerService: ScannerService,
        private downloadService: DownloadService,
        private healthCheckService: HealthCheckService,
        private keepAliveService: KeepAliveService,
        private jobPollIntervalMs: number = 30_000,
        private stopController: StopController = new StopController(null)
    ) {
    }

    async run(): Promise<void> {
        // If we must stop right now, do not log in at all
        if (await this.shouldExit("startup")) return;

        await this.recoverInterruptedState();
        await this.ensureLoggedIn();
        let shouldRecheckAuthentication = false;

        while (true) {
            // Safe boundary 1: before picking the next job (or entering idle)
            if (await this.shouldExit("before next job")) return;

            const job = await this.urlRepo.getNextRunnableJob();
            if (!job) {
                console.log(
                    `Waiting for new work... rechecking in ${Math.round(this.jobPollIntervalMs / 1000)}s`
                );
                shouldRecheckAuthentication = true;
                await this.waitForNextPoll();
                continue;
            }

            // Session may have been logged out during a long wait.
            if (shouldRecheckAuthentication) {
                await this.ensureLoggedIn();
                shouldRecheckAuthentication = false;
            }

            // Start keep-alive service before starting a long download
            this.keepAliveService.start();

            try {
                await this.urlRepo.updateStatus(job.id, "scanning");
                const candidates = await this.scannerService.scan(this.page, job);

                await this.urlRepo.setFilesFoundCount(job.id, candidates.length);
                await this.fileRepo.registerScannedFiles(job.id, candidates);

                await this.urlRepo.updateStatus(job.id, "processing");
                const result = await this.downloadService.downloadPendingFiles(this.page, this.context, job);

                if (result === "stopped") {
                    // Remaining files are still registered; job moves to paused so next time it resumes first
                    await this.urlRepo.syncDownloadedFilesCount(job.id);
                    await this.urlRepo.updateStatus(job.id, "paused");
                    await this.logRepo.log(
                        job.id,
                        "JOB_PAUSED",
                        "Job paused due to graceful stop; will resume with top priority next time",
                        "warning"
                    );
                    return;
                }

                await this.urlRepo.updateStatus(job.id, "downloaded");

                // Health check for downloaded files
                /*const pendingForHealthCheck = await this.fileRepo.getPendingFiles(job.id);
                for (const file of pendingForHealthCheck) {
                    await this.healthCheckService.checkFile(file, job.id);
                }
                await this.urlRepo.updateStatus(job.id, "verified");
                */

            } catch (error) {

                if (
                    error instanceof BrowserDiedError ||
                    error instanceof PageLoadTimeoutError ||
                    isBrowserClosedError(error)
                ) {
                    throw error; // Exit program so runner can clean profile and restart
                }

                await this.logRepo.log(job.id, "JOB_ERROR", `URL processing stopped: ${(error as Error).message}`, "error");
                // Job started but not finished; retry with top priority
                await this.urlRepo.updateStatus(job.id, "paused");

                if (error instanceof BrowserDiedError || isBrowserClosedError(error)) {
                    throw error; // Exit program so supervisor restarts it
                }
                await this.waitForNextPoll(); // Prevent tight loop on other errors
            } finally {
                this.keepAliveService.stop();
            }
        }
    }

    /** Wait in 1s chunks so we wake up fast when a signal arrives / window ends */
    private async waitForNextPoll(): Promise<void> {
        const deadline = Date.now() + this.jobPollIntervalMs;
        while (Date.now() < deadline && !this.stopController.reason()) {
            await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
        }
    }

    private async shouldExit(where: string): Promise<boolean> {
        const reason = this.stopController.reason();
        if (!reason) return false;
        await this.logRepo.log(null, "APP_STOPPING", `Graceful exit (${where}): ${reason}`, "info");
        return true;
    }

    /**
     * If a previous instance died unexpectedly (kill -9, power loss, ...), jobs/files
     * remain in scanning/processing/downloading. Since cron with flock runs only one
     * instance, this reset is safe.
     */
    private async recoverInterruptedState(): Promise<void> {
        const jobs = await this.urlRepo.resetInterruptedJobs();
        const files = await this.fileRepo.resetInterruptedDownloads();
        if (jobs > 0 || files > 0) {
            await this.logRepo.log(
                null,
                "RECOVERED_INTERRUPTED_STATE",
                `Recovery after unexpected shutdown: ${jobs} jobs -> paused, ${files} files -> registered`,
                "warning"
            );
        }
    }

    /**
     * Checks if we are already logged in; if not, picks the highest-priority account
     * and runs the three-step login process.
     */
    private async ensureLoggedIn(): Promise<void> {
        // 👇 تغییر مهم: استفاده از domcontentloaded به جای networkidle برای رفع خطای Timeout
        await this.page.goto(this.authService.homeUrl, { waitUntil: "domcontentloaded" });

        if (await this.authService.isLoggedIn(this.page)) {
            console.log("✅ Already logged in.");
            return;
        }

        const account = await this.accountRepo.pickNextAvailableAccount();
        if (!account) {
            throw new Error("No active account found for login.");
        }

        // Real URL id is not available here (no job picked yet),
        // so we pass urlId=null, which is logged in url_event_logs as a global system event.
        const success = await this.authService.login(this.page, account, null);
        if (!success) {
            throw new Error(`Login with account ${account.username} failed.`);
        }
    }
}
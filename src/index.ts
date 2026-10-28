import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs/promises";

import { Database } from "./db/Database";
import { AccountRepository } from "./db/AccountRepository";
import { UrlRepository } from "./db/UrlRepository";
import { FileRepository } from "./db/FileRepository";
import { LogRepository } from "./db/LogRepository";

import { AuthService } from "./services/AuthService";
import { MathOcrSolver } from "./services/MathOcrSolver";
import { CaptchaService } from "./services/CaptchaService";
import { ScannerService } from "./services/ScannerService";
import { DownloadService } from "./services/DownloadService";
import { HealthCheckService } from "./services/HealthCheckService";
import { KeepAliveService } from "./services/KeepAliveService";
import { JobOrchestrator } from "./orchestrator/JobOrchestrator";
import { config } from "./config";
import { UsptoPageAdapter } from "./site/UsptoPageAdapter";
import { StopController, parseStopHours } from "./utils/StopController";

// مسیر Chrome نصب‌شده روی ویندوز (از .env قابل override است)
const CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE?.trim() || "C:\\Chrome-bin\\chrome.exe";

async function main() {
    // اگر STOP_HOURS نامعتبر باشد همین‌جا خطا می‌دهد (قبل از باز شدن مرورگر)
    const stopController = new StopController(parseStopHours(config.stopHours));
    stopController.installSignalHandlers();

    // خارج از ساعت مجاز: بدون باز کردن مرورگر/دیتابیس منتظر می‌مانیم تا زمان اجرا برسد.
    const canProceed = await stopController.waitUntilRunnable();
    if (!canProceed) {
        return;
    }

    // --- دیتابیس ---
    const database = Database.getInstance();
    await database.pool.query("SELECT 1");
    await fs.mkdir(config.downloadDir, { recursive: true });

    const accountRepo = new AccountRepository();
    const urlRepo = new UrlRepository();
    const fileRepo = new FileRepository();
    const logRepo = new LogRepository();

    await fs.mkdir(config.downloadDir, { recursive: true });
    await fs.mkdir(config.incomingDir, { recursive: true });

    // پروفایل Chromium (همان مسیری که runner.ts قبل از هر اجرا پاک می‌کند)
    await fs.mkdir(config.browserProfileDir, { recursive: true });

    const context = await chromium.launchPersistentContext(config.browserProfileDir, {
        executablePath: CHROME_EXECUTABLE,
        headless: config.headless,
        acceptDownloads: true,
        downloadsPath: config.incomingDir,

        // 👇 ۱. نادیده گرفتن Content Security Policy
        bypassCSP: true,

        // 👇 ۲. آرگومان‌های دور زدن محدودیت CORS و مخفی کردن حالت خودکارسازی
        args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox', // جلوگیری از خطای sandbox در ویندوز
        ],
        ignoreDefaultArgs: ['--enable-automation'], // حذف پیام "Chrome is being controlled by automated test software"

        // اعمال Agent و هدرها (از config)
        userAgent: config.customHeaders["User-Agent"],
        extraHTTPHeaders: config.customHeaders,

        viewport: { width: 1024, height: 768 },
        locale: "en-US",
        timeout: 60_000,
    });

    const page = context.pages()[0] ?? (await context.newPage());

    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);

    const site = new UsptoPageAdapter();
    const captchaService = new CaptchaService(logRepo, new MathOcrSolver(60));
    const authService = new AuthService(
        accountRepo,
        logRepo,
        captchaService,
        site,
        config.homeUrl
    );
    const scannerService = new ScannerService(captchaService, logRepo);
    const downloadService = new DownloadService(
        fileRepo,
        urlRepo,
        logRepo,
        captchaService,
        authService,
        {
            downloadDir: config.downloadDir,
            incomingDir: config.incomingDir,
            perFileTimeoutMs: config.perFileTimeoutMs,
            stallTimeoutMs: 10 * 60 * 1000,
            delayBetweenFilesMs: 5000,
        },
        stopController
    );
    const healthCheckService = new HealthCheckService(
        fileRepo,
        logRepo,
        config.healthToleranceBytes
    );
    const keepAliveService = new KeepAliveService(
        context,
        urlRepo,
        fileRepo,
        logRepo,
        config.keepAliveIntervalMs
    );

    const orchestrator = new JobOrchestrator(
        page,
        context,
        accountRepo,
        urlRepo,
        fileRepo,
        logRepo,
        authService,
        captchaService,
        scannerService,
        downloadService,
        healthCheckService,
        keepAliveService,
        config.jobPollIntervalMs,
        stopController
    );

    try {
        await orchestrator.run();
    } catch (e) {
        console.error("Error running job:", e);
        process.exitCode = 1;
    } finally {
        await captchaService.dispose();
        await context.close();
        await database.close();
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
        console.error("Fatal program error:", err);
        process.exit(1);
    });
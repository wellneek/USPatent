import path from "path";

function positiveNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
    homeUrl: process.env.USPTO_HOME_URL ?? "https://data.uspto.gov/home",
    downloadDir: path.resolve(process.env.DOWNLOAD_DIR ?? "_download"),
    incomingDir: path.resolve(process.env.DOWNLOAD_DIR ?? "_download", ".incoming"),
    browserProfileDir: path.resolve(
        process.env.BROWSER_PROFILE_DIR ?? ".browser-profile"
    ),
    browserExtensionPath: path.resolve(
        process.env.BROWSER_EXTENSION_DIR ?? ".browser-extensions"
    ),
    captchaOperatorWaitMs: positiveNumber(
        process.env.CAPTCHA_OPERATOR_WAIT_MS,
        5 * 60 * 1000 // ۵ دقیقه
    ),
    captchaOcrAutoAcceptConfidence: positiveNumber(
        process.env.CAPTCHA_OCR_AUTO_ACCEPT_CONFIDENCE,
        10
    ),
    headless: process.env.HEADLESS === "true",
    perFileTimeoutMs: positiveNumber(
        process.env.PER_FILE_TIMEOUT_MS,
        75 * 60 * 1000
    ),
    keepAliveIntervalMs: positiveNumber(
        process.env.KEEP_ALIVE_INTERVAL_MS,
        4 * 60 * 1000
    ),
    jobPollIntervalMs: positiveNumber(
        process.env.JOB_POLL_INTERVAL_MS,
        30 * 1000
    ),
    healthToleranceBytes: positiveNumber(
        process.env.HEALTH_TOLERANCE_BYTES,
        200 * 1024
    ),

    /** بازه‌ی توقف مثل "7-18". خالی = هیچ‌وقت توقف نداشته باش */
    stopHours: process.env.STOP_HOURS ?? "",

    // 👇 اضافه کردن هدرهای سفارشی مرورگر
    customHeaders: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
        "sec-ch-ua-platform": '"Linux"', // تکمیل‌کننده هویت لینوکس
        "sec-ch-ua-mobile": "?0", // نشان‌دهنده دسکتاپ بودن
    },
};
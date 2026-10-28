/**
 * کنترل توقف نرم (graceful) برنامه.
 *
 * دو دلیل برای توقف وجود دارد:
 *  ۱) رسیدن به «بازه‌ی توقف» (env: STOP_HOURS مثل "7-18")
 *  ۲) دریافت سیگنال SIGTERM/SIGINT (مثلا pkill بدون -9)
 *
 * توقف هیچ‌وقت دانلود در حال انجام را قطع نمی‌کند؛ فقط در «مرزهای امن»
 * (قبل از شروع فایل بعدی / job بعدی) چک می‌شود.
 */

export interface StopWindow {
    startMin: number; // دقیقه از ابتدای روز
    endMin: number;
    raw: string;
}

/** "7-18" یا "7:30-18:00" -> StopWindow. مقدار خالی -> null (یعنی هیچ‌وقت توقف نداشته باش) */
export function parseStopHours(raw: string | undefined | null): StopWindow | null {
    const value = raw?.trim();
    if (!value) return null;

    const toMinutes = (part: string): number => {
        const m = part.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (!m) throw new Error(`STOP_HOURS نامعتبر است: "${value}" (نمونه‌ی درست: 7-18)`);
        const h = Number(m[1]);
        const min = Number(m[2] ?? 0);
        if (h > 24 || min > 59 || (h === 24 && min > 0)) {
            throw new Error(`STOP_HOURS نامعتبر است: "${value}"`);
        }
        return (h % 24) * 60 + min;
    };

    const parts = value.split("-");
    if (parts.length !== 2) {
        throw new Error(`STOP_HOURS نامعتبر است: "${value}" (نمونه‌ی درست: 7-18)`);
    }
    const startMin = toMinutes(parts[0]);
    const endMin = toMinutes(parts[1]);
    if (startMin === endMin) {
        throw new Error(`STOP_HOURS نامعتبر است: ابتدا و انتها نمی‌توانند یکی باشند ("${value}")`);
    }
    return { startMin, endMin, raw: value };
}

export function isInStopWindow(window: StopWindow | null, now: Date = new Date()): boolean {
    if (!window) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    const { startMin, endMin } = window;
    return startMin < endMin
        ? cur >= startMin && cur < endMin
        : cur >= startMin || cur < endMin; // بازه‌ای که از نیمه‌شب عبور می‌کند
}

export class StopController {
    private signalReceived: string | null = null;

    constructor(private window: StopWindow | null) {}

    /** اولین سیگنال: توقف نرم. سیگنال دوم: خروج فوری. */
    installSignalHandlers(): void {
        const handler = (rawSignal: unknown) => {
            const signal = String(rawSignal);
            if (this.signalReceived) {
                console.warn(`\n⛔ سیگنال ${signal} دوباره دریافت شد؛ خروج فوری.`);
                process.exit(130);
            }
            this.signalReceived = signal;
            console.warn(
                `\n🛑 سیگنال ${signal} دریافت شد. دانلود جاری تا پایان ادامه می‌یابد و بعد برنامه خارج می‌شود ` +
                `(برای خروج فوری یک‌بار دیگر بفرست).`
            );
        };
        process.on("SIGTERM", handler);
        process.on("SIGINT", handler);
    }

    /** اگر باید متوقف شویم دلیلش را برمی‌گرداند، وگرنه null */
    reason(now: Date = new Date()): string | null {
        if (this.signalReceived) return `سیگنال ${this.signalReceived} دریافت شده است`;
        if (isInStopWindow(this.window, now)) {
            return `ساعت فعلی در بازه‌ی توقف (${this.window!.raw}) است`;
        }
        return null;
    }

        /** اگر الان در بازه‌ی توقف هستیم، دقایق باقی‌مانده تا پایان بازه را برمی‌گرداند؛ وگرنه null */
    minutesUntilRunnable(now: Date = new Date()): number | null {
        if (!this.window) return null;
        if (!isInStopWindow(this.window, now)) return null;

        const cur = now.getHours() * 60 + now.getMinutes();
        const { endMin } = this.window;
        let diff = endMin - cur;
        if (diff <= 0) diff += 24 * 60;
        return diff;
    }

    /**
     * اگر الان در بازه‌ی توقف (STOP_HOURS) هستیم، به‌جای خروج فوری، تا رسیدن
     * به بازه‌ی مجاز صبر می‌کند و هر ۶۰ ثانیه یک پیام وضعیت چاپ می‌کند.
     *
     * اگر دلیل توقف سیگنال (SIGTERM/SIGINT) باشد - نه بازه‌ی ساعتی - صبر
     * کردن معنا ندارد (کاربر صریحا درخواست توقف داده)، پس بلافاصله false
     * برمی‌گرداند.
     *
     * خروجی: true یعنی می‌توان ادامه داد، false یعنی برنامه باید خارج شود.
     */
    async waitUntilRunnable(pollIntervalMs = 1000, logIntervalMs = 60_000): Promise<boolean> {
        let reason = this.reason();
        if (!reason) return true;

        if (this.signalReceived) {
            console.log(`⛔ ${reason}؛ برنامه اجرا نمی‌شود.`);
            return false;
        }

        console.log(`⏸️ ${reason}؛ منتظر فرا رسیدن زمان اجرا می‌مانیم...`);
        let lastLogAt = Date.now();

        while (true) {
            reason = this.reason();
            if (!reason) {
                console.log("✅ به بازه‌ی مجاز اجرا رسیدیم؛ برنامه ادامه می‌یابد.");
                return true;
            }
            if (this.signalReceived) {
                console.log(`⛔ ${reason}؛ از انتظار خارج می‌شویم.`);
                return false;
            }

            if (Date.now() - lastLogAt >= logIntervalMs) {
                const minutesLeft = this.minutesUntilRunnable();
                console.log(
                    `⏳ هنوز در بازه‌ی توقف هستیم${minutesLeft != null ? ` (حدود ${minutesLeft} دقیقه تا پایان)` : ""}...`
                );
                lastLogAt = Date.now();
            }

            await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }
}

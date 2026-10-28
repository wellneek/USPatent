import readline from "readline";

const ANSI = {
    reset: "\x1b[0m",
    alert: "\x1b[1;97;41m", // متن سفید پررنگ روی پس‌زمینه‌ی قرمز
    red: "\x1b[1;31m",
    green: "\x1b[32m",
};

const BELL = "\x07";

function printAttentionBanner(message: string): void {
    const line = "═".repeat(60);
    // هر خط جداگانه reset می‌شود تا رنگ به خطوط بعدی لاگ نشت نکند
    process.stdout.write(
        `\n${BELL}${ANSI.alert} ${line} ${ANSI.reset}\n` +
        `${ANSI.alert}  ⚠️  ${message}  ${ANSI.reset}\n` +
        `${ANSI.alert} ${line} ${ANSI.reset}\n`
    );
}

/**
 * مثل askCli ولی برای مواقعی که فقط انسان می‌تواند ادامه بدهد.
 * - بنر قرمز + bell چاپ می‌کند
 * - تا وقتی جواب نیامده، هر reminderMs دوباره یادآوری می‌کند
 * - بعد از دریافت جواب، رنگ به حالت عادی برمی‌گردد
 */
export function askCliAttention(
    question: string,
    options: { banner?: string; reminderMs?: number } = {}
): Promise<string> {
    const banner = options.banner ?? "لطفا کپچا را در مرورگر بخوان و اینجا وارد کن!";
    const reminderMs = options.reminderMs ?? 30_000;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    printAttentionBanner(banner);

    // reset داخل خود پرامپت است تا متنی که کاربر تایپ می‌کند قرمز نباشد
    const promptText = `${ANSI.red}${question}${ANSI.reset} > `;

    const reminder = setInterval(() => {
        printAttentionBanner(`هنوز منتظر جواب شما هستم! ${banner}`);
        rl.prompt(true); // پرامپت و آنچه تا الان تایپ شده را دوباره نشان می‌دهد
    }, reminderMs);

    return new Promise((resolve) => {
        rl.question(promptText, (answer) => {
            clearInterval(reminder);
            rl.close();
            process.stdout.write(ANSI.reset); // اطمینان از برگشت رنگ به حالت عادی
            console.log(`${ANSI.green}✔ جواب دریافت شد، ادامه می‌دهم...${ANSI.reset}`);
            resolve(answer.trim());
        });
    });
}

/**
 * مثل askCliAttention ولی اگر تا `timeoutMs` جواب نیاید، به‌جای گیر کردن،
 * null برمی‌گرداند تا caller بتواند جواب پیش‌فرض (OCR/رندوم) را جایگزین کند.
 * در صورت timeout، readline بسته می‌شود تا برای تلاش بعدی تداخلی با stdin پیش نیاید.
 */
export function askCliAttentionWithTimeout(
    question: string,
    timeoutMs: number,
    options: { banner?: string; reminderMs?: number } = {}
): Promise<string | null> {
    const banner = options.banner ?? "لطفا کپچا را در مرورگر بخوان و اینجا وارد کن!";
    const reminderMs = options.reminderMs ?? 30_000;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    printAttentionBanner(banner);
    const promptText = `${ANSI.red}${question}${ANSI.reset} > `;

    return new Promise((resolve) => {
        let settled = false;

        const reminder = setInterval(() => {
            printAttentionBanner(`هنوز منتظر جواب شما هستم! ${banner}`);
            rl.prompt(true);
        }, reminderMs);

        const timeoutHandle = setTimeout(() => {
            if (settled) return;
            settled = true;
            clearInterval(reminder);
            rl.close();
            process.stdout.write(ANSI.reset);
            console.log(`${ANSI.red}⏱️ زمان انتظار برای اپراتور تمام شد؛ با جواب پیش‌فرض ادامه می‌دهیم...${ANSI.reset}`);
            resolve(null);
        }, timeoutMs);

        rl.question(promptText, (answer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            clearInterval(reminder);
            rl.close();
            process.stdout.write(ANSI.reset);
            console.log(`${ANSI.green}✔ جواب دریافت شد، ادامه می‌دهم...${ANSI.reset}`);
            resolve(answer.trim());
        });
    });
}

/**
 * یک Promise ساده که یک سوال در ترمینال می‌پرسد و پاسخ کاربر را برمی‌گرداند.
 * برای وارد کردن کد 2FA، تایید حل کپچا، یا تایید/اصلاح یک پاسخ پیشنهادی استفاده می‌شود.
 *
 * اگر defaultValue داده شود، در متن سوال نشان داده می‌شود و اگر کاربر فقط Enter بزند
 * (ورودی خالی)، همان defaultValue برگردانده می‌شود. کاربر همچنان می‌تواند چیز دیگری
 * تایپ کند تا آن را override کند - یعنی همیشه یک تایید/تعامل واقعی از کاربر لازم است.
 */
export function askCli(question: string, defaultValue?: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const promptText = defaultValue ? `${question} [${defaultValue}]: ` : question;

    return new Promise((resolve) => {
        rl.question(promptText, (answer) => {
            rl.close();
            const trimmed = answer.trim();
            resolve(trimmed.length > 0 ? trimmed : defaultValue ?? "");
        });
    });
}

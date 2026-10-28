import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export const CAPTCHA_LIBRARY_DIR = path.resolve(__dirname, "..", "..", "captcha");

export interface CachedCaptchaMatch {
    answer: string;
    filePath: string;
    /** امتیاز شباهت (۰ تا ۱) - برای لاگ و تنظیم آستانه */
    score: number;
}

/**
 * حداقل امتیاز شباهت برای پذیرفتن یک تطبیق.
 * روی نمونه‌ها: دو تصویر یکسان با ۱ پیکسل جابه‌جایی ≈ 0.98 و بدترین جفت
 * متفاوت (4+8 با 4+3) ≈ 0.85 امتیاز گرفتند؛ پس ۰٫۹۳ بین این دو است.
 * با env می‌توان override کرد.
 */
const MATCH_THRESHOLD = Number(process.env.CAPTCHA_CACHE_THRESHOLD ?? 0.93);

/** تحمل جابه‌جایی متن (پیکسل) در هر جهت؛ رندر canvas گاهی ۱ پیکسل جابه‌جا می‌شود */
const MAX_SHIFT = 2;

/**
 * ناحیه‌ی ۴ گلیف (رقم، +، رقم، =) به‌صورت نسبتی از عرض تصویر (بر مبنای 76px).
 * هر گلیف جداگانه مقایسه می‌شود تا تفاوت فقط در یک رقم گم نشود.
 */
const GLYPH_BANDS = [
    [0, 14],
    [14, 31],
    [31, 47],
    [47, 66],
].map(([a, b]) => [a / 76, b / 76] as const);

interface Gray {
    /** مقدار = 255 - روشنایی؛ یعنی جوهر (متن) مقدار بزرگ دارد */
    data: Float32Array;
    w: number;
    h: number;
}

interface CacheEntry {
    answer: string;
    gray: Gray;
}

/** تصاویر کش‌شده یک بار خوانده و در حافظه نگه داشته می‌شوند */
const memory = new Map<string, CacheEntry>();

export async function ensureCaptchaDirExists(): Promise<void> {
    await fs.mkdir(CAPTCHA_LIBRARY_DIR, { recursive: true });
}

/**
 * تصویر فعلی را با تصاویر قبلا حل‌شده مقایسه می‌کند.
 *
 * روش: هر گلیف جداگانه، با تحمل جابه‌جایی ±۲ پیکسل، با همبستگی (NCC) روی
 * تصویر خاکستری. امتیاز نهایی = کمترین امتیاز بین گلیف‌ها، پس همه‌ی گلیف‌ها
 * باید مطابقت داشته باشند. بهترین تطبیق بالای آستانه برگردانده می‌شود.
 *
 * فقط فایل‌هایی که اسمشان با "_" شروع نشده (حل‌شده‌ها) در نظر گرفته می‌شوند.
 */
export async function findCachedAnswer(
    screenshotBuffer: Buffer
): Promise<CachedCaptchaMatch | null> {
    await ensureCaptchaDirExists();

    const files = (await fs.readdir(CAPTCHA_LIBRARY_DIR)).filter(
        (f) => f.toLowerCase().endsWith(".png") && !f.startsWith("_")
    );
    if (files.length === 0) return null;

    const target = await toGray(screenshotBuffer);
    let best: CachedCaptchaMatch | null = null;

    for (const file of files) {
        let entry = memory.get(file);
        if (!entry) {
            const answer = extractAnswerFromFileName(file);
            if (!answer) continue;
            try {
                const buf = await fs.readFile(path.join(CAPTCHA_LIBRARY_DIR, file));
                entry = { answer, gray: await toGray(buf) };
            } catch {
                continue; // فایل خراب یا حذف‌شده
            }
            memory.set(file, entry);
        }

        const score = similarity(target, entry.gray);
        if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
            best = { answer: entry.answer, filePath: path.join(CAPTCHA_LIBRARY_DIR, file), score };
        }
    }

    return best;
}

/**
 * بعد از حل موفق کپچا، تصویر را در پوشه captcha ذخیره می‌کند.
 * فرمت نام: "<answer>_<randomId>.png" (مثلا "5_64575.png")
 */
export async function saveSolvedCaptcha(
    screenshotBuffer: Buffer,
    answer: string
): Promise<string> {
    await ensureCaptchaDirExists();

    const safeAnswer = sanitizeForFileName(answer);
    const randomId = Math.floor(Math.random() * 100000);
    const fileName = `${safeAnswer}_${randomId}.png`;
    const filePath = path.join(CAPTCHA_LIBRARY_DIR, fileName);

    await fs.writeFile(filePath, screenshotBuffer);
    return filePath;
}

/**
 * وقتی کپچا حل نشد/رد شد، تصویر با نام "_<random>.png" ذخیره می‌شود
 * تا بعدا دستی بررسی شود. این فایل‌ها در جستجوی کش نادیده گرفته می‌شوند.
 */
export async function saveUnresolvedCaptcha(screenshotBuffer: Buffer): Promise<string> {
    await ensureCaptchaDirExists();

    const randomId = Math.floor(Math.random() * 1_000_000);
    const fileName = `_${randomId}.png`;
    const filePath = path.join(CAPTCHA_LIBRARY_DIR, fileName);

    await fs.writeFile(filePath, screenshotBuffer);
    return filePath;
}

/**
 * فرمت نام: "<answer>_<randomId>.png" -> جواب = بخش «قبل» از آخرین "_".
 * (نسخه‌ی قبلی بخش بعد از "_" یعنی همان عدد تصادفی را برمی‌گرداند که اشتباه بود.)
 */
function extractAnswerFromFileName(fileName: string): string | null {
    const withoutExt = fileName.replace(/\.png$/i, "");
    const idx = withoutExt.lastIndexOf("_");
    if (idx <= 0) return null;
    return withoutExt.slice(0, idx);
}

function sanitizeForFileName(value: string): string {
    return value.replace(/[^\w+.-]/g, "");
}

// ----------------------------------------------------------------------------
// شباهت‌یابی
// ----------------------------------------------------------------------------

async function toGray(buf: Buffer): Promise<Gray> {
    const { data, info } = await sharp(buf)
        .flatten({ background: "#ffffff" })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const out = new Float32Array(info.width * info.height);
    for (let i = 0; i < out.length; i++) out[i] = 255 - data[i * info.channels];
    return { data: out, w: info.width, h: info.height };
}

/** همبستگی نرمال‌شده‌ی ناحیه‌ی [x0,x1) از a با b که به اندازه‌ی (dx,dy) جابه‌جا شده */
function nccShifted(a: Gray, b: Gray, x0: number, x1: number, dx: number, dy: number): number {
    const ys = Math.max(0, dy);
    const ye = Math.min(a.h, a.h + dy);
    const xs = Math.max(x0, x0 + dx, 0);
    const xe = Math.min(x1, x1 + dx, a.w);

    let sa = 0, sb = 0, n = 0;
    for (let y = ys; y < ye; y++) {
        for (let x = xs; x < xe; x++) {
            sa += a.data[y * a.w + x];
            sb += b.data[(y - dy) * b.w + (x - dx)];
            n++;
        }
    }
    if (n === 0) return -1;

    const ma = sa / n, mb = sb / n;
    let num = 0, da = 0, db = 0;
    for (let y = ys; y < ye; y++) {
        for (let x = xs; x < xe; x++) {
            const va = a.data[y * a.w + x] - ma;
            const vb = b.data[(y - dy) * b.w + (x - dx)] - mb;
            num += va * vb;
            da += va * va;
            db += vb * vb;
        }
    }
    const d = Math.sqrt(da * db);
    return d > 0 ? num / d : -1;
}

function similarity(a: Gray, b: Gray): number {
    if (a.w !== b.w || a.h !== b.h) return 0;

    let worst = 1;
    for (const [f0, f1] of GLYPH_BANDS) {
        const x0 = Math.round(f0 * a.w);
        const x1 = Math.min(a.w, Math.round(f1 * a.w));

        let best = -1;
        for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
            for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
                best = Math.max(best, nccShifted(a, b, x0, x1, dx, dy));
            }
        }
        worst = Math.min(worst, best);
    }
    return worst;
}
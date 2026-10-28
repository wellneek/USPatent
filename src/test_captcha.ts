import * as fs from "fs";
import * as path from "path";
import { MathOcrSolver } from "./services/MathOcrSolver"; // ⚠️ مسیر فایل کلاس خود را اینجا اصلاح کنید

async function main() {
    // ۱. دریافت آرگومان از خط فرمان
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error("❌ خطا: لطفاً مسیر فایل تصویر را وارد کنید.");
        console.log("💡 نحوه استفاده:");
        console.log("   npx tsx test_captcha.ts ./path/to/captcha.png");
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);

    // ۲. بررسی وجود فایل
    if (!fs.existsSync(filePath)) {
        console.error(`❌ خطا: فایل در مسیر زیر یافت نشد:\n   ${filePath}`);
        process.exit(1);
    }

    // ۳. خواندن فایل به صورت Buffer
    let imageBuffer: Buffer;
    try {
        imageBuffer = fs.readFileSync(filePath);
    } catch (err) {
        console.error("❌ خطا در خواندن فایل:", err);
        process.exit(1);
    }

    // ۴. اجرای Solver
    console.log(`🔄 در حال پردازش تصویر: ${path.basename(filePath)} ...`);

    // می‌توانید حداقل میزان اطمینان (confidence) را اینجا تغییر دهید (پیش‌فرض ۶۰ است)
    const solver = new MathOcrSolver(50);

    try {
        const startTime = Date.now();
        const result = await solver.solve(imageBuffer);
        const duration = Date.now() - startTime;

        console.log("\n" + "=".repeat(40));

        if (result) {
            console.log("✅ کپچا با موفقیت حل شد!");
            console.log(`🧮 عبارت شناسایی‌شده: ${result.expression}`);
            console.log(`🎯 جواب نهایی:          ${result.answer}`);
            console.log(`📊 میزان اطمینان:       ${result.confidence.toFixed(2)}%`);
        } else {
            console.log("⚠️ حل کپچا ناموفق بود (میزان اطمینان پایین یا الگوی نامعتبر).");
            console.log("💡 پیشنهاد: تصویر را با کیفیت‌تر ذخیره کنید یا minConfidence را کاهش دهید.");
        }

        console.log(`⏱️ زمان پردازش:          ${duration} میلی‌ثانیه`);
        console.log("=".repeat(40) + "\n");

    } catch (err) {
        console.error("❌ خطای غیرمنتظره در حین حل کپچا:", err);
    } finally {
        // ۵. آزادسازی منابع (بسیار مهم برای جلوگیری از نشت حافظه)
        await solver.dispose();
        process.exit(0);
    }
}

// اجرای برنامه
main();
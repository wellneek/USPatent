/**
 * ورودی تست: پروژه را در هر ساعتی اجرا می‌کند، بدون دست زدن به .env.
 *
 * چطور کار می‌کند: قبل از لود شدن index.ts مقدار STOP_HOURS را خالی می‌کنیم.
 * dotenv مقدارهایی را که از قبل در process.env تعریف شده‌اند override نمی‌کند،
 * پس STOP_HOURS داخل .env نادیده گرفته می‌شود و بازه‌ی توقف غیرفعال است.
 * بقیه‌ی تنظیمات .env عادی خوانده می‌شود.
 *
 * اجرا:  pnpm exec tsx index-test.ts
 */
process.env.STOP_HOURS = "";

// import پویا: باید بعد از خط بالا لود شود (importهای ثابت hoist می‌شوند)
(async () => {
    console.log("🧪 حالت تست: STOP_HOURS نادیده گرفته شد؛ برنامه در هر ساعتی اجرا می‌شود.");
    await import("./index");
})().catch((err) => {
    console.error("خطا در اجرای index-test:", err);
    process.exit(1);
});

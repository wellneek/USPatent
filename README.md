# USPTO bulk downloader

دانلودکننده ترتیبی فایل‌های USPTO با Playwright و MySQL/MariaDB است. هر URL در
یک نشست اسکن می‌شود و فایل‌های انتخاب‌شده همان‌جا، یکی‌یکی دانلود می‌شوند. هنگام
دانلود فعال، یک تب جدا هر چهار دقیقه نشست را زنده نگه می‌دارد.
اگر صف خالی باشد، برنامه بسته نمی‌شود و هر ۳۰ ثانیه job جدید را بررسی می‌کند.

## راه‌اندازی

1. MySQL 8+ یا MariaDB 10.5+ را اجرا و `schema.sql` را import کنید.
2. `.env.example` را به `.env` کپی و اطلاعات اتصال را تنظیم کنید.
3. حداقل یک رکورد فعال در `accounts` و یک URL با وضعیت `draft` درج کنید.
4. selectorهای `INSPECT_STUB` در `src/site/UsptoPageAdapter.ts` و مراحل فرم
   `src/services/AuthService.ts` را با Inspect مرورگر تطبیق دهید.
5. اجرا: `pnpm start` (پنجره مرورگر عمداً visible است).

نمونه داده:

```sql
INSERT INTO accounts (username, password, priority)
VALUES ('user@example.com', 'CHANGE_ME', 10);

INSERT INTO urls
  (db_type, date_from, date_to, url, extensions_to_download, exclude_pattern_regex)
VALUES
  ('example', '2026-01-01', '2026-01-31', 'https://example.invalid/files',
   'zip,pdf', '(^|/)ignore-');
```

پسورد فعلاً plain text خوانده می‌شود و `decryptPassword` عمداً محل اتصال سیستم
رمزنگاری آینده است. برای محیط عملیاتی، secret را plain در دیتابیس نگه ندارید.

## رفتار اجرایی

- پروفایل مرورگر در `.browser-profile` نگه‌داری می‌شود تا cookie لاگین بین
  اجراها حفظ شود.
- `acceptDownloads` و `download.saveAs` مانع نمایش Save As می‌شوند و فایل را
  مستقیم در `DOWNLOAD_DIR` قرار می‌دهند.
- کد 2FA به‌صورت خودکار از URI فیلد `accounts.2fa_secret` تولید می‌شود.
- اگر حل خودکار کپچا تزریق نشده یا شکست بخورد، برنامه تا تأیید کاربر در CLI
  متوقف می‌ماند.
- اختلاف حجم حداکثر ۲۰۰ کیلوبایت فایل را `verified_healthy` می‌کند. اختلاف بیشتر
  طبق نیاز، وضعیت فایل را روی `downloaded` نگه می‌دارد و URL نیز `downloaded`
  باقی می‌ماند.

## نقاط وابسته به Inspect

با `rg INSPECT_STUB src` همه نقاطی که باید پس از بررسی DOM تکمیل شوند دیده
می‌شوند. جزئیات DOM باید فقط در `UsptoPageAdapter` بماند. برای حل خودکار کپچا
یک کلاس پیاده‌کننده `AutomaticCaptchaSolver` بسازید و آن را در `src/index.ts`
به `CaptchaService` تزریق کنید.

// ============================================================
// تایپ‌های مشترک - نگاشت مستقیم به جدول‌های دیتابیس
// ============================================================

export interface Account {
    id: number;
    username: string;
    password: string;
    twoFaSecret: string | null;
    priority: number;
    isActive: boolean;
    lastUsedAt: string | null;
    successLoginCount: number;
    failedLoginCount: number;
}

export type UrlJobStatus =
    | "draft"
    | "scanning"
    | "processing"
    | "paused" // نیمه‌کاره: کار شروع شده ولی تمام نشده؛ همیشه قبل از draft ادامه می‌یابد
    | "downloaded"
    | "failure"
    | "verified";

export interface UrlJob {
    id: number;
    dbType: string;
    dateFrom: string; // 'YYYY-MM-DD'
    dateTo: string;
    url: string;
    extensionsToDownload: string[]; // ["pdf", "zip"]
    excludePatternRegex: string | null;
    filesFoundCount: number;
    downloadedFilesCount: number;
    status: UrlJobStatus;
    createdAt: string;
    processingStartedAt: string | null;
    downloadFinishedAt: string | null;
}

export type FileStatus =
    | "registered"
    | "downloading"
    | "downloaded"
    | "verified_healthy"
    | "size_mismatch"
    | "failed";

export interface FileRecord {
    id: number;
    urlId: number;
    fileName: string;
    expectedSizeBytes: number | null;
    actualSizeBytes: number | null;
    downloadedPath: string | null;
    status: FileStatus;
}

export type LogLevel = "info" | "warning" | "error";

export interface UrlEventLog {
    id: number;
    urlId: number | null;
    fileId: number | null;
    level: LogLevel;
    step: string;
    message: string;
    createdAt: string;
}

// نتیجه‌ی اسکن صفحه: لیستی از فایل‌های کاندید برای دانلود
export interface ScannedFileCandidate {
    fileName: string;
    expectedSizeBytes: number | null;
    downloadHref: string | null; // اگر لازم شد مستقیم استفاده شود
}
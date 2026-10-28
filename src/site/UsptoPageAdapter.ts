import { Locator, Page } from "playwright";
import { ScannedFileCandidate, UrlJob } from "../types";

/**
 * تنها فایل وابسته به DOM سایت USPTO.
 *
 * selectorهای علامت‌گذاری‌شده با INSPECT_STUB نمونه هستند. بعد از Inspect فقط
 * همین adapter را اصلاح کنید؛ orchestration، دیتابیس و دانلود نباید selector
 * یا جزئیات HTML سایت را بشناسند.
 */
export class UsptoPageAdapter {
  async isLoggedIn(page: Page): Promise<boolean> {
    // INSPECT_STUB: نام کاربری/دکمه خروج واقعی هدر را اینجا قطعی کنید.
    return (await page.locator("#global-header button.logout-button").count()) > 0;
  }

  async readDownloadCandidates(
    page: Page,
    job: UrlJob
  ): Promise<ScannedFileCandidate[]> {
    // INSPECT_STUB: selector واقعی ردیف‌های فایل.
    const rows = await page.locator('[data-testid="file-row"]').all();
    const excluded = job.excludePatternRegex
      ? new RegExp(job.excludePatternRegex)
      : null;
    const result: ScannedFileCandidate[] = [];

    for (const row of rows) {
      const file = await this.readRow(row);
      if (!file.fileName) continue;
      if (!this.hasAllowedExtension(file.fileName, job.extensionsToDownload)) {
        continue;
      }
      if (excluded?.test(file.fileName)) continue;
      result.push(file);
    }
    return result;
  }

  async downloadButtonFor(page: Page, fileName: string): Promise<Locator> {
    // INSPECT_STUB pseudocode:
    // 1. ردیفی را پیدا کن که ستون نام آن دقیقاً fileName است.
    // 2. لینک/دکمه Download همان ردیف را برگردان.
    // 3. اگر جدول pagination دارد، ابتدا صفحه حاوی فایل را فعال کن.
    const exactName = page.getByText(fileName, { exact: true });
    return page
      .locator('[data-testid="file-row"]')
      .filter({ has: exactName })
      .getByRole("link")
      .first();
  }

  async isCaptchaPresent(page: Page): Promise<boolean> {
    // INSPECT_STUB: نوع و selector واقعی کپچا را اینجا تکمیل کنید.
    return (
      (await page
        .locator('iframe[title*="captcha" i], .g-recaptcha, #captcha-container')
        .count()) > 0
    );
  }

  private async readRow(row: Locator): Promise<ScannedFileCandidate> {
    // INSPECT_STUB: selectorهای ستون نام، حجم و لینک واقعی را جایگزین کنید.
    const fileName =
      (await row.locator(".file-name").textContent())?.trim() ?? "";
    const sizeText =
      (await row.locator(".file-size").textContent())?.trim() ?? "";
    const downloadHref = await row.locator("a").first().getAttribute("href");
    return {
      fileName,
      expectedSizeBytes: this.parseSizeToBytes(sizeText),
      downloadHref,
    };
  }

  private hasAllowedExtension(fileName: string, extensions: string[]): boolean {
    const normalizedName = fileName.toLowerCase();
    return extensions.some((extension) => {
      const normalizedExtension = extension.trim().replace(/^\./, "").toLowerCase();
      return normalizedName.endsWith(`.${normalizedExtension}`);
    });
  }

  private parseSizeToBytes(text: string): number | null {
    const normalized = text.replace(/,/g, "").trim();
    const match = normalized.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) return null;

    const powers: Record<string, number> = {
      B: 0,
      KB: 1,
      MB: 2,
      GB: 3,
      TB: 4,
    };
    return Math.round(Number(match[1]) * 1024 ** powers[match[2].toUpperCase()]);
  }
}

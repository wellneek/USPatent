import { Page } from "playwright";
import { UrlJob, ScannedFileCandidate } from "../types";
import { CaptchaService } from "./CaptchaService";
import { LogRepository } from "../db/LogRepository";
import { waitForElementReady, isElementVisibleSoon } from "../utils/waitForElement";

const TABLE_ROW_SELECTOR = "table.p-datatable-table tbody tr";
const NEXT_PAGE_BUTTON_SELECTOR = ".p-paginator-next:not(.p-disabled)";

export class ScannerService {
  constructor(
    private captchaService: CaptchaService,
    private logRepo: LogRepository
  ) { }

  /**
   * Opens the URL job page, reads the file list (paginating if needed)
   * and filters based on extensionsToDownload and excludePatternRegex.
   */
  async scan(page: Page, job: UrlJob): Promise<ScannedFileCandidate[]> {

    await this.openJobPage(page, job);
    const excludeRegex = job.excludePatternRegex ? new RegExp(job.excludePatternRegex) : null;

    await this.logRepo.log(job.id, "PAGE_OPENING", `Opening ${job.url}`);
    await page.goto(job.url, { waitUntil: "networkidle" });
    await this.logRepo.log(job.id, "PAGE_OPENED", "Page opened successfully");

    await this.captchaService.handleIfPresent(page, job.id);

    await waitForElementReady(page, TABLE_ROW_SELECTOR, {
      description: "Files list table",
      timeoutMs: 300000,
    });

    const allCandidates: ScannedFileCandidate[] = [];
    let pageIndex = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rowCandidates = await this.extractRowsFromCurrentPage(page, job, excludeRegex);
      allCandidates.push(...rowCandidates);

      const hasNextPage = await isElementVisibleSoon(page, NEXT_PAGE_BUTTON_SELECTOR, 1500);
      if (!hasNextPage) break;

      pageIndex++;
      await this.logRepo.log(job.id, "SCAN_NEXT_PAGE", `Navigating to files table page ${pageIndex}`);
      await page.locator(NEXT_PAGE_BUTTON_SELECTOR).click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    }

    await this.logRepo.log(
      job.id,
      "FILES_LISTED",
      `Found ${allCandidates.length} files matching filter (across ${pageIndex} pages)`
    );

    return allCandidates;
  }

  /** Opens job page and waits for table to become ready (without scanning) */
  async openJobPage(page: Page, job: UrlJob): Promise<void> {
    await this.logRepo.log(job.id, "PAGE_OPENING", `Opening ${job.url}`);
    await page.goto(job.url, { waitUntil: "networkidle" });
    await this.logRepo.log(job.id, "PAGE_OPENED", "Page opened successfully");

    await this.captchaService.handleIfPresent(page, job.id);

    await waitForElementReady(page, TABLE_ROW_SELECTOR, {
      description: "Files list table",
      timeoutMs: 300000,
    });
  }

  private async extractRowsFromCurrentPage(
    page: Page,
    job: UrlJob,
    excludeRegex: RegExp | null
  ): Promise<ScannedFileCandidate[]> {
    const rows = await page.locator(TABLE_ROW_SELECTOR).all();
    const candidates: ScannedFileCandidate[] = [];

    for (const row of rows) {
      // Column 1: file name inside <a href="#">...</a>
      const fileName = (await row.locator("td").nth(0).locator("a").textContent())?.trim() ?? "";
      if (!fileName) continue;

      // Column 3: file size inside <div class="number">11,243,233,280</div>
      const sizeText = (await row.locator("td").nth(2).locator(".number").textContent())?.trim() ?? "";
      const expectedSizeBytes = this.parseSizeWithCommas(sizeText);

      if (!this.fileMatchesExtensions(fileName, job.extensionsToDownload)) continue;
      if (excludeRegex && excludeRegex.test(fileName)) continue;

      candidates.push({
        fileName,
        expectedSizeBytes,
        downloadHref: null,
      });
    }

    return candidates;
  }

  /**
   * Per requirement: both the real file extension is checked, and the extension
   * as a separate token with "_" (or "." or "-") inside the filename.
   * Example: "grant_pdf_20230124_r1.tar" with extensionsToDownload=["pdf"] matches
   * because the token "pdf" is in the filename, even though the real extension is .tar.
   */
  private fileMatchesExtensions(fileName: string, extensions: string[]): boolean {
    const lower = fileName.toLowerCase();
    const realExtension = lower.split(".").pop() ?? "";
    const normalizedExtensions = extensions.map((e) => e.toLowerCase().trim());

    if (normalizedExtensions.includes(realExtension)) return true;

    const tokens = lower.split(/[._-]/);
    return normalizedExtensions.some((ext) => tokens.includes(ext));
  }

  /** "11,243,233,280" -> 11243233280 */
  private parseSizeWithCommas(sizeText: string): number | null {
    const cleaned = sizeText.replace(/,/g, "").trim();
    if (!cleaned || Number.isNaN(Number(cleaned))) return null;
    return parseInt(cleaned, 10);
  }
}
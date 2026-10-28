import { FileRepository } from "../db/FileRepository";
import { LogRepository } from "../db/LogRepository";
import { FileRecord } from "../types";
import fs from "fs/promises";

const DEFAULT_TOLERANCE_BYTES = 200 * 1024; // 200 KB

export class HealthCheckService {
  constructor(
    private fileRepo: FileRepository,
    private logRepo: LogRepository,
    private toleranceBytes: number = DEFAULT_TOLERANCE_BYTES
  ) {}

  /**
   * Checks "downloaded" files of a URL: if |actual - expected| size is within
   * tolerance -> verified_healthy; otherwise status remains downloaded per requirement.
   */
  async checkFile(file: FileRecord, urlId: number): Promise<void> {
    if (!file.downloadedPath) {
      await this.logRepo.log(
        urlId,
        "HEALTH_CHECK_FILE_MISSING",
        `No downloaded file path recorded: ${file.fileName}`,
        "warning",
        file.id
      );
      return;
    }

    let actualSize: number;
    try {
      actualSize = (await fs.stat(file.downloadedPath)).size;
    } catch (error) {
      await this.logRepo.log(
        urlId,
        "HEALTH_CHECK_FILE_MISSING",
        `File not found at recorded path: ${file.downloadedPath} (${(error as Error).message})`,
        "warning",
        file.id
      );
      return;
    }

    if (file.expectedSizeBytes == null) {
      await this.logRepo.log(
        urlId,
        "HEALTH_CHECK_SKIPPED",
        `Expected size unknown for ${file.fileName}`,
        "warning",
        file.id
      );
      return;
    }

    const diff = Math.abs(file.expectedSizeBytes - actualSize);

    if (diff <= this.toleranceBytes) {
      await this.fileRepo.updateStatus(file.id, "verified_healthy");
      await this.logRepo.log(
        urlId,
        "HEALTH_CHECK_OK",
        `File ${file.fileName} is healthy (diff ${diff} bytes)`,
        "info",
        file.id
      );
    } else {
      await this.logRepo.log(
        urlId,
        "HEALTH_CHECK_MISMATCH",
        `Size mismatch for ${file.fileName}: expected=${file.expectedSizeBytes} actual=${actualSize}`,
        "warning",
        file.id
      );
    }
  }
}
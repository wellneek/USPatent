import fs from "fs/promises";
import path from "path";

/** Temporary file extensions the browser/Playwright creates during download */
const TEMP_EXTENSIONS = [".crdownload", ".part", ".partial", ".tmp", ".download"];

export interface ProgressSnapshot {
  /** Name of the file that is growing (temp or GUID) */
  fileName: string;
  bytesDownloaded: number;
  /** Percent, only if we know the expected size */
  percent: number | null;
  /** Bytes per second, average from last poll */
  speedBytesPerSec: number;
  /** Seconds to completion, only if expected size and speed are known */
  etaSeconds: number | null;
  elapsedMs: number;
}

export interface TrackOptions {
  /** Size we read from the site table - for percent and ETA */
  expectedSizeBytes: number | null;
  /** How often to check folder (default 5s) */
  pollIntervalMs?: number;
  /**
   * If the file size does not grow for this duration, the download is considered dead.
   * For multi-GB files without resume, this is the most important guard; without it
   * we might wait 60 minutes for something that died in the first minute.
   * Default: 10 minutes
   */
  stallTimeoutMs?: number;
  /** Overall time limit for one download */
  overallTimeoutMs: number;
  onProgress?: (snapshot: ProgressSnapshot) => void | Promise<void>;
}

export class DownloadStalledError extends Error {
  constructor(public readonly lastBytes: number, stallMs: number) {
    super(
      `Download stalled: no file size growth for ${Math.round(
        stallMs / 1000
      )}s (last size: ${lastBytes} bytes)`
    );
    this.name = "DownloadStalledError";
  }
}

/**
 * Monitors the download folder via polling.
 *
 * Why polling and not fs.watch?
 *  - fs.watch only says "something changed" but no size; we need exact size
 *  - On a file being appended to constantly, inotify floods events
 *  - readdir+stat every few seconds on a folder with a few files is essentially free
 *  - Most importantly: with polling we can detect stall
 */
export class DownloadMonitor {
  constructor(private downloadDir: string) {}

  /**
   * Waits for one download to complete, reporting progress during.
   *
   * `completionPromise` is the promise Playwright resolves when download finishes
   * (e.g. download.path()). We rely on it for "completion", and use the filesystem
   * only for "progress" and "stall detection". This combination is safer than
   * either approach alone: not relying on guessing from temp files, and not
   * blindly waiting on a promise that may never resolve.
   */
  async trackUntilComplete<T>(
    completionPromise: Promise<T>,
    options: TrackOptions
  ): Promise<T> {
    const {
      expectedSizeBytes,
      pollIntervalMs = 5000,
      stallTimeoutMs = 10 * 60 * 1000,
      overallTimeoutMs,
      onProgress,
    } = options;

    const startedAt = Date.now();
    let settled = false;
    let lastBytes = 0;
    let lastGrowthAt = Date.now();
    let previousBytes = 0;
    let previousAt = Date.now();

    const wrapped = completionPromise.finally(() => {
      settled = true;
    });

    const monitorLoop = (async () => {
      while (!settled) {
        await sleep(pollIntervalMs);
        if (settled) break;

        const now = Date.now();

        if (now - startedAt > overallTimeoutMs) {
          throw new Error(
            `Download exceeded maximum allowed time (${Math.round(
              overallTimeoutMs / 60000
            )} minutes)`
          );
        }

        const inProgress = await this.findLargestInProgressFile();
        if (!inProgress) continue;

        lastBytes = inProgress.sizeBytes;

        if (lastBytes > previousBytes) {
          lastGrowthAt = now;
        } else if (now - lastGrowthAt > stallTimeoutMs) {
          throw new DownloadStalledError(lastBytes, now - lastGrowthAt);
        }

        const deltaBytes = lastBytes - previousBytes;
        const deltaMs = now - previousAt;
        const speed = deltaMs > 0 ? (deltaBytes / deltaMs) * 1000 : 0;

        const percent =
          expectedSizeBytes && expectedSizeBytes > 0
            ? Math.min(100, (lastBytes / expectedSizeBytes) * 100)
            : null;

        const etaSeconds =
          expectedSizeBytes && speed > 0
            ? Math.max(0, (expectedSizeBytes - lastBytes) / speed)
            : null;

        if (onProgress) {
          await onProgress({
            fileName: inProgress.fileName,
            bytesDownloaded: lastBytes,
            percent,
            speedBytesPerSec: speed,
            etaSeconds,
            elapsedMs: now - startedAt,
          });
        }

        previousBytes = lastBytes;
        previousAt = now;
      }
    })();

    return Promise.race([wrapped, monitorLoop.then(() => wrapped)]);
  }

  /**
   * Finds the largest "in progress" file in the folder.
   *
   * Covers two cases:
   *  1) Browser temp file with extensions like .crdownload
   *  2) Playwright temp file with GUID name and no extension
   *     (since acceptDownloads=true, this is the usual case)
   *
   * Returns the largest because only one download is active at a time and
   * the growing file is naturally the largest unfinished one.
   */
  private async findLargestInProgressFile(): Promise<{
    fileName: string;
    sizeBytes: number;
  } | null> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.downloadDir);
    } catch {
      return null;
    }

    let best: { fileName: string; sizeBytes: number } | null = null;

    for (const entry of entries) {
      const looksTemporary =
        TEMP_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext)) ||
        !path.extname(entry);

      if (!looksTemporary) continue;

      try {
        const stat = await fs.stat(path.join(this.downloadDir, entry));
        if (!stat.isFile()) continue;
        if (!best || stat.size > best.sizeBytes) {
          best = { fileName: entry, sizeBytes: stat.size };
        }
      } catch {
        // File may have been removed between readdir and stat (e.g. final rename) - ignore
      }
    }

    return best;
  }

  /**
   * After download completes, ensures the final file is really on disk
   * and its size is no longer changing (OS flush completed).
   */
  async waitForStableFile(
    filePath: string,
    stableForMs: number = 3000,
    timeoutMs: number = 60000
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let stableSince = 0;

    while (Date.now() < deadline) {
      let size: number;
      try {
        size = (await fs.stat(filePath)).size;
      } catch {
        await sleep(500);
        continue;
      }

      if (size === lastSize && size > 0) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= stableForMs) return size;
      } else {
        lastSize = size;
        stableSince = 0;
      }

      await sleep(500);
    }

    throw new Error(`File size for ${filePath} did not stabilize in time`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Helper for readable log output */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
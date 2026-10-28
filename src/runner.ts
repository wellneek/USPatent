/**
 * Runner: runs `pnpm start` and restarts it if it crashes.
 *
 * Usage (same terminal as the GUI session):
 *   pnpm run runner
 *
 * Rules:
 *  - Before each run: if the current time is within STOP_HOURS, wait
 *  - Before each run: delete the browser profile folder (.browser-profile)
 *  - exit code 0   -> if inside the stop window (soft hourly stop), wait and rerun;
 *                     otherwise normal exit and runner exits
 *  - exit code 130 -> immediate user exit; no restart
 *  - anything else (error / killed) -> restart with backoff
 *  - Ctrl+C / SIGTERM on runner -> graceful stop; no restart after child exits
 *
 * Windows notes:
 *  1) `pnpm` on Windows is a shim (`pnpm.cmd`), not a real executable.
 *     The absolute path is resolved at startup using `where.exe`.
 *  2) From Node.js 18.20+ / 20.12+ / 22+, spawning a `.cmd` file without
 *     `shell: true` fails with EINVAL (CVE-2024-27980). Since our command and
 *     args are fixed and safe, `shell: true` is enabled. To avoid the
 *     DEP0190 warning we pass a single command string (no separate args array).
 */
import "dotenv/config";
import { spawn, execSync, type ChildProcess } from "child_process";
import fs from "fs/promises";
import path from "path";
import { config } from "./config";
import { StopController, parseStopHours } from "./utils/StopController";

// ─── Resolve absolute path of pnpm at startup ───────────────────────────────
function resolvePnpmPath(): string {
    if (process.env.PNPM_BIN && process.env.PNPM_BIN.trim()) {
        return process.env.PNPM_BIN.trim();
    }

    try {
        const cmd = process.platform === "win32" ? "where.exe" : "which";
        const out = execSync(`${cmd} pnpm`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });

        const candidates = out
            .trim()
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);

        const pick =
            candidates.find((p) => /\.exe$/i.test(p)) ??
            candidates.find((p) => /\.(cmd|bat)$/i.test(p)) ??
            candidates.find((p) => !/\.ps1$/i.test(p)) ??
            candidates[0];

        if (pick) return pick;
    } catch {
        /* ignore */
    }

    return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

const COMMAND = resolvePnpmPath();
const ARGS = ["start"];

// Build a single command string so we don't trigger DEP0190 (shell + args array).
// All parts are hardcoded, so quoting is sufficient and there is no injection risk.
const FULL_COMMAND = `"${COMMAND}" ${ARGS.map((a) => `"${a}"`).join(" ")}`;

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;
const HEALTHY_RUN_MS = 10 * 60_000;
const WAIT_LOG_INTERVAL_MS = 60_000;

let child: ChildProcess | null = null;
let stopRequested = false;
let signalCount = 0;

function ts(): string {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function log(msg: string): void {
    console.log(`[runner ${ts()}] ${msg}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function interruptibleSleep(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !stopRequested) {
        await sleep(Math.min(500, deadline - Date.now()));
    }
}

const stopWindowController = new StopController(parseStopHours(config.stopHours));

function onSignal(signal: NodeJS.Signals): void {
    signalCount++;
    stopRequested = true;

    if (signalCount === 1) {
        log(`${signal} received; waiting for graceful shutdown (restart disabled).`);
        if (signal === "SIGTERM" && child?.pid) {
            child.kill("SIGTERM");
        }
        return;
    }

    log(`${signal} received again; forcing kill.`);
    if (child?.pid) child.kill("SIGKILL");
    process.exit(130);
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

async function waitUntilRunWindow(): Promise<boolean> {
    let lastLogAt = 0;
    let announced = false;

    while (!stopRequested) {
        const minutesLeft = stopWindowController.minutesUntilRunnable();
        if (minutesLeft === null) {
            if (announced) log("Reached the allowed run window.");
            return true;
        }

        if (Date.now() - lastLogAt >= WAIT_LOG_INTERVAL_MS) {
            log(
                `Waiting for run window... (STOP_HOURS=${config.stopHours}; ` +
                `about ${minutesLeft} min until stop window ends)`
            );
            lastLogAt = Date.now();
            announced = true;
        }
        await sleep(1000);
    }
    return false;
}

async function cleanBrowserProfile(): Promise<void> {
    const dir = config.browserProfileDir;

    const root = path.parse(dir).root;
    if (dir === root || dir === process.env.HOME || dir === process.cwd()) {
        throw new Error(`Refusing to delete dangerous browser profile path: ${dir}`);
    }

    try {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        log(`Browser profile cleaned: ${dir}`);
    } catch (err) {
        log(`Failed to clean browser profile (${(err as Error).message}); continuing.`);
    }
}

function runOnce(): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
}> {
    return new Promise((resolve) => {
        const startedAt = Date.now();

        // Single command string + shell:true avoids both EINVAL (.cmd on Win)
        // and DEP0190 (shell + args array).
        child = spawn(FULL_COMMAND, {
            stdio: "inherit",
            env: process.env,
            cwd: process.cwd(),
            shell: true,
        });

        child.on("error", (err) => {
            log(`Failed to spawn child: ${err.message}`);
            child = null;
            resolve({ code: 1, signal: null, durationMs: Date.now() - startedAt });
        });

        child.on("exit", (code, signal) => {
            child = null;
            resolve({ code, signal, durationMs: Date.now() - startedAt });
        });
    });
}

async function main(): Promise<void> {
    log(`pnpm resolved => ${COMMAND}`);
    log(`cwd => ${process.cwd()}`);

    let consecutiveFailures = 0;
    let runNumber = 0;

    while (!stopRequested) {
        if (!(await waitUntilRunWindow())) break;

        await cleanBrowserProfile();

        runNumber++;
        log(`Run #${runNumber}: ${FULL_COMMAND}`);

        const { code, signal, durationMs } = await runOnce();
        const durationSec = Math.round(durationMs / 1000);

        if (stopRequested) {
            log(`Child stopped after ${durationSec}s (code=${code}, signal=${signal}). Exiting.`);
            return;
        }
        if (code === 130) {
            log("Immediate user exit detected; no restart.");
            return;
        }
        if (code === 0) {
            if (stopWindowController.minutesUntilRunnable() !== null) {
                log(
                    `Child exited after ${durationSec}s due to stop window; ` +
                    `will restart after the window ends.`
                );
                consecutiveFailures = 0;
                continue;
            }
            log(`Child finished successfully after ${durationSec}s. Exiting.`);
            return;
        }

        consecutiveFailures = durationMs >= HEALTHY_RUN_MS ? 1 : consecutiveFailures + 1;
        const delay = Math.min(BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS);

        log(
            `Child crashed after ${durationSec}s (code=${code}, signal=${signal}). ` +
            `Restarting in ${Math.round(delay / 1000)}s (consecutive failures: ${consecutiveFailures})`
        );
        await interruptibleSleep(delay);
    }
    log("Stop requested; exiting.");
}

main().then(() => process.exit(0));
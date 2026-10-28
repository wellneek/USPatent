import { Page } from "playwright";
import { Account } from "../types";
import { AccountRepository } from "../db/AccountRepository";
import { LogRepository } from "../db/LogRepository";
import { CaptchaService } from "./CaptchaService";
import { UsptoPageAdapter } from "../site/UsptoPageAdapter";
import * as OTPAuth from "otpauth";

export class AuthService {
    constructor(
        private accountRepo: AccountRepository,
        private logRepo: LogRepository,
        private captchaService: CaptchaService,
        private site: UsptoPageAdapter,
        public readonly homeUrl: string = "https://data.uspto.gov/"
    ) {}

    async isLoggedIn(page: Page): Promise<boolean> {
        return this.site.isLoggedIn(page);
    }

    async ensureLoggedIn(page: Page, urlId: number | null = null): Promise<boolean> {
        if (await this.site.isLoggedIn(page)) return false;

        await this.logRepo.log(
            urlId,
            "SESSION_LOST",
            "Not logged in (logout button not found in header); attempting re-login",
            "warning"
        );

        const account = await this.accountRepo.pickNextAvailableAccount();
        if (!account) throw new Error("No active account found for login.");

        const ok = await this.login(page, account, urlId);
        if (!ok) throw new Error(`Re-login with account ${account.username} failed.`);

        await this.logRepo.log(urlId, "SESSION_RESTORED", "Re-login successful");
        return true;
    }

    async login(page: Page, account: Account, urlIdForLog: number | null = null): Promise<boolean> {
        await this.logRepo.log(urlIdForLog, "LOGIN_STARTED", `Attempting login with account ${account.username}`);
        console.log(`🔐 Logging in with account: ${account.username} ...`);

        try {
            if (!page.url().startsWith(this.homeUrl)) {
                // استفاده از domcontentloaded برای جلوگیری از گیر کردن در networkidle
                await page.goto(this.homeUrl, { waitUntil: "domcontentloaded" });
            }

            await page.locator("#global-header a.user-link", { hasText: "Sign in" }).click();
            await page.waitForLoadState("domcontentloaded");
            await this.captchaService.handleIfPresent(page, urlIdForLog);

            await this.fillIdentifierStep(page, account);
            await this.logRepo.log(urlIdForLog, "LOGIN_STEP_IDENTIFIER_SUBMITTED", "Email entered and submitted");
            await this.captchaService.handleIfPresent(page, urlIdForLog);

            await this.fillPasswordStep(page, account);
            await this.logRepo.log(urlIdForLog, "LOGIN_STEP_PASSWORD_SUBMITTED", "Password entered and submitted");
            await this.captchaService.handleIfPresent(page, urlIdForLog);

            // تشخیص صفحه 2FA
            const needs2fa = await this.isOtpStepVisible(page);
            if (needs2fa) {
                console.log("📟 2FA page detected; generating TOTP code...");
                await this.logRepo.log(urlIdForLog, "LOGIN_STEP_2FA_GENERATING", "Generating TOTP code automatically");
                const code = this.generateTotpCode(account.twoFaSecret);
                await this.fillOtpStep(page, code);
                await this.logRepo.log(urlIdForLog, "LOGIN_STEP_2FA_SUBMITTED", "2FA code submitted");
            } else {
                await this.logRepo.log(
                    urlIdForLog,
                    "LOGIN_2FA_NOT_DETECTED",
                    `2FA page not detected (url: ${page.url()})`,
                    "warning"
                );
                try {
                    await page.screenshot({ path: `debug-login-${Date.now()}.png`, fullPage: true });
                } catch { /* ignore */ }
            }

            await this.waitForPostLoginRedirect(page, urlIdForLog);
            const success = await this.isLoggedIn(page);
            if (success) {
                await this.accountRepo.markLoginSuccess(account.id);
                await this.logRepo.log(urlIdForLog, "LOGIN_SUCCESS", `Login with ${account.username} successful`);
            } else {
                await this.accountRepo.markLoginFailure(account.id);
                await this.logRepo.log(urlIdForLog, "LOGIN_FAILED", `Login with ${account.username} failed`, "error");
            }
            return success;
        } catch (err) {
            await this.accountRepo.markLoginFailure(account.id);
            await this.logRepo.log(
                urlIdForLog,
                "LOGIN_ERROR",
                `Login process error: ${(err as Error).message}`,
                "error"
            );
            return false;
        }
    }

    private async fillIdentifierStep(page: Page, account: Account): Promise<void> {
        const identifierInput = page.locator('input[name="identifier"]');
        await identifierInput.waitFor({ state: "visible" });
        await identifierInput.fill("");
        await identifierInput.fill(account.username);

        try {
            const rememberMeInput = page.locator('input[name="rememberMe"]');
            await rememberMeInput.waitFor({ state: "attached", timeout: 15000 });
            const alreadyChecked = await rememberMeInput.isChecked().catch(() => false);
            if (!alreadyChecked) {
                const rememberMeLabel = page.locator(
                    '.custom-checkbox label[data-se-for-name="rememberMe"]'
                );
                await rememberMeLabel.waitFor({ state: "visible", timeout: 15000 });
                await rememberMeLabel.click();
                const nowChecked = await rememberMeInput.isChecked().catch(() => false);
                if (!nowChecked) {
                    console.warn("⚠️ After clicking the label, rememberMe checkbox is still unchecked; continuing without it.");
                }
            }
        } catch (e) {
            console.error("Remember me checkbox not found or not clickable!", e);
        }

        const nextBtn = page.locator('input[type="submit"][value="Next"]');
        await nextBtn.waitFor({ state: "visible" });
        await nextBtn.click();
        await page.waitForLoadState("domcontentloaded");
    }

    private async fillPasswordStep(page: Page, account: Account): Promise<void> {
        await page
            .locator(".challenge-authenticator--okta_password")
            .waitFor({ state: "visible", timeout: 20000 });

        const plainPassword = this.decryptPassword(account.password);
        await page.locator('input[name="credentials.passcode"]').waitFor({ state: "visible" });
        await page.fill('input[name="credentials.passcode"]', plainPassword);
        await page.locator('input[type="submit"][value="Verify"]').waitFor({ state: "visible" });
        await page.locator('input[type="submit"][value="Verify"]').click();
        await page.waitForLoadState("domcontentloaded");
    }

    private async isOtpStepVisible(page: Page): Promise<boolean> {
        const selectors = [
            "input[name='credentials.passcode']",
            ".challenge-authenticator--custom_otp",
            ".challenge-authenticator[data-se*='otp']",
            ".challenge-authenticator[data-se*='totp']",
            ".challenge-authenticator[data-se*='factor']",
            "input[name='credentials.passcode'][autocomplete='one-time-code']",
        ];

        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            for (const sel of selectors) {
                const loc = page.locator(sel).first();
                if (await loc.isVisible().catch(() => false)) {
                    return true;
                }
            }
            if (page.url().includes("auth.uspto.gov")) {
                const passcodeVisible = await page
                    .locator("input[name='credentials.passcode']").first().isVisible().catch(() => false);
                if (passcodeVisible) return true;
            }
            await page.waitForTimeout(500);
        }
        return false;
    }

    private async fillOtpStep(page: Page, code: string): Promise<void> {
        const candidates = [
            ".challenge-authenticator--custom_otp input[name='credentials.passcode']",
            "input[name='credentials.passcode']",
            "input[autocomplete='one-time-code']",
        ];
        let filled = false;
        for (const sel of candidates) {
            const loc = page.locator(sel).first();
            if (await loc.isVisible().catch(() => false)) {
                await loc.fill("");
                await loc.fill(code);
                filled = true;
                break;
            }
        }
        if (!filled) throw new Error("2FA code input not found.");

        const verifyButtons = [
            ".challenge-authenticator--custom_otp input[type='submit'][value='Verify']",
            "input[type='submit'][value='Verify']",
            "button[type='submit']:has-text('Verify')",
            "button:has-text('Verify')",
        ];
        for (const sel of verifyButtons) {
            const loc = page.locator(sel).first();
            if (await loc.isVisible().catch(() => false)) {
                await loc.click();
                await page.waitForLoadState("domcontentloaded");
                return;
            }
        }
        throw new Error("Verify button not found on 2FA page.");
    }

    private async waitForPostLoginRedirect(page: Page, urlIdForLog: number | null): Promise<void> {
        const timeoutMs = 45000;
        const pollIntervalMs = 500;
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (!page.url().includes("auth.uspto.gov")) break;
            await page.waitForTimeout(pollIntervalMs);
        }
        while (Date.now() < deadline) {
            if (!page.url().includes("/login/callback")) break;
            await page.waitForTimeout(pollIntervalMs);
        }
        if (Date.now() >= deadline) {
            await this.logRepo.log(
                urlIdForLog,
                "LOGIN_REDIRECT_TIMEOUT",
                `Still on login intermediate page after ${timeoutMs / 1000}s (current url: ${page.url()})`,
                "warning"
            );
        }
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await this.logRepo.log(
            urlIdForLog,
            "LOGIN_REDIRECT_COMPLETED",
            `Post-login redirect completed. Final url: ${page.url()}`
        );
    }

    private generateTotpCode(secretOrUri: string | null): string {
        if (!secretOrUri?.trim()) {
            throw new Error("No 2fa_secret registered for this account.");
        }
        const raw = secretOrUri.trim();
        let otp: OTPAuth.TOTP | OTPAuth.HOTP;

        if (raw.startsWith("otpauth://")) {
            const parsed = OTPAuth.URI.parse(raw);
            if (!(parsed instanceof OTPAuth.TOTP)) {
                throw new Error("2fa_secret must be of type TOTP.");
            }
            otp = parsed;
        } else {
            const cleaned = raw.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
            if (!/^[A-Z2-7]+$/.test(cleaned) || cleaned.length < 16) {
                throw new Error("2fa_secret is neither a valid URI nor valid Base32.");
            }
            otp = new OTPAuth.TOTP({
                secret: cleaned,
                digits: 6,
                period: 30,
                algorithm: "SHA1",
            });
        }
        return otp.generate();
    }

    private decryptPassword(encrypted: string): string {
        return encrypted;
    }
}
import {Page} from "playwright";
import {LogRepository} from "../db/LogRepository";
import {askCliAttentionWithTimeout} from "../cli/prompt";
import {waitForElementReady, isElementVisibleSoon, safeClick} from "../utils/waitForElement";
import {findCachedAnswer, saveSolvedCaptcha, saveUnresolvedCaptcha} from "../utils/captchaCache";
import {MathOcrSolver, OcrSolveResult} from "./MathOcrSolver";
import {config} from "../config";
import * as process from "node:process";

const DIALOG_SELECTOR = "app-captcha-dialog";
const CANVAS_SELECTOR = `${DIALOG_SELECTOR} canvas.jCaptchaCanvas`;
const INPUT_SELECTOR = `${DIALOG_SELECTOR} input#jCaptcha`;
const CONTINUE_BUTTON_SELECTOR = `${DIALOG_SELECTOR} button[type="submit"]`;
const CANCEL_BUTTON_SELECTOR = `${DIALOG_SELECTOR} button:has-text("Cancel")`;

export type CaptchaOutcome = "solved" | "skipped";
type AnswerSource = "cache" | "ocr" | "cli" | "ocr-fallback" | "random-fallback";
const MAX_CACHE_FAILURES = 2;

export class CaptchaService {
    constructor(
        private logRepo: LogRepository,
        private ocrSolver: MathOcrSolver = new MathOcrSolver(parseInt(process.env.CAPTCHA_CONFIDENCE ?? "40")),
        private ocrAutoAcceptConfidence: number = config.captchaOcrAutoAcceptConfidence,
        private operatorWaitMs: number = config.captchaOperatorWaitMs
    ) {
    }

    async dispose(): Promise<void> {
        await this.ocrSolver.dispose();
    }

    async isDialogPresent(page: Page): Promise<boolean> {
        return isElementVisibleSoon(page, DIALOG_SELECTOR, 5000);
    }

    async resolveIfPresent(
        page: Page,
        urlId: number,
        fileId: number | null = null
    ): Promise<CaptchaOutcome> {
        if (!(await this.isDialogPresent(page))) {
            return "solved";
        }

        await this.logRepo.log(urlId, "CAPTCHA_DIALOG_DETECTED", "Captcha dialog appeared", "info", fileId);

        const MAX_ATTEMPTS = 10;
        let cacheFailures = 0;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const canvasLocator = await waitForElementReady(page, CANVAS_SELECTOR, {
                description: "captcha canvas",
                timeoutMs: 15000,
            });
            const screenshotBuffer = await canvasLocator.screenshot();

            let answer: string | null = null;
            let source: AnswerSource = "random-fallback";

            // 1) Cache
            if (cacheFailures < MAX_CACHE_FAILURES) {
                const cached = await findCachedAnswer(screenshotBuffer);
                if (cached) {
                    answer = cached.answer;
                    source = "cache";
                    await this.logRepo.log(
                        urlId, "CAPTCHA_CACHE_HIT",
                        `Similar image found in cache; answer: ${answer}`, "info", fileId
                    );
                }
            }

            // 2) OCR - always returns an answer with confidence (if pattern detected)
            let ocrResult: OcrSolveResult | null = null;
            if (!answer) {
                ocrResult = await this.ocrSolver.solve(screenshotBuffer);

                if (ocrResult) {
                    await this.logRepo.log(
                        urlId, "CAPTCHA_OCR_ANSWER",
                        `OCR read: ${ocrResult.expression} = ${ocrResult.answer} (confidence ${ocrResult.confidence.toFixed(0)}%)`,
                        "info", fileId
                    );

                    if (ocrResult.confidence > this.ocrAutoAcceptConfidence) {
                        answer = ocrResult.answer;
                        source = "ocr";
                    }
                } else {
                    await this.logRepo.log(urlId, "CAPTCHA_OCR_UNSURE", "OCR could not read any expression", "info", fileId);
                }
            }

            // 3) OCR confidence was low or no answer: wait for operator with timeout
            if (!answer) {
                console.log(
                    `🧮 Captcha displayed (attempt ${attempt}/${MAX_ATTEMPTS}). ` +
                    `Waiting up to ${Math.round(this.operatorWaitMs / 60000)} minutes for operator; ` +
                    `otherwise OCR/random answer will be used as fallback.`
                );

                const operatorAnswer = await askCliAttentionWithTimeout(
                    `Enter captcha answer (or 'skip' to skip) [attempt ${attempt}/${MAX_ATTEMPTS}]`,
                    this.operatorWaitMs,
                    {
                        banner: ocrResult
                            ? `OCR guessed ${ocrResult.answer} with low confidence (${ocrResult.confidence.toFixed(0)}%); check the image in the browser and confirm/correct!`
                            : "OCR could not read the captcha; check the image in the browser and enter the answer here!",
                    }
                );

                if (operatorAnswer !== null && operatorAnswer.toLowerCase() === "skip") {
                    const savedPath = await saveUnresolvedCaptcha(screenshotBuffer);
                    await this.logRepo.log(
                        urlId, "CAPTCHA_SKIPPED",
                        `User skipped captcha. Image saved at: ${savedPath}`, "warning", fileId
                    );
                    await safeClick(page, CANCEL_BUTTON_SELECTOR, {description: "captcha Cancel button"}).catch(() => {});
                    return "skipped";
                }

                if (operatorAnswer !== null && operatorAnswer.length > 0) {
                    answer = operatorAnswer;
                    source = "cli";
                } else if (ocrResult) {
                    answer = ocrResult.answer;
                    source = "ocr-fallback";
                    await this.logRepo.log(
                        urlId, "CAPTCHA_OPERATOR_TIMEOUT_USING_OCR",
                        `Operator did not respond in time; using OCR answer (confidence ${ocrResult.confidence.toFixed(0)}%): ${answer}`,
                        "warning", fileId
                    );
                } else {
                    answer = String(Math.floor(Math.random() * 10) + 1);
                    source = "random-fallback";
                    await this.logRepo.log(
                        urlId, "CAPTCHA_OPERATOR_TIMEOUT_USING_RANDOM",
                        `Operator did not respond and OCR read nothing; trying random answer: ${answer}`,
                        "warning", fileId
                    );
                }
            }

            await page.fill(INPUT_SELECTOR, answer);
            await safeClick(page, CONTINUE_BUTTON_SELECTOR, {description: "captcha Continue button"});

            const isInvalid = await this.wasAnswerInvalid(page);

            if (!isInvalid) {
                if (source !== "cache") {
                    await saveSolvedCaptcha(screenshotBuffer, answer);
                }
                await this.logRepo.log(urlId, "CAPTCHA_SOLVED", `Captcha solved (source: ${source})`, "info", fileId);
                return "solved";
            }

            if (source === "cache") cacheFailures++;

            await this.logRepo.log(
                urlId, "CAPTCHA_INVALID_ANSWER",
                `Wrong answer (source: ${source}, attempt ${attempt}). New captcha displayed.`,
                "warning", fileId
            );
        }

        await this.logRepo.log(
            urlId, "CAPTCHA_MAX_ATTEMPTS_REACHED", `Captcha not solved after ${MAX_ATTEMPTS} attempts.`, "error", fileId
        );
        return "skipped";
    }

    private async wasAnswerInvalid(page: Page): Promise<boolean> {
        await page.waitForTimeout(800);
        const invalidInput = page.locator(`${INPUT_SELECTOR}.invalid`);
        if ((await invalidInput.count()) > 0) return true;
        const dialogStillOpen = await page.locator(DIALOG_SELECTOR).count();
        if (dialogStillOpen === 0) return false;
        return false;
    }

    async handleIfPresent(page: Page, urlId: number | null): Promise<void> {
        if (urlId == null) return;
        await this.resolveIfPresent(page, urlId, null);
    }
}
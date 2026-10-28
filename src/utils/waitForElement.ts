import {Page, Locator} from "playwright";
import {PageLoadTimeoutError} from "./browserErrors";

export interface WaitForElementOptions {
    /** کل زمان مجاز انتظار به میلی‌ثانیه (پیش‌فرض ۳۰ ثانیه) */
    timeoutMs?: number;
    /** فاصله‌ی هر بار چک کردن، به میلی‌ثانیه (پیش‌فرض ۱ ثانیه) */
    pollIntervalMs?: number;
    /** توضیح خوانا برای پیام خطا (پیش‌فرض همان selector) */
    description?: string;
    /**
     * اگر true باشد، باید المنت در دو poll متوالی هم ready باشد تا برگردانده شود.
     * این برای جلوگیری از race condition جاهایی که فریم‌ورک صفحه (مثلا ویجت Okta)
     * بعد از mount اولیه دوباره re-render می‌کند، مفید است: یک بار دیدن المنت کافی
     * نیست چون ممکن است در حال جایگزین شدن باشد.
     * پیش‌فرض: true
     */
    requireStable?: boolean;
}

/**
 * صفحه را هر `pollIntervalMs` (پیش‌فرض هر ۱ ثانیه) تا `timeoutMs` (پیش‌فرض ۳۰ ثانیه)
 * چک می‌کند که آیا selector مورد نظر ظاهر و قابل تعامل (visible + enabled) شده یا نه.
 * اگر پیدا نشد، خطای واضح می‌دهد که کدام المنت پیدا نشد.
 *
 * این یک لایه‌ی اضافه روی auto-wait داخلی Playwright است، برای مواردی که
 * صفحه بعد از mount اولیه دوباره re-render می‌شود (مثل ویجت لاگین Okta).
 */
export async function waitForElementReady(
    page: Page,
    selector: string,
    options: WaitForElementOptions = {}
): Promise<Locator> {
    const {
        timeoutMs = 30000,
        pollIntervalMs = 1000,
        description = selector,
        requireStable = true,
    } = options;

    const deadline = Date.now() + timeoutMs;
    let previouslyReady = false;

    while (Date.now() < deadline) {
        const locator = page.locator(selector).first();
        const count = await locator.count().catch(() => 0);

        if (count > 0) {
            const visible = await locator.isVisible().catch(() => false);
            const enabled = await locator.isEnabled().catch(() => true); // بعضی المنت‌ها enabled معنا ندارد

            if (visible && enabled) {
                if (!requireStable || previouslyReady) {
                    return locator;
                }
                previouslyReady = true;
            } else {
                previouslyReady = false;
            }
        } else {
            previouslyReady = false;
        }

        await page.waitForTimeout(pollIntervalMs);
    }

    throw new PageLoadTimeoutError(
        `⏱️ Timeout: المنت "${description}" (selector: ${selector}) پس از ${
            timeoutMs / 1000
        } ثانیه در صفحه ظاهر یا آماده‌ی تعامل نشد.`
    );
    // throw new Error(
    //   `⏱️ Timeout: المنت "${description}" (selector: ${selector}) پس از ${
    //     timeoutMs / 1000
    //   } ثانیه در صفحه ظاهر یا آماده‌ی تعامل نشد.`
    // );
}

/** کلیک امن: صبر می‌کند المنت آماده و پایدار شود، بعد کلیک می‌کند */
export async function safeClick(
    page: Page,
    selector: string,
    options?: WaitForElementOptions
): Promise<void> {
    const locator = await waitForElementReady(page, selector, options);
    await locator.click();
}

/** پر کردن امن یک input: صبر می‌کند المنت آماده شود، بعد مقدار را می‌نویسد */
export async function safeFill(
    page: Page,
    selector: string,
    value: string,
    options?: WaitForElementOptions
): Promise<void> {
    const locator = await waitForElementReady(page, selector, options);
    await locator.fill(value);
}

/**
 * تیک زدن امن یک چک‌باکس. اگر چک‌باکس از دید Playwright قابل‌مشاهده نبود
 * (چون خیلی از UI Kit ها input واقعی را مخفی و استایل را روی label می‌گذارند)،
 * باید selector را روی خودِ label یا wrapper قابل‌کلیک بدهی، نه input خام.
 */
export async function safeCheck(
    page: Page,
    checkboxInputSelector: string,
    clickableSelector: string,
    options?: WaitForElementOptions
): Promise<void> {
    const checkboxInput = page.locator(checkboxInputSelector);
    const alreadyChecked = await checkboxInput.isChecked().catch(() => false);
    if (alreadyChecked) return;

    await safeClick(page, clickableSelector, options);
}

/**
 * بررسی سریع (بدون پرتاب خطا) که آیا selector ظرف مهلت کوتاهی ظاهر می‌شود یا نه.
 * برای تشخیص شرطی مثل "آیا مرحله OTP نمایش داده شده یا مستقیم رد شدیم؟" کاربرد دارد.
 */
export async function isElementVisibleSoon(
    page: Page,
    selector: string,
    timeoutMs: number = 8000
): Promise<boolean> {
    try {
        await waitForElementReady(page, selector, {
            timeoutMs,
            pollIntervalMs: 500,
            requireStable: false,
        });
        return true;
    } catch {
        return false;
    }
}

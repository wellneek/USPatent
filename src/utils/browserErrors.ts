export class BrowserDiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserDiedError";
  }
}

export function isBrowserClosedError(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return /Target page, context or browser has been closed|browser has been closed|Browser closed|Target closed/i.test(msg);
}

export class PageLoadTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PageLoadTimeoutError";
    }
}
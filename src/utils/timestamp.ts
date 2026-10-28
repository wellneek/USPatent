/** زمان محلی به شکل "2026-09-23 14:05:09" (هم‌راستا با ساعت محلی StopController) */
export function nowStamp(d: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    );
}

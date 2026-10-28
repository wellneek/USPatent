import { createWorker, PSM, Worker } from "tesseract.js";
import sharp from "sharp";

type SharpInstance = ReturnType<typeof sharp>;

export interface OcrSolveResult {
    answer: string;
    expression: string;
    confidence: number;
}

interface OcrCandidate {
    text: string;
    confidence: number;
    variantIndex: number;
}

/**
 * Exact pattern: one digit + one digit [=]
 * Only candidates matching this pattern are valid.
 */
const VALID_PATTERN = /^\d\+\d=?$/;

function parseExpression(
    raw: string
): { a: number; b: number; rawMatch: string } | null {
    const cleaned = raw.replace(/[\s\n\r]/g, "").trim();

    const match = cleaned.match(/^(\d)\+(\d)=?$/);

    if (!match) {
        return null;
    }

    return {
        a: Number(match[1]),
        b: Number(match[2]),
        rawMatch: cleaned,
    };
}

export class MathOcrSolver {
    private workerPromise: Promise<Worker> | null = null;

    constructor(private minConfidence = 0) {}

    private getWorker(): Promise<Worker> {
        if (!this.workerPromise) {
            this.workerPromise = (async () => {
                const worker = await createWorker("eng");

                await worker.setParameters({
                    tessedit_char_whitelist: "0123456789+=",
                    tessedit_pageseg_mode: PSM.SINGLE_LINE,
                });

                return worker;
            })();
        }
        return this.workerPromise;
    }

    private async buildVariants(png: Buffer): Promise<Buffer[]> {
        const meta = await sharp(png).metadata();
        const originalWidth = meta.width ?? 60;
        const targetWidth = Math.max(originalWidth * 4, 240);

        const createBase = () =>
            sharp(png)
                .flatten({ background: "#ffffff" })
                .grayscale()
                .resize({ width: targetWidth, kernel: "lanczos3" });

        const finish = (image: SharpInstance) =>
            image
                .extend({
                    top: 20,
                    bottom: 20,
                    left: 20,
                    right: 20,
                    background: "#ffffff",
                })
                .png()
                .toBuffer();

        return Promise.all([
            finish(createBase().normalise()),
            finish(createBase().normalise().threshold(128)),
            finish(createBase().normalise().threshold(160)),
            finish(createBase().normalise().threshold(190)),
            finish(createBase().normalise().threshold(210)),
        ]);
    }

    private normalizeText(text: string): string {
        return text.replace(/[\s\n\r]/g, "").trim();
    }

    private async recognizeVariants(
        worker: Worker,
        variants: Buffer[]
    ): Promise<OcrCandidate[]> {
        const candidates: OcrCandidate[] = [];

        for (let i = 0; i < variants.length; i++) {
            const { data } = await worker.recognize(variants[i]);
            const text = this.normalizeText(data.text);

            console.log(`\n📊 Variant ${i + 1}:`);
            console.log("   Text:", JSON.stringify(data.text));
            console.log("   Normalized:", JSON.stringify(text));
            console.log("   Confidence:", data.confidence);

            if (!text) continue;

            candidates.push({
                text,
                confidence: data.confidence,
                variantIndex: i,
            });
        }

        return candidates;
    }

    /**
     * Filter: only candidates matching "one digit + one digit [=]"
     */
    private filterByPattern(
        candidates: OcrCandidate[]
    ): OcrCandidate[] {
        const filtered = candidates.filter((c) =>
            VALID_PATTERN.test(this.normalizeText(c.text))
        );

        console.log(
            `\n🔍 Pattern filter: ${candidates.length} → ${filtered.length} valid`
        );

        for (const c of candidates) {
            const valid = VALID_PATTERN.test(this.normalizeText(c.text));
            console.log(
                `   ${valid ? "✅" : ""} "${c.text}" (confidence=${c.confidence})`
            );
        }

        return filtered;
    }

    /**
     * Group + sum confidence
     */
    private groupAndScore(
        candidates: OcrCandidate[]
    ): Map<string, { items: OcrCandidate[]; totalConfidence: number }> {
        const groups = new Map<
            string,
            { items: OcrCandidate[]; totalConfidence: number }
        >();

        for (const candidate of candidates) {
            const key = this.normalizeText(candidate.text);
            const existing = groups.get(key);

            if (existing) {
                existing.items.push(candidate);
                existing.totalConfidence += candidate.confidence;
            } else {
                groups.set(key, {
                    items: [candidate],
                    totalConfidence: candidate.confidence,
                });
            }
        }

        return groups;
    }

    /**
     * Final selection:
     *  1. Most repetitions (variant count)
     *  2. If tied → highest total confidence
     */
    private selectCandidate(
        candidates: OcrCandidate[]
    ): OcrCandidate | null {
        if (candidates.length === 0) return null;

        const groups = this.groupAndScore(candidates);

        console.log("\n📊 Grouped results:");

        let best: {
            text: string;
            items: OcrCandidate[];
            totalConfidence: number;
        } | null = null;

        for (const [text, { items, totalConfidence }] of groups) {
            console.log(
                `   "${text}" → count=${items.length}, sumConfidence=${totalConfidence.toFixed(1)}`
            );

            if (!best) {
                best = { text, items, totalConfidence };
                continue;
            }

            if (items.length > best.items.length) {
                best = { text, items, totalConfidence };
                continue;
            }

            if (
                items.length === best.items.length &&
                totalConfidence > best.totalConfidence
            ) {
                best = { text, items, totalConfidence };
            }
        }

        if (!best) return null;

        const representative = [...best.items].sort(
            (a, b) => b.confidence - a.confidence
        )[0];

        representative.confidence = best.totalConfidence;

        return representative;
    }

    async solve(png: Buffer): Promise<OcrSolveResult | null> {
        try {
            const worker = await this.getWorker();
            const variants = await this.buildVariants(png);

            console.log(`\n🔍 OCR: ${variants.length} variants`);

            const rawCandidates = await this.recognizeVariants(worker, variants);

            if (rawCandidates.length === 0) {
                console.log("\n❌ No OCR candidates");
                return null;
            }

            console.log("\n📋 Raw Candidates:");
            for (const c of rawCandidates) {
                console.log(
                    `   Variant ${c.variantIndex + 1}:`,
                    JSON.stringify(c.text),
                    `confidence=${c.confidence}`
                );
            }

            const validCandidates = this.filterByPattern(rawCandidates);

            if (validCandidates.length === 0) {
                console.log("❌ No candidates match the pattern \\d+\\d=?");
                return null;
            }

            const selected = this.selectCandidate(validCandidates);

            if (!selected) return null;

            console.log(
                "\n🏆 Selected:",
                JSON.stringify(selected.text),
                `confidence=${selected.confidence.toFixed(1)}`
            );

            const parsed = parseExpression(selected.text);

            if (!parsed) {
                console.log("❌ Selected OCR text is not a valid expression");
                return null;
            }

            const answer = parsed.a + parsed.b;

            const result: OcrSolveResult = {
                answer: String(answer),
                expression: `${parsed.a}+${parsed.b}`,
                confidence: selected.confidence,
            };

            console.log("✅ Result:", result);
            return result;
        } catch (error) {
            console.error("OCR error:", error);
            return null;
        }
    }

    async dispose(): Promise<void> {
        if (!this.workerPromise) return;
        try {
            const worker = await this.workerPromise;
            await worker.terminate();
        } finally {
            this.workerPromise = null;
        }
    }
}
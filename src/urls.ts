import "dotenv/config";
import { Database } from "./db/Database";

const [, , cmd, ...args] = process.argv;

async function list() {
    const db = Database.getInstance();
    const [rows] = await db.pool.query(
        "SELECT id, db_type, date_from, date_to, url, extensions_to_download, status, created_at FROM urls ORDER BY id ASC"
    );
    console.log("\n=== URLs in database ===");
    console.table(rows);
    const [summary] = await db.pool.query(
        "SELECT status, COUNT(*) AS n FROM urls GROUP BY status"
    );
    console.log("Summary by status:");
    console.table(summary);
    await db.close();
}

async function addOne() {
    const [url, extensions] = args;
    if (!url) {
        console.error("Usage: ts-node src/urls.ts add <url> [extensions=tar,zip]");
        process.exit(1);
    }
    const exts = (extensions || "tar,zip").split(",").map((s) => s.trim()).filter(Boolean);
    
    // استخراج خودکار نوع دیتاست و تاریخ‌ها از لینک
    const urlObj = new URL(url);
    const dbType = urlObj.pathname.split("/").pop() || "ptgrmp2";
    const dateFrom = urlObj.searchParams.get("fileDataFromDate") || "2020-01-01";
    const dateTo = urlObj.searchParams.get("fileDataToDate") || "2020-01-31";

    const db = Database.getInstance();
    const [result] = await db.pool.query(
        "INSERT INTO urls (db_type, date_from, date_to, url, extensions_to_download, status) VALUES (?, ?, ?, ?, ?, 'draft')",
        [dbType, dateFrom, dateTo, url, exts.join(",")]
    );
    console.log("Inserted:", result);
    await db.close();
}

async function addBulk() {
    const [filePath] = args;
    if (!filePath) {
        console.error("Usage: ts-node src/urls.ts addBulk <path-to-file.txt>");
        process.exit(1);
    }
    const fs = await import("fs/promises");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

    const db = Database.getInstance();
    let inserted = 0;
    for (const line of lines) {
        const [url, extPart] = line.split("|");
        const exts = (extPart || "tar,zip").split(",").map((s) => s.trim()).filter(Boolean);
        
        // استخراج خودکار نوع دیتاست و تاریخ‌ها از لینک
        const urlObj = new URL(url.trim());
        const dbType = urlObj.pathname.split("/").pop() || "ptgrmp2";
        const dateFrom = urlObj.searchParams.get("fileDataFromDate") || "2020-01-01";
        const dateTo = urlObj.searchParams.get("fileDataToDate") || "2020-01-31";

        await db.pool.query(
            "INSERT INTO urls (db_type, date_from, date_to, url, extensions_to_download, status) VALUES (?, ?, ?, ?, ?, 'draft')",
            [dbType, dateFrom, dateTo, url.trim(), exts.join(",")]
        );
        inserted++;
    }
    console.log(`Inserted ${inserted} URLs from ${filePath}`);
    await db.close();
}

async function clearAll() {
    const db = Database.getInstance();
    await db.pool.query("DELETE FROM urls");
    console.log("Cleared all URLs.");
    await db.close();
}

async function main() {
    if (cmd === "list") return list();
    if (cmd === "add") return addOne();
    if (cmd === "addBulk") return addBulk();
    if (cmd === "clear") return clearAll();
    console.error("Commands:\n  list\n  add <url> [extensions=tar,zip]\n  addBulk <path-to-file.txt>\n  clear");
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
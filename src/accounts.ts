import "dotenv/config";
import { Database } from "./db/Database";

const [, , cmd, ...args] = process.argv;

async function list() {
    const db = Database.getInstance();
    const [rows] = await db.pool.query(
        "SELECT id, username, priority, is_active, " +
        "IF(2fa_secret IS NOT NULL AND 2fa_secret != '', 'YES', 'NO') AS has_2fa, " +
        "success_login_count, failed_login_count, last_used_at " +
        "FROM accounts ORDER BY priority ASC, id ASC"
    );
    console.log("\n=== Accounts in database ===");
    console.table(rows);
    const [summary] = await db.pool.query(
        "SELECT is_active, COUNT(*) AS n FROM accounts GROUP BY is_active"
    );
    console.log("Summary by is_active:");
    console.table(summary);
    await db.close();
}

async function add() {
    const [username, password, twoFa, priorityStr] = args;
    if (!username || !password) {
        console.error("Usage: ts-node src/accounts.ts add <username> <password> [2fa_secret] [priority]");
        process.exit(1);
    }
    const priority = priorityStr ? parseInt(priorityStr, 10) : 100;
    const db = Database.getInstance();
    const [result] = await db.pool.query(
        "INSERT INTO accounts " +
        "(username, password, `2fa_secret`, priority, is_active, success_login_count, failed_login_count) " +
        "VALUES (?, ?, ?, ?, 1, 0, 0)",
        [username, password, twoFa || null, priority]
    );
    console.log("Inserted:", result);
    await db.close();
}

async function del() {
    const [idStr] = args;
    if (!idStr) {
        console.error("Usage: ts-node src/accounts.ts delete <id>");
        process.exit(1);
    }
    const id = parseInt(idStr, 10);
    const db = Database.getInstance();
    const [result]: any = await db.pool.query("DELETE FROM accounts WHERE id = ?", [id]);
    console.log(`Deleted id=${id}, affectedRows=${result.affectedRows}`);
    await db.close();
}

async function delAll() {
    const db = Database.getInstance();
    const [result]: any = await db.pool.query("DELETE FROM accounts");
    console.log(`Deleted all accounts, affectedRows=${result.affectedRows}`);
    await db.close();
}

async function main() {
    if (cmd === "list") return list();
    if (cmd === "add") return add();
    if (cmd === "delete") return del();
    if (cmd === "deleteAll") return delAll();
    console.error("Commands:\n  list\n  add <username> <password> [2fa_secret] [priority=100]\n  delete <id>\n  deleteAll");
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
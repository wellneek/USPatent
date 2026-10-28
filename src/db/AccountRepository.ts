import { Database } from "./Database";
import { Account } from "../types";

export class AccountRepository {
  constructor(private db: Database = Database.getInstance()) {}

  /**
   * اکانت فعالی که کمترین اولویت عددی (یعنی بیشترین اولویت واقعی) را دارد
   * و کمتر از همه به تازگی استفاده شده، برمی‌گرداند.
   * الگوریتم انتخاب دقیق (round-robin؟ least-recently-used؟) را بعداً می‌توان تنظیم کرد.
   */
  async pickNextAvailableAccount(): Promise<Account | null> {
    const [rows] = await this.db.pool.query(
      `SELECT * FROM accounts
       WHERE is_active = 1
       ORDER BY priority ASC, last_used_at ASC
       LIMIT 1`
    );
    const list = rows as any[];
    if (list.length === 0) return null;
    return this.mapRow(list[0]);
  }

  async markLoginSuccess(accountId: number): Promise<void> {
    await this.db.pool.query(
      `UPDATE accounts
       SET success_login_count = success_login_count + 1,
           last_used_at = NOW()
       WHERE id = ?`,
      [accountId]
    );
  }

  async markLoginFailure(accountId: number): Promise<void> {
    await this.db.pool.query(
      `UPDATE accounts
       SET failed_login_count = failed_login_count + 1,
           last_used_at = NOW()
       WHERE id = ?`,
      [accountId]
    );
  }

  private mapRow(row: any): Account {
    return {
      id: row.id,
      username: row.username,
      password: row.password,
      twoFaSecret: row["2fa_secret"] ?? null,
      priority: row.priority,
      isActive: !!row.is_active,
      lastUsedAt: row.last_used_at,
      successLoginCount: row.success_login_count,
      failedLoginCount: row.failed_login_count,
    };
  }
}

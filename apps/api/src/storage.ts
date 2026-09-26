// ===== M7: storage.ts 改为 SQLite DAO 委托层，保持原有导出签名不变 =====
import { resolve } from "node:path";
import * as db from "./db.js";

/** The subset of a case that is persisted between API restarts. */
export type StoredCase = db.StoredCase;

/** 兼容旧调用：返回数据文件路径（SQLite 模式下仍可用作参考）。 */
export const getCasesFile = (): string =>
  resolve(process.env.BALABALA_CASES_FILE ?? resolve(process.cwd(), ".data", "cases.json"));

/** Load persisted cases from SQLite. */
export async function loadCases(_filePath?: string): Promise<StoredCase[]> {
  db.initDb();
  return db.getAllCases();
}

/**
 * Persist the complete snapshot by upserting each case into SQLite.
 * Existing rows are replaced via INSERT OR REPLACE.
 */
export async function saveCases(cases: Iterable<StoredCase>, _filePath?: string): Promise<void> {
  db.initDb();
  for (const c of cases) {
    db.upsertCase(c);
  }
}

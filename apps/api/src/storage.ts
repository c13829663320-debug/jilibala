import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { Verdict } from "@balabala/shared";

/** The subset of a case that is persisted between API restarts. */
export type StoredCase = {
  id: string;
  input: string;
  verdict?: Verdict;
  shareToken?: string;
  /** ISO timestamps are optional to keep old data files readable. */
  createdAt?: string;
  updatedAt?: string;
};

type StorageDocument = {
  version: 1;
  cases: StoredCase[];
};

/**
 * Keep the file outside the source tree by default. Deployments can point this
 * at a durable volume with BALABALA_CASES_FILE.
 */
export const getCasesFile = (): string => resolve(
  process.env.BALABALA_CASES_FILE ?? resolve(process.cwd(), ".data", "cases.json"),
);

const isStoredCase = (value: unknown): value is StoredCase => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredCase>;
  return typeof candidate.id === "string" && typeof candidate.input === "string";
};

/** Load persisted cases. A missing file is the normal first-run state. */
export async function loadCases(filePath = getCasesFile()): Promise<StoredCase[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { cases?: unknown }).cases)
        ? (parsed as { cases: unknown[] }).cases
        : [];
    return values.filter(isStoredCase);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // A malformed or unreadable archive should not prevent the API from
    // starting. The next successful write replaces it with valid JSON.
    return [];
  }
}

/**
 * Persist the complete snapshot using a temporary file and rename. Rename is
 * atomic on the filesystems used by the API; the Windows fallback handles a
 * pre-existing destination where rename cannot replace it directly.
 */
export async function saveCases(cases: Iterable<StoredCase>, filePath = getCasesFile()): Promise<void> {
  const document: StorageDocument = { version: 1, cases: [...cases] };
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      // Node's Windows rename does not replace an existing file. The short
      // fallback still guarantees readers see either the old or new complete
      // JSON document (never a partially written file).
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

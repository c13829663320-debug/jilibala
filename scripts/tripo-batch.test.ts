// ===== R4-10: Tripo 批量脚本单测（纯逻辑 + mock client，无网络）=====
import { describe, expect, it, vi } from "vitest";
import {
  TripoBatchError,
  planOutputPath,
  runTripoBatch,
  validateBatchInput,
  validateCharacterInput,
  type CharacterInputItem,
  type TripoApiClient,
} from "./tripo-batch.js";

const goodItem = (over: Partial<CharacterInputItem> = {}): CharacterInputItem => ({
  id: "confucius",
  name: "孔子",
  prompt: "一位春秋时期的中国古代圣人半身像，长袍，PBR 材质",
  ...over,
});

/** 始终成功的 mock 客户端。 */
function okClient(now = vi.fn()): TripoApiClient {
  return {
    createTask: vi.fn(async (item) => ({ taskId: `task-${item.id}` })),
    waitForModel: vi.fn(async () => ({ modelUrl: "https://cdn.example/x.glb" })),
    downloadGlb: vi.fn(async () => { now(); }),
  };
}

describe("validateCharacterInput · 输入校验", () => {
  it("合法条目原样规范化返回", () => {
    const item = validateCharacterInput(goodItem());
    expect(item.id).toBe("confucius");
    expect(item.referenceImage).toBeUndefined();
  });

  it("id 含非法字符 → BAD_ID", () => {
    expect(() => validateCharacterInput(goodItem({ id: "../etc" }))).toThrowError(/id 非法/);
  });

  it("prompt 过短 → BAD_PROMPT", () => {
    expect(() => validateCharacterInput(goodItem({ prompt: "太短" }))).toThrowError(/prompt 过短/);
  });

  it("referenceImage 非 http URL → BAD_REFERENCE", () => {
    expect(() => validateCharacterInput(goodItem({ referenceImage: "ftp://x/y.png" }))).toThrowError(/referenceImage/);
  });

  it("重复 id → DUP_ID", () => {
    expect(() =>
      validateBatchInput([goodItem(), goodItem({ name: "另一个孔子" })]),
    ).toThrowError(/重复的 id/);
  });

  it("空数组 / 非数组 → BAD_INPUT", () => {
    expect(() => validateBatchInput([])).toThrowError(TripoBatchError);
    expect(() => validateBatchInput("nope")).toThrowError(/非空数组/);
  });
});

describe("planOutputPath", () => {
  it("输出路径为 <outDir>/<id>.glb", () => {
    expect(planOutputPath("li-bai", "/tmp/models")).toMatch(/\/li-bai\.glb$/);
  });
});

describe("runTripoBatch · dry-run", () => {
  it("dry-run 完整跑通：不联网、全部 ok、outPath 正确", async () => {
    const logs: string[] = [];
    const results = await runTripoBatch(
      [goodItem({ id: "a" }), goodItem({ id: "b" })],
      { dryRun: true, outDir: "/tmp/models", onProgress: (s, id) => logs.push(`${s}:${id}`) },
    );
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe("ok");
      expect(r.dryRun).toBe(true);
      expect(r.outPath).toMatch(/\.glb$/);
    }
    expect(logs).toContain("batch_start:*");
    expect(logs).toContain("batch_done:*");
    expect(logs).toContain("dry_run:a");
  });

  it("dry-run 下即使输入非法也先抛校验错误（不进入执行）", async () => {
    await expect(
      runTripoBatch([goodItem({ id: "bad id!" })], { dryRun: true }),
    ).rejects.toThrowError(/id 非法/);
  });
});

describe("runTripoBatch · 并发与重试", () => {
  it("非 dry-run 但无 API key → NO_API_KEY", async () => {
    await expect(
      runTripoBatch([goodItem()], { apiKey: "" }),
    ).rejects.toThrowError(/TRIPO_API_KEY/);
  });

  it("成功路径：注入 client，download 被调用，status=ok", async () => {
    const client = okClient();
    const results = await runTripoBatch([goodItem({ id: "x" })], {
      dryRun: false,
      apiKey: "fake",
      client,
      outDir: "/tmp/out",
    });
    expect(results[0].status).toBe("ok");
    expect(results[0].attempts).toBe(1);
    expect(client.createTask).toHaveBeenCalledOnce();
    expect(client.downloadGlb).toHaveBeenCalledOnce();
  });

  it("失败重试：前 2 次失败、第 3 次成功 → attempts=3, status=ok", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("网络抖动"))
      .mockRejectedValueOnce(new Error("网络抖动"))
      .mockResolvedValue({ taskId: "task-1" });
    const client: TripoApiClient = {
      createTask: create as TripoApiClient["createTask"],
      waitForModel: vi.fn(async () => ({ modelUrl: "https://cdn.example/x.glb" })),
      downloadGlb: vi.fn(async () => {}),
    };
    const results = await runTripoBatch([goodItem({ id: "retry-me" })], {
      dryRun: false, apiKey: "fake", client, retries: 3, outDir: "/tmp/out",
    });
    expect(results[0].status).toBe("ok");
    expect(results[0].attempts).toBe(3);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("持续失败：retries=3 全失败 → status=failed, attempts=3", async () => {
    const client: TripoApiClient = {
      createTask: vi.fn(async () => { throw new Error("500"); }),
      waitForModel: vi.fn(async () => ({ modelUrl: "" })),
      downloadGlb: vi.fn(async () => {}),
    };
    const logs: string[] = [];
    const results = await runTripoBatch([goodItem({ id: "doomed" })], {
      dryRun: false, apiKey: "fake", client, retries: 3, outDir: "/tmp/out",
      onProgress: (s, id, d) => logs.push(`${s}:${id}:${d ?? ""}`),
    });
    expect(results[0].status).toBe("failed");
    expect(results[0].attempts).toBe(3);
    expect(results[0].error).toBeTruthy();
    // 应记录 2 次 retry 日志（第 3 次失败不重试）
    expect(logs.filter((l) => l.startsWith("retry:"))).toHaveLength(2);
  });

  it("并发上限：用慢 client 验证同一时刻最多 concurrency 个在跑", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slowClient: TripoApiClient = {
      createTask: vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { taskId: "t" };
      }),
      waitForModel: vi.fn(async () => ({ modelUrl: "u" })),
      downloadGlb: vi.fn(async () => {}),
    };
    const items = Array.from({ length: 6 }, (_, i) => goodItem({ id: `p${i}` }));
    await runTripoBatch(items, {
      dryRun: false, apiKey: "fake", client: slowClient, concurrency: 3, outDir: "/tmp/out",
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBe(3); // 6 个任务一定打满过并发
  });

  it("concurrency 越界 → BAD_CONCURRENCY", async () => {
    await expect(
      runTripoBatch([goodItem()], { dryRun: true, concurrency: 99 }),
    ).rejects.toThrowError(/concurrency 必须在/);
  });
});

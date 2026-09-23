// ===== db.ts DAO 测试：每个 describe 用独立临时 SQLite 文件，禁止真实网络 =====
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  User,
  CertRecord,
  MsgRecord,
  ContentComment,
  SceneId,
  Verdict,
} from "@balabala/shared";

type DbModule = typeof import("./db.js");

/**
 * 以独立临时文件加载 db 模块：
 * 在 import 前设置 process.env.DB_PATH，并用 vi.resetModules() 让模块级
 * `new DatabaseSync(DB_PATH)` 指向临时文件，测试结束后关闭并删除。
 */
async function loadDb(): Promise<{ mod: DbModule; dbPath: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "balabala-db-"));
  const dbPath = join(dir, "test.db");
  process.env.DB_PATH = dbPath;
  vi.resetModules();
  const mod = await import("./db.js");
  return { mod, dbPath, dir };
}

function makeVerdict(over: Partial<Verdict> = {}): Verdict {
  return {
    caseNo: "(2026)深法赔字第1号",
    title: "测试案件",
    charge: "测试罪名",
    sentence: "测试量刑",
    facts: "测试事实",
    plaintiffClaim: "原告诉求",
    defense: "被告答辩",
    judgeNote: "法官寄语",
    quote: "金句",
    ...over,
  };
}

describe("db DAO", () => {
  let ctx: { mod: DbModule; dbPath: string; dir: string };

  beforeEach(async () => {
    ctx = await loadDb();
  });

  afterAll(() => {
    try {
      ctx.mod.db.close();
    } catch {
      // 已关闭可忽略
    }
    try {
      rmSync(ctx.dir, { recursive: true, force: true });
    } catch {
      // Windows 下偶发句柄延迟释放，忽略
    }
    delete process.env.DB_PATH;
  });

  it("案件：upsertCase -> getCase 字段回读一致", () => {
    const c = {
      id: randomUUID(),
      input: "有人拖欠外卖配送费",
      verdict: makeVerdict({ title: "外卖费案" }),
      userId: "user-a",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    ctx.mod.upsertCase(c);
    const got = ctx.mod.getCase(c.id);
    expect(got).toBeDefined();
    expect(got!.input).toBe(c.input);
    expect(got!.userId).toBe("user-a");
    expect(got!.verdict?.title).toBe("外卖费案");
  });

  it("案件：getCase 不存在时返回 undefined", () => {
    expect(ctx.mod.getCase("no-such-id")).toBeUndefined();
  });

  it("案件：getAllCases 返回全部案件", () => {
    ctx.mod.upsertCase({ id: randomUUID(), input: "a", createdAt: "2026-01-01T00:00:00.000Z" });
    ctx.mod.upsertCase({ id: randomUUID(), input: "b", createdAt: "2026-01-02T00:00:00.000Z" });
    expect(ctx.mod.getAllCases().length).toBe(2);
  });

  it("案件：deleteCase 删除后 getCase 为 undefined", () => {
    const id = randomUUID();
    ctx.mod.upsertCase({ id, input: "x", createdAt: "2026-01-01T00:00:00.000Z" });
    ctx.mod.deleteCase(id);
    expect(ctx.mod.getCase(id)).toBeUndefined();
  });

  it("案件：getCasesByUser 按 user_id 过滤", () => {
    ctx.mod.upsertCase({ id: randomUUID(), input: "u1", userId: "u1", createdAt: "2026-01-01T00:00:00.000Z" });
    ctx.mod.upsertCase({ id: randomUUID(), input: "u2", userId: "u2", createdAt: "2026-01-01T00:00:00.000Z" });
    const u1 = ctx.mod.getCasesByUser("u1");
    expect(u1.length).toBe(1);
    expect(u1[0].input).toBe("u1");
  });

  it("内容：upsertContent -> getContent 回读 topics/likes", () => {
    const id = randomUUID();
    ctx.mod.upsertContent({
      id,
      type: "text",
      scene: "all",
      author: "小明",
      createdAt: "2026-01-01T00:00:00.000Z",
      topics: ["外卖", "纠纷"],
      title: "我的第一次开庭",
      body: "正文",
      likes: 3,
      dislikes: 1,
      views: 10,
      comments: [],
    });
    const got = ctx.mod.getContent(id);
    expect(got).toBeDefined();
    expect(got!.title).toBe("我的第一次开庭");
    expect(got!.topics).toEqual(["外卖", "纠纷"]);
    expect(got!.likes).toBe(3);
  });

  it("内容：getAllContents 返回全部内容", () => {
    ctx.mod.upsertContent({
      id: randomUUID(), type: "text", scene: "all", author: "a",
      createdAt: "2026-01-01T00:00:00.000Z", topics: [], title: "t1", likes: 0, dislikes: 0, views: 0, comments: [],
    });
    expect(ctx.mod.getAllContents().length).toBe(1);
  });

  it("评论：addComment -> getComments 回读", () => {
    const cid = randomUUID();
    ctx.mod.upsertContent({
      id: cid, type: "text", scene: "all", author: "a",
      createdAt: "2026-01-01T00:00:00.000Z", topics: [], title: "t", likes: 0, dislikes: 0, views: 0, comments: [],
    });
    const comment: ContentComment = { id: randomUUID(), author: "路人", text: "说得好", createdAt: "2026-01-02T00:00:00.000Z" };
    ctx.mod.addComment(cid, comment);
    const comments = ctx.mod.getComments(cid);
    expect(comments.length).toBe(1);
    expect(comments[0].text).toBe("说得好");
  });

  it("反应：同一用户同一反应重复 addReaction 去重，计数不增加", () => {
    const cid = randomUUID();
    ctx.mod.upsertContent({
      id: cid, type: "text", scene: "all", author: "a",
      createdAt: "2026-01-01T00:00:00.000Z", topics: [], title: "t", likes: 0, dislikes: 0, views: 0, comments: [],
    });
    const r1 = ctx.mod.addReaction(cid, "user-x", "like");
    const r2 = ctx.mod.addReaction(cid, "user-x", "like");
    expect(r1.likes).toBe(1);
    expect(r2.likes).toBe(1);
  });

  it("反应：不同用户 / 不同反应分别计数", () => {
    const cid = randomUUID();
    ctx.mod.upsertContent({
      id: cid, type: "text", scene: "all", author: "a",
      createdAt: "2026-01-01T00:00:00.000Z", topics: [], title: "t", likes: 0, dislikes: 0, views: 0, comments: [],
    });
    ctx.mod.addReaction(cid, "u1", "like");
    ctx.mod.addReaction(cid, "u2", "like");
    const r = ctx.mod.addReaction(cid, "u3", "dislike");
    expect(r.likes).toBe(2);
    expect(r.dislikes).toBe(1);
  });

  it("用户：upsertUser -> getUser 回读", () => {
    const u: User = {
      userId: "u-1", nickname: "阿瓜", avatarType: "capsule",
      avatarRef: "", createdAt: "2026-01-01T00:00:00.000Z",
    };
    ctx.mod.upsertUser(u);
    const got = ctx.mod.getUser("u-1");
    expect(got?.nickname).toBe("阿瓜");
    expect(got?.avatarType).toBe("capsule");
  });

  it("用户：getUser 不存在返回 undefined", () => {
    expect(ctx.mod.getUser("nobody")).toBeUndefined();
  });

  it("证书：addCertificate -> getCertificates 回读", () => {
    const cert: CertRecord = {
      id: randomUUID(), userId: "u1", caseId: "c1",
      caseTitle: "外卖费案", verdict: "胜诉", charge: "拖欠配送费",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    ctx.mod.addCertificate(cert);
    const list = ctx.mod.getCertificates("u1");
    expect(list.length).toBe(1);
    expect(list[0].caseTitle).toBe("外卖费案");
  });

  it("消息：addMessage -> getMessages -> markMessageRead", () => {
    const msg: MsgRecord = {
      id: randomUUID(), userId: "u1", kind: "court",
      title: "判决已出", summary: "恭喜胜诉", read: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    ctx.mod.addMessage(msg);
    const before = ctx.mod.getMessages("u1");
    expect(before.length).toBe(1);
    expect(before[0].read).toBe(false);
    ctx.mod.markMessageRead("u1", msg.id);
    const after = ctx.mod.getMessages("u1");
    expect(after[0].read).toBe(true);
  });

  it("场景记录：addSceneRecord -> getSceneRecord 回读 payload", () => {
    const rec = ctx.mod.addSceneRecord({
      userId: "u1", scene: "bar" as SceneId, sessionId: "sess-1",
      title: "酒吧发言", payload: { text: "干杯" },
    });
    const got = ctx.mod.getSceneRecord(rec.id);
    expect(got?.title).toBe("酒吧发言");
    expect(got?.payload).toEqual({ text: "干杯" });
  });

  it("狼人杀对局：addWerewolfGame -> getWerewolfGamesByUser", () => {
    ctx.mod.addWerewolfGame({
      userId: "host-1", gameId: "g-1",
      payload: { winner: "good", totalDays: 3 },
    });
    const list = ctx.mod.getWerewolfGamesByUser("host-1");
    expect(list.length).toBe(1);
    expect(list[0].payload).toEqual({ winner: "good", totalDays: 3 });
  });

  it("重启持久化：写入后关闭连接、重新打开同一文件，数据仍在", async () => {
    const id = randomUUID();
    ctx.mod.upsertCase({ id, input: "需要持久化的案件", userId: "u1", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(existsSync(ctx.dbPath)).toBe(true);
    // 关闭当前连接。
    ctx.mod.db.close();
    // 同一 DB_PATH 重新 import，相当于进程重启后重新打开。
    vi.resetModules();
    const reopened = (await import("./db.js")) as DbModule;
    const got = reopened.getCase(id);
    expect(got).toBeDefined();
    expect(got!.input).toBe("需要持久化的案件");
    reopened.db.close();
    // 清理在 afterAll 统一做。
    ctx.mod = reopened;
  });
});

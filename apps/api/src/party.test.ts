// ===== R5: 组队 / 约局服务端测试 =====
// 每个文件用独立临时 SQLite（DB_PATH）+ 动态 import，避免并行测试 database is locked。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type PartyMod = typeof import("./party.js");
type FriendsMod = typeof import("./friends.js");
type DbMod = typeof import("./db.js");

let party: PartyMod;
let friends: FriendsMod;
let db: DbMod;
let tmpDir: string;

const online = new Set<string>();
const inbox = new Map<string, unknown[]>();

async function loadModules(): Promise<void> {
  tmpDir = mkdtempSync(join(tmpdir(), "balabala-party-"));
  process.env.DB_PATH = join(tmpDir, "test.db");
  process.env.BALABALA_TEST_DATA_DIR = tmpDir;
  vi.resetModules();
  db = await import("./db.js");
  friends = await import("./friends.js");
  friends.setPresenceProvider({
    isOnline: (uid) => online.has(uid),
    getSocialRoomCode: () => undefined,
    sendToUser: (uid, msg) => push(uid, msg),
  });
  party = await import("./party.js");
  party.setPartyPresenceProvider({
    isOnline: (uid) => online.has(uid),
    sendToUser: (uid, msg) => push(uid, msg),
  });
}

function push(uid: string, msg: unknown): void {
  const list = inbox.get(uid) ?? [];
  list.push(msg);
  inbox.set(uid, list);
}

/** 让 u1 与 u2 成为好友。 */
function makeFriends(a: string, b: string): void {
  const req = friends.sendRequest(a, b);
  friends.acceptRequest(req.requestId, b);
}

beforeEach(async () => {
  online.clear();
  inbox.clear();
  await loadModules();
  party._resetPartyForTest();
  friends._resetFriendsForTest();
  online.add("u1").add("u2").add("u3").add("u4");
  db.upsertUser({ userId: "u1", nickname: "队长", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u2", nickname: "队友甲", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u3", nickname: "队友乙", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
  db.upsertUser({ userId: "u4", nickname: "路人", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.DB_PATH;
  delete process.env.BALABALA_TEST_DATA_DIR;
});

describe("创建队伍", () => {
  it("创建后发起者成为队长并收到 party_created", () => {
    inbox.set("u1", []);
    const p = party.createParty("u1");
    expect(p.leaderId).toBe("u1");
    expect(p.members).toHaveLength(1);
    expect(p.members[0].isLeader).toBe(true);
    expect(p.status).toBe("forming");
    const createdMsg = inbox.get("u1")?.[0] as { type: string; party: { partyId: string } };
    expect(createdMsg).toMatchObject({ type: "party_created" });
    expect(createdMsg.party.partyId).toBe(p.partyId);
  });

  it("重复创建会先退出旧队伍", () => {
    const p1 = party.createParty("u1");
    const p2 = party.createParty("u1");
    expect(p2.partyId).not.toBe(p1.partyId);
    expect(party.getParty(p1.partyId)).toBeUndefined();
    expect(party.getPartyOfUser("u1")?.partyId).toBe(p2.partyId);
  });
});

describe("邀请与加入", () => {
  it("只能邀请好友：非好友 403", () => {
    party.createParty("u1");
    expect(() => party.inviteToParty("u1", "u4", "一起来")).toThrowError(/好友/);
  });

  it("邀请在线好友：即时收到 party_invite", () => {
    makeFriends("u1", "u2");
    party.createParty("u1");
    inbox.set("u2", []);
    const invite = party.inviteToParty("u1", "u2", "约吗");
    expect(invite.toUserId).toBe("u2");
    expect(invite.message).toBe("约吗");
    expect(inbox.get("u2")?.[0]).toMatchObject({ type: "party_invite" });
  });

  it("邀请离线好友：缓存待上线补发", () => {
    makeFriends("u1", "u2");
    party.createParty("u1");
    online.delete("u2");
    inbox.set("u2", []);
    party.inviteToParty("u1", "u2");
    expect(inbox.get("u2")?.length).toBe(0); // 离线不即时推
    // 上线补发
    online.add("u2");
    const flushed = party.flushOfflinePartyInvites("u2");
    expect(flushed).toHaveLength(1);
    expect(inbox.get("u2")?.[0]).toMatchObject({ type: "party_invite" });
  });

  it("接受邀请：加入队伍并广播 party_updated，通知队长 party_join_request", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.inviteToParty("u1", "u2");
    inbox.set("u1", []);
    inbox.set("u2", []);
    const updated = party.joinParty("u2", p.partyId);
    expect(updated.members.map((m) => m.userId)).toEqual(["u1", "u2"]);
    // 双方都收到 party_updated
    expect(inbox.get("u1")?.some((m) => (m as { type: string }).type === "party_updated")).toBe(true);
    expect(inbox.get("u2")?.some((m) => (m as { type: string }).type === "party_updated")).toBe(true);
    // 队长收到加入通知
    expect(inbox.get("u1")?.at(-1)).toMatchObject({ type: "party_join_request", userId: "u2", nickname: "队友甲" });
  });

  it("队伍已满时拒绝邀请与加入", () => {
    const p = party.createParty("u1");
    // joinParty 不校验好友关系，直接凑满 6 人（u1 + 5 个）
    const extra = ["u2", "u3", "u4", "u5", "u6"];
    for (const uid of extra) {
      db.upsertUser({ userId: uid, nickname: uid, avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
      party.joinParty(uid, p.partyId);
    }
    expect(party.getParty(p.partyId)?.members).toHaveLength(6);
    // 第 7 人加入被拒
    db.upsertUser({ userId: "u7", nickname: "u7", avatarType: "capsule", avatarRef: "", createdAt: new Date().toISOString() });
    expect(() => party.joinParty("u7", p.partyId)).toThrowError(/满/);
    // 满员时队长邀请队外好友也被拒（u7 未在队伍中）
    makeFriends("u1", "u7");
    expect(() => party.inviteToParty("u1", "u7")).toThrowError(/满/);
  });
});

describe("准备 / 选场景 / 开局", () => {
  it("全员准备 + 选场景后开局：广播 party_leader_start 给全员", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.joinParty("u2", p.partyId);
    party.setReady("u1", p.partyId, true);
    party.setReady("u2", p.partyId, true);
    inbox.set("u1", []);
    inbox.set("u2", []);

    // 未选场景先开局应 400
    expect(() => party.startGame("u1", p.partyId)).toThrowError(/场景/);

    party.chooseScene("u1", p.partyId, "court");
    const started = party.startGame("u1", p.partyId);
    expect(started.status).toBe("in-game");
    for (const uid of ["u1", "u2"]) {
      expect(inbox.get(uid)?.some((m) =>
        (m as { type: string; sceneId?: string }).type === "party_leader_start" &&
        (m as { sceneId?: string }).sceneId === "court" &&
        (m as { partyId?: string }).partyId === p.partyId,
      )).toBe(true);
    }
  });

  it("有成员未准备时拒绝开局", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.joinParty("u2", p.partyId);
    party.setReady("u1", p.partyId, true);
    party.chooseScene("u1", p.partyId, "bar");
    expect(() => party.startGame("u1", p.partyId)).toThrowError(/未准备/);
  });

  it("只有队长能选场景 / 开局", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.joinParty("u2", p.partyId);
    expect(() => party.chooseScene("u2", p.partyId, "bar")).toThrowError(/队长/);
    expect(() => party.startGame("u2", p.partyId)).toThrowError(/队长/);
  });

  it("准备状态变更广播 party_member_ready", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.joinParty("u2", p.partyId);
    inbox.set("u1", []);
    party.setReady("u2", p.partyId, true);
    expect(inbox.get("u1")?.[0]).toMatchObject({ type: "party_member_ready", userId: "u2", ready: true });
  });
});

describe("离开 / 解散", () => {
  it("普通成员离开：广播 party_updated，队伍保留", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.joinParty("u2", p.partyId);
    inbox.set("u1", []);
    party.leaveParty("u2", p.partyId);
    expect(party.getParty(p.partyId)?.members.map((m) => m.userId)).toEqual(["u1"]);
    expect(inbox.get("u1")?.at(-1)).toMatchObject({ type: "party_updated" });
  });

  it("队长离开：解散队伍并广播 party_disbanded 给全员", () => {
    makeFriends("u1", "u2");
    const p = party.createParty("u1");
    party.joinParty("u2", p.partyId);
    inbox.set("u1", []);
    inbox.set("u2", []);
    party.leaveParty("u1", p.partyId);
    expect(party.getParty(p.partyId)).toBeUndefined();
    for (const uid of ["u1", "u2"]) {
      expect(inbox.get(uid)?.some((m) => (m as { type: string }).type === "party_disbanded")).toBe(true);
    }
    expect(party.getPartyOfUser("u1")).toBeUndefined();
    expect(party.getPartyOfUser("u2")).toBeUndefined();
  });
});

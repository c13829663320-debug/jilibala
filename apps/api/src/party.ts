// ===== R5: 组队 / 约局服务端 =====
//
// 内存 Map 维护队伍状态；跨房间投递复用 ws.ts 的 PresenceProvider（与 friends/chat 同一套注入）。
// 本模块为 additive：不修改已有好友 / 私聊 / 房间 handler。
//
// 数据流：
//  - 队长 createParty -> party_created（回给队长）
//  - 队长 invite（限好友）-> party_invite 推给被邀请方；离线则缓存，上线 flush
//  - 被邀请方 joinParty -> 加入队伍 -> party_updated 广播全员 + party_join_request 通知队长
//  - 成员 setReady / 队长 chooseScene -> party_updated 广播
//  - 队长 startGame（要求全员 ready）-> party_leader_start { sceneId } 广播全员
//  - leaveParty（队长离开=解散）/ disbandParty -> party_disbanded 广播

import { randomUUID } from "node:crypto";
import type {
  Party,
  PartyInvite,
  PartyMember,
  PartyWsMessage,
  SceneId,
} from "@balabala/shared";
import { PARTY_MAX_MEMBERS } from "@balabala/shared";
import * as db from "./db.js";
import { areFriends } from "./friends.js";

/** 业务错误。 */
export class PartyError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ===== Presence 注入（由 ws.ts 注册，与 friends/chat 共用同一 provider） =====
export interface PartyPresenceProvider {
  isOnline(userId: string): boolean;
  /** 向某用户所有在线连接发一条 WS 消息。 */
  sendToUser(userId: string, msg: PartyWsMessage): void;
}

let presence: PartyPresenceProvider | null = null;
export function setPartyPresenceProvider(p: PartyPresenceProvider): void {
  presence = p;
}

// ===== 内存状态 =====
const parties = new Map<string, Party>();
/** userId -> partyId，快速定位用户当前所在队伍。 */
const userPartyIndex = new Map<string, string>();
/** 离线组队邀请缓存：toUserId -> 未处理邀请列表（上线补发）。 */
const undeliveredInvites = new Map<string, PartyInvite[]>();

/** 测试用：清空全部状态。 */
export function _resetPartyForTest(): void {
  parties.clear();
  userPartyIndex.clear();
  undeliveredInvites.clear();
}

function memberOf(userId: string): PartyMember {
  const u = db.getUser(userId);
  return {
    userId,
    nickname: u?.nickname ?? "匿名用户",
    avatarType: u?.avatarType ?? "capsule",
    avatarRef: u?.avatarRef ?? "",
    status: "not-ready",
  };
}

function partyUpdated(party: Party): Party {
  party.updatedAt = new Date().toISOString();
  return party;
}

/** 向队伍全体成员发一条消息（跨房间投递）。 */
function broadcastParty(party: Party, msg: PartyWsMessage): void {
  for (const m of party.members) {
    presence?.sendToUser(m.userId, msg);
  }
}

/** 取用户当前所在队伍；不存在则抛 404。 */
function requirePartyOfUser(userId: string): Party {
  const partyId = userPartyIndex.get(userId);
  const party = partyId ? parties.get(partyId) : undefined;
  if (!party || party.status === "disbanded") {
    throw new PartyError(404, "not_in_party", "你当前不在任何队伍中");
  }
  return party;
}

function requireParty(partyId: string): Party {
  const party = parties.get(partyId);
  if (!party || party.status === "disbanded") {
    throw new PartyError(404, "party_not_found", "队伍不存在或已解散");
  }
  return party;
}

function requireMember(party: Party, userId: string): PartyMember {
  const m = party.members.find((x) => x.userId === userId);
  if (!m) throw new PartyError(403, "not_member", "你不是该队伍成员");
  return m;
}

function requireLeader(party: Party, userId: string): void {
  if (party.leaderId !== userId) {
    throw new PartyError(403, "not_leader", "只有队长可以执行此操作");
  }
}

// ===== 对外操作 =====

/** 创建队伍：发起者成为队长，自动入队。 */
export function createParty(leaderId: string): Party {
  if (!leaderId) throw new PartyError(400, "bad_request", "leaderId 不能为空");
  // 已在队伍中则先退出旧队伍（单人同屏只能有一支队伍）
  const existing = userPartyIndex.get(leaderId);
  if (existing) leaveParty(leaderId, existing);

  const now = new Date().toISOString();
  const me = memberOf(leaderId);
  me.isLeader = true;
  me.status = "not-ready";
  const party: Party = {
    partyId: randomUUID(),
    leaderId,
    members: [me],
    status: "forming",
    createdAt: now,
    updatedAt: now,
  };
  parties.set(party.partyId, party);
  userPartyIndex.set(leaderId, party.partyId);
  presence?.sendToUser(leaderId, { type: "party_created", party: partyUpdated(party) });
  return party;
}

/** 队长邀请好友入队。 */
export function inviteToParty(leaderId: string, toUserId: string, message?: string): PartyInvite {
  if (!toUserId) throw new PartyError(400, "bad_request", "toUserId 不能为空");
  if (leaderId === toUserId) throw new PartyError(400, "self_invite", "不能邀请自己");
  const party = requirePartyOfUser(leaderId);
  requireLeader(party, leaderId);
  if (party.status !== "forming") throw new PartyError(409, "already_started", "队伍已开局，不能再邀请");
  if (party.members.some((m) => m.userId === toUserId)) {
    throw new PartyError(409, "already_member", "对方已在队伍中");
  }
  if (party.members.length >= PARTY_MAX_MEMBERS) {
    throw new PartyError(409, "party_full", `队伍已满（上限 ${PARTY_MAX_MEMBERS} 人）`);
  }
  if (!areFriends(leaderId, toUserId)) {
    throw new PartyError(403, "not_friends", "只能邀请好友");
  }

  const fromUser = db.getUser(leaderId);
  const invite: PartyInvite = {
    inviteId: randomUUID(),
    partyId: party.partyId,
    fromUserId: leaderId,
    fromNickname: fromUser?.nickname ?? "匿名用户",
    toUserId,
    message: message?.slice(0, 120),
    createdAt: new Date().toISOString(),
  };

  if (presence?.isOnline(toUserId)) {
    presence.sendToUser(toUserId, { type: "party_invite", invite });
  } else {
    // 离线：缓存，等上线补发
    const list = undeliveredInvites.get(toUserId) ?? [];
    list.push(invite);
    undeliveredInvites.set(toUserId, list);
  }
  return invite;
}

/** 被邀请方接受邀请、加入队伍。 */
export function joinParty(userId: string, partyId: string): Party {
  const party = requireParty(partyId);
  if (party.status !== "forming") throw new PartyError(409, "already_started", "队伍已开局，无法加入");
  if (party.members.some((m) => m.userId === userId)) {
    throw new PartyError(409, "already_member", "你已在该队伍中");
  }
  if (party.members.length >= PARTY_MAX_MEMBERS) {
    throw new PartyError(409, "party_full", `队伍已满（上限 ${PARTY_MAX_MEMBERS} 人）`);
  }
  // 已在别的队伍则先退出
  const existing = userPartyIndex.get(userId);
  if (existing && existing !== partyId) leaveParty(userId, existing);

  party.members.push(memberOf(userId));
  userPartyIndex.set(userId, party.partyId);
  const updated = partyUpdated(party);
  broadcastParty(party, { type: "party_updated", party: updated });
  // 通知队长「X 加入了」
  presence?.sendToUser(party.leaderId, {
    type: "party_join_request",
    partyId: party.partyId,
    userId,
    nickname: updated.members.find((m) => m.userId === userId)?.nickname ?? "匿名用户",
  });
  return updated;
}

/** 成员切换准备状态。 */
export function setReady(userId: string, partyId: string, ready: boolean): Party {
  const party = requireParty(partyId);
  requireMember(party, userId);
  if (party.status !== "forming") throw new PartyError(409, "already_started", "已开局，无法修改准备状态");
  const me = party.members.find((m) => m.userId === userId)!;
  me.status = ready ? "ready" : "not-ready";
  const updated = partyUpdated(party);
  broadcastParty(party, { type: "party_member_ready", partyId, userId, ready });
  broadcastParty(party, { type: "party_updated", party: updated });
  return updated;
}

/** 队长选定目标场景（不立即开局）。 */
export function chooseScene(leaderId: string, partyId: string, sceneId: SceneId): Party {
  const party = requireParty(partyId);
  requireLeader(party, leaderId);
  if (party.status !== "forming") throw new PartyError(409, "already_started", "队伍已开局");
  party.sceneId = sceneId;
  const updated = partyUpdated(party);
  broadcastParty(party, { type: "party_updated", party: updated });
  return updated;
}

/** 队长开局：要求已选场景且全员 ready。 */
export function startGame(leaderId: string, partyId: string): Party {
  const party = requireParty(partyId);
  requireLeader(party, leaderId);
  if (party.status !== "forming") throw new PartyError(409, "already_started", "队伍已开局");
  if (!party.sceneId) throw new PartyError(400, "no_scene", "请先选定要进入的场景");
  const notReady = party.members.filter((m) => m.status !== "ready");
  if (notReady.length > 0) {
    throw new PartyError(409, "not_all_ready", `还有 ${notReady.length} 名成员未准备`);
  }
  party.status = "in-game";
  const sceneId = party.sceneId;
  const updated = partyUpdated(party);
  broadcastParty(party, { type: "party_updated", party: updated });
  broadcastParty(party, { type: "party_leader_start", partyId: party.partyId, sceneId });
  return updated;
}

/** 成员离开；队长离开=解散。 */
export function leaveParty(userId: string, partyId: string): Party | null {
  const party = parties.get(partyId);
  if (!party || party.status === "disbanded") return null;
  const idx = party.members.findIndex((m) => m.userId === userId);
  if (idx === -1) return null;

  // 队长离开 -> 解散整支队伍
  if (party.leaderId === userId) {
    return disbandParty(partyId, userId, "队长离开了队伍");
  }

  party.members.splice(idx, 1);
  userPartyIndex.delete(userId);

  if (party.members.length === 0) {
    // 没人了，自动解散
    return disbandParty(partyId, userId, "队伍已空");
  }
  const updated = partyUpdated(party);
  broadcastParty(party, { type: "party_updated", party: updated });
  return updated;
}

/** 队长解散队伍。 */
export function disbandParty(partyId: string, actorId: string, reason?: string): null {
  const party = parties.get(partyId);
  if (!party || party.status === "disbanded") return null;
  // leaveParty 内部在非队长路径下也会调用本函数；此时 actor 是普通成员，允许（最后一人清空）
  party.status = "disbanded";
  partyUpdated(party);
  broadcastParty(party, { type: "party_disbanded", partyId, ...(reason ? { reason } : {}) });
  for (const m of party.members) userPartyIndex.delete(m.userId);
  parties.delete(partyId);
  return null;
}

/** 用户上线时补发离线组队邀请。 */
export function flushOfflinePartyInvites(userId: string): PartyInvite[] {
  const list = undeliveredInvites.get(userId) ?? [];
  if (list.length > 0) {
    undeliveredInvites.delete(userId);
    for (const invite of list) {
      presence?.sendToUser(userId, { type: "party_invite", invite });
    }
  }
  return list;
}

/** 查询用户当前所在队伍（供 REST / 调试）。 */
export function getPartyOfUser(userId: string): Party | undefined {
  const partyId = userPartyIndex.get(userId);
  const party = partyId ? parties.get(partyId) : undefined;
  return party && party.status !== "disbanded" ? party : undefined;
}

/** 查询某队伍当前状态。 */
export function getParty(partyId: string): Party | undefined {
  const party = parties.get(partyId);
  return party && party.status !== "disbanded" ? party : undefined;
}

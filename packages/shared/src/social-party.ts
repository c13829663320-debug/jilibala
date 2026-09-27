// ===== R5: 组队 / 约局 (Party) =====
//
// R4 已有好友 / 私聊 / 社交房间；R5 把关系链从「加好友聊天」升级为「一起玩」：
//  - 队长创建队伍，邀请好友加入
//  - 成员准备 / 队长选定场景后全员一起开局（统一导航到 /scene/:sceneId）
//  - 离线邀请在用户上线时补发
//
// 本文件为 **additive**：只新增类型，绝不修改已有的 Friend / PrivateMessage / SocialRoom 定义。
// PartyWsMessage 与 SocialRoomWsMessage 一样是独立联合类型（WSMessage 之外的并行通道），
// 服务端通过 sendToGlobalUser 跨房间投递，前端按 type 分发。

import type { SceneId } from "./index.js";

/** 队伍生命周期：forming 组人中 -> in-game 已开局 -> disbanded 已解散。 */
export type PartyStatus = "forming" | "in-game" | "disbanded";

/** 成员准备状态。队长「开始」要求全员 ready。 */
export type PartyMemberStatus = "ready" | "not-ready";

/** 队伍中的一名成员。 */
export interface PartyMember {
  userId: string;
  nickname: string;
  avatarType: string;
  avatarRef: string;
  status: PartyMemberStatus;
  /** 队长标记（leaderId 与冗余标记并存，方便前端渲染）。 */
  isLeader?: boolean;
}

/** 一支队伍。 */
export interface Party {
  partyId: string;
  /** 队长 userId。 */
  leaderId: string;
  members: PartyMember[];
  status: PartyStatus;
  /** 队长选定的目标场景（全员一起导航过去）；未定则为空。 */
  sceneId?: SceneId;
  createdAt: string;
  updatedAt: string;
}

/** 一条组队邀请。 */
export interface PartyInvite {
  inviteId: string;
  partyId: string;
  /** 邀请发起者（队长）。 */
  fromUserId: string;
  fromNickname: string;
  toUserId: string;
  message?: string;
  createdAt: string;
}

// ===== 服务端 -> 客户端：组队相关 WS 消息 =====
// 与 SocialRoomWsMessage 一致，是 WSMessage 之外的并行联合类型（按 type 分发）。
export type PartyWsMessage =
  /** 队伍创建成功，回给队长本人。 */
  | { type: "party_created"; party: Party }
  /** 队伍状态变更（成员加入/离开/准备/队长转让/选场景），广播给全体成员。 */
  | { type: "party_updated"; party: Party }
  /** 收到组队邀请，推送给被邀请方；离线时缓存，上线补发。 */
  | { type: "party_invite"; invite: PartyInvite }
  /** 被邀请方接受了邀请（通知队长「X 加入了你的队伍」）。 */
  | { type: "party_join_request"; partyId: string; userId: string; nickname: string }
  /** 某成员切换了准备状态（party_updated 已含权威状态，本条为即时提示）。 */
  | { type: "party_member_ready"; partyId: string; userId: string; ready: boolean }
  /** 队长选定场景并开局：全员应导航到 /scene/:sceneId。 */
  | { type: "party_leader_start"; partyId: string; sceneId: SceneId }
  /** 队伍解散（队长解散 / 全员离开后自动解散）。 */
  | { type: "party_disbanded"; partyId: string; reason?: string };

// ===== 客户端 -> 服务端：组队动作 =====
export type PartyClientMessage =
  /** 创建一支队伍（发起者自动成为队长）。 */
  | { type: "party_create" }
  /** 队长邀请某好友入队（须为好友关系；离线则缓存待补发）。 */
  | { type: "party_invite"; toUserId: string; message?: string }
  /** 被邀请方接受邀请、加入队伍。 */
  | { type: "party_join_request"; partyId: string }
  /** 成员切换准备状态。 */
  | { type: "party_ready"; partyId: string; ready: boolean }
  /** 成员离开队伍（队长离开则解散）。 */
  | { type: "party_leave"; partyId: string }
  /** 队长选定目标场景（不立即开局，仅同步 sceneId）。 */
  | { type: "party_choose_scene"; partyId: string; sceneId: SceneId }
  /** 队长开局：要求全员 ready，广播 party_leader_start。 */
  | { type: "party_start"; partyId: string }
  /** 队长解散队伍。 */
  | { type: "party_disband"; partyId: string };

/** 队伍人数上限（R5 初版保守值，约局不超过 6 人）。 */
export const PARTY_MAX_MEMBERS = 6;

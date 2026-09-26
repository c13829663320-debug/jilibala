// ===== Round4 R4-07: 好友系统 REST 客户端 =====
import type { Friend, FriendRequest, FriendInvite } from '@balabala/shared'

/** API 基础地址：默认同源。 */
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const friendsApi = {
  list: (userId: string) =>
    json<{ friends: Friend[] }>(`/api/friends/${encodeURIComponent(userId)}`),

  requests: (userId: string) =>
    json<{ requests: FriendRequest[] }>(`/api/friends/requests/${encodeURIComponent(userId)}`),

  request: (fromUserId: string, toUserId: string, message?: string) =>
    json<{ request: FriendRequest }>('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ fromUserId, toUserId, message }),
    }),

  accept: (requestId: string, userId: string) =>
    json<{ request: FriendRequest }>('/api/friends/accept', {
      method: 'POST',
      body: JSON.stringify({ requestId, userId }),
    }),

  reject: (requestId: string, userId: string) =>
    json<{ request: FriendRequest }>('/api/friends/reject', {
      method: 'POST',
      body: JSON.stringify({ requestId, userId }),
    }),

  remove: (userId: string, friendId: string) =>
    json<{ ok: boolean }>(`/api/friends/${encodeURIComponent(userId)}?friendId=${encodeURIComponent(friendId)}`, {
      method: 'DELETE',
    }),

  invite: (fromUserId: string, toUserId: string, roomCode: string) =>
    json<{ invite: FriendInvite }>('/api/friends/invite', {
      method: 'POST',
      body: JSON.stringify({ fromUserId, toUserId, roomCode }),
    }),
}

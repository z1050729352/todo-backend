# 房间接口契约（/api/room/*）

## 认证
- 全部接口需要 `Authorization: Bearer <token>`

## GET /api/room/state
- Query
  - `roomId` string 必填
- Response 200
  - `roomId` string
  - `hostId` string
  - `gameType` string|null (`plane-war`|`tetris`)
  - `settings` object|null
  - `seed` number|null
  - `players` array
    - `id` string
    - `username` string|null
    - `online` boolean
    - `ready` boolean
- Errors
  - 400 `缺少 roomId`
  - 404 `房间不存在`

## POST /api/room/setGame
- Body
  - `roomId` string 必填
  - `gameType` string 必填 (`plane-war`|`tetris`)
  - `settings` object 可选（会强制写入 `gameType`）
- Response 200
  - `{ ok: true }`
- Errors
  - 400 `参数不完整` / `不支持的 gameType`
  - 403 `仅房主可设置`
  - 404 `房间不存在`

## POST /api/room/ready
- Body
  - `roomId` string 必填
  - `ready` boolean 必填
- Response 200
  - `{ ok: true }`
- Errors
  - 400 `缺少 roomId`
  - 404 `房间不存在`

## POST /api/room/start
- Body
  - `roomId` string 必填
- Response 200
  - `{ ok: true, seed: number }`
- Errors
  - 400 `缺少 roomId`
  - 403 `仅房主可开始`
  - 404 `房间不存在`
  - 409 `仍有玩家未准备` / `尚未选择游戏`

## WebSocket 事件（Socket.io）
- 下行（server -> client）
  - `room_state`：房间全量状态（增量事件后也会补发一次全量）
  - `room_game_changed`：房主变更游戏/参数
  - `room_player_ready`：玩家准备状态变化
  - `room_host_changed`：房主转让
  - `room_game_start`：服务器同意开始（客户端统一 3 秒 Loading 后进入游戏）
  - `room_disbanded`：房间解散

- 上行（client -> server）
  - `rejoin_room`：加入 socket room 并请求同步
  - `leave_room`：离开房间

## 推送频率与移动端耗电
- 好友在线状态：以订阅推送为主，客户端保留 30s 低频兜底同步。
- 房间状态：以事件推送为主，仅在事件发生时补发 `room_state`。

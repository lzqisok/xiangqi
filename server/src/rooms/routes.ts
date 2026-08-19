import { Router } from 'express'
import { RoomManager } from './manager.js'

export function createRoomRouter(manager: RoomManager): Router {
  const router = Router()
  const createRates = new Map<string, { startedAt: number; count: number }>()
  const matchRates = new Map<string, { startedAt: number; count: number }>()
  router.get('/lobby', (req, res) =>
    res.json({
      rooms: manager.lobby(
        req.query.game === 'gomoku'
          ? 'gomoku'
          : req.query.game === 'xiangqi'
            ? 'xiangqi'
            : undefined,
      ),
    }),
  )
  router.get('/history', (req, res) =>
    res.json({
      rooms: manager.history(
        Number(req.query.limit) || 20,
        req.query.game === 'gomoku'
          ? 'gomoku'
          : req.query.game === 'xiangqi'
            ? 'xiangqi'
            : undefined,
      ),
    }),
  )
  router.post('/', async (req, res) => {
    try {
      const key = req.ip || req.socket.remoteAddress || 'unknown'
      const now = Date.now(),
        rate = createRates.get(key)
      if (createRates.size > 512)
        for (const [address, current] of createRates)
          if (now - current.startedAt >= 60_000) createRates.delete(address)
      if (!rate || now - rate.startedAt >= 60_000)
        createRates.set(key, { startedAt: now, count: 1 })
      else if (++rate.count > 10)
        return res.status(429).json({ error: '创建对局过于频繁，请稍后再试' })
      if (
        req.body?.variant !== 'xiangqi' &&
        req.body?.variant !== 'jieqi' &&
        req.body?.variant !== 'gomoku'
      )
        return res.status(400).json({ error: '玩法无效' })
      if (
        req.body?.variant === 'gomoku' &&
        req.body?.gomokuRule !== 'freestyle' &&
        req.body?.gomokuRule !== 'renju'
      )
        return res.status(400).json({ error: '五子棋规则无效' })
      const created = await manager.createRoom(
        String(req.body?.name || ''),
        req.body.variant,
        req.body.gomokuRule,
      )
      res.status(201).json({
        room: manager.publicRoom(created.room.id),
        ownerToken: created.ownerToken,
        inviteToken: created.inviteToken,
      })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : '创建对局失败' })
    }
  })
  router.post('/quick-match', async (req, res) => {
    try {
      const key = req.ip || req.socket.remoteAddress || 'unknown'
      const now = Date.now(),
        rate = matchRates.get(key)
      if (matchRates.size > 512)
        for (const [address, current] of matchRates)
          if (now - current.startedAt >= 60_000) matchRates.delete(address)
      if (!rate || now - rate.startedAt >= 60_000) matchRates.set(key, { startedAt: now, count: 1 })
      else if (++rate.count > 20)
        return res.status(429).json({ error: '快速匹配操作过于频繁，请稍后再试' })
      if (
        req.body?.variant !== 'xiangqi' &&
        req.body?.variant !== 'jieqi' &&
        req.body?.variant !== 'gomoku'
      )
        return res.status(400).json({ error: '玩法无效' })
      if (
        req.body.variant === 'gomoku' &&
        req.body?.gomokuRule !== 'freestyle' &&
        req.body?.gomokuRule !== 'renju'
      )
        return res.status(400).json({ error: '五子棋规则无效' })
      const matched = await manager.quickMatch(
        String(req.body?.nickname || ''),
        req.body.variant,
        req.body.gomokuRule,
      )
      res.status(matched.created ? 201 : 200).json(matched)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : '快速匹配失败' })
    }
  })
  router.get('/:id', (req, res) => {
    const room = manager.publicRoom(req.params.id)
    if (!room) return res.status(404).json({ error: '对局不存在' })
    res.json({ room })
  })
  return router
}

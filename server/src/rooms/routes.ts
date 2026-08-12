import { Router } from 'express'
import { RoomManager } from './manager.js'

export function createRoomRouter(manager: RoomManager): Router {
  const router = Router()
  const createRates = new Map<string, { startedAt: number; count: number }>()
  router.get('/lobby', (_req, res) => res.json({ rooms: manager.lobby() }))
  router.get('/history', (req, res) => res.json({ rooms: manager.history(Number(req.query.limit) || 20) }))
  router.post('/', async (req, res) => {
    try {
      const key = req.ip || req.socket.remoteAddress || 'unknown'
      const now = Date.now(), rate = createRates.get(key)
      if (createRates.size > 512) for (const [address, current] of createRates) if (now - current.startedAt >= 60_000) createRates.delete(address)
      if (!rate || now - rate.startedAt >= 60_000) createRates.set(key, { startedAt: now, count: 1 })
      else if (++rate.count > 10) return res.status(429).json({ error: '创建房间过于频繁，请稍后再试' })
      if (req.body?.variant !== 'xiangqi' && req.body?.variant !== 'jieqi') return res.status(400).json({ error: '玩法无效' })
      const created = await manager.createRoom(String(req.body?.name || ''), req.body.variant)
      res.status(201).json({ room: manager.publicRoom(created.room.id), ownerToken: created.ownerToken, inviteToken: created.inviteToken })
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '创建房间失败' }) }
  })
  router.get('/:id', (req, res) => {
    const room = manager.publicRoom(req.params.id)
    if (!room) return res.status(404).json({ error: '房间不存在' })
    res.json({ room })
  })
  return router
}

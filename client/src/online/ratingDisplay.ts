import type { MatchRatingDetail } from './types'
const reasons: Record<string, string> = {
  pending: '对局尚未结束',
  casual: '休闲对局不计分',
  not_matchmaking: '非快速排位不计分',
  no_clock: '无权威棋钟，不计分',
  not_started: '尚未开局',
  not_player: '未作为棋手参与',
  abandoned: '双方放弃，不计分',
  service_failure: '服务故障中止，不计分',
  service_restart: '服务重启中止，不计分',
  admin_abort: '管理员中止，不计分',
  ineligible_or_legacy: '不满足结算资格或属于未结算的历史对局',
}
export function ratingDetailText(detail: MatchRatingDetail): string {
  if (detail.state === 'settled' || detail.state === 'voided') {
    const change = `${detail.before} → ${detail.after}（${(detail.delta ?? 0) >= 0 ? '+' : ''}${detail.delta}）`
    return detail.state === 'voided'
      ? `原结算 ${change}，已作废：${detail.voidReason || '积分已补偿'}`
      : change
  }
  return reasons[detail.reason || ''] || '本局未计分'
}

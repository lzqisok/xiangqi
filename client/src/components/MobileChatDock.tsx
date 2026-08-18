import { ReactNode, useEffect, useState } from 'react'
import MobileStageBar from './MobileStageBar'

export default function MobileChatDock({ messageCount, children }: { messageCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)
  const unread = Math.max(0, messageCount - seenCount)

  useEffect(() => {
    if (open) setSeenCount(messageCount)
  }, [messageCount, open])

  return <>
    <div className={`mobile-chat-dock ${open ? 'open' : ''}`}>
      <button className="mobile-chat-close" onClick={() => setOpen(false)} aria-label="收起房间聊天">收起聊天</button>
      {children}
    </div>
    <MobileStageBar
      items={[{ id: 'chat', label: '聊天', badge: unread }]}
      active="chat"
      open={open}
      onSelect={() => setOpen(true)}
      onClose={() => setOpen(false)}
    />
  </>
}

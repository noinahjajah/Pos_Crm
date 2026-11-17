// สั่งพิมพ์เฉพาะใบที่เลือก (ใบเข้าครัว / ใบเสร็จ)

import { useState } from 'react'
import { flushSync } from 'react-dom'

export function usePrintSlip() {
  const [target, setTarget] = useState(null)
  const print = (which) => {
    flushSync(() => setTarget(which))
    window.print()
    setTarget(null)
  }
  return [target, print]
}

// state ของฟอร์ม + ส่งข้อมูล + แสดง error รายช่อง

import { useState } from 'react'

export function useForm(initial) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const reset = (next = initial) => {
    setForm(next)
    setErrors({})
    setError('')
  }
  async function submit(action, errorText = (e) => e.message) {
    setBusy(true)
    setErrors({})
    setError('')
    try {
      await action()
    } catch (e) {
      setErrors(e.fieldErrors || {})
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { form, setForm, set, errors, setErrors, error, setError, busy, submit, reset }
}

/**
 * dsh-ventus-search — browser half. A Ventus-series settings card with the
 * master switch (PATCH /api/ventus-search/state) and per-engine health polling
 * (GET /api/ventus-search/state). Poll timers and listeners are cleaned up with
 * the client fiber.
 * @module dsh-ventus-search/client
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'

/** Minimal slots service face used by this plugin (avoids runtime imports). */
interface SlotsLike {
  inject(key: string, callback: () => () => void): () => void
  register(
    options: { name: string; id: string; order?: number; label?: () => string },
    component: unknown,
  ): () => void
}

/** Minimal browser client context shape this plugin uses. */
interface ClientContext {
  slots: SlotsLike
  effect(callback: () => () => void, label?: string): void
}

/** Required service: slots lets the plugin claim the Ventus settings seat. */
export const inject = ['slots']

type Health = 'ok' | 'fail' | 'untested'

/** Host state response shape (mirrors src/state.ts). */
interface StateResponse {
  enabled: boolean
  engines: { bing: Health; so360: Health; bilibili: Health }
  updatedAt: string
}

const STATE_URL = '/api/ventus-search/state'
const POLL_MS = 10_000

const cardStyle: Record<string, string> = {
  listStyle: 'none',
  padding: '16px 18px',
  border: '1px solid var(--dsw-alias-line-normal)',
  borderRadius: '12px',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, transparent), transparent 45%), var(--dsw-alias-bg-module-platform)',
  boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.03)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit',
}

const headStyle: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '12px',
  cursor: 'pointer',
}

const titleStyle: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  fontWeight: '700',
  color: 'var(--dsw-alias-label-primary)',
}

const accentStyle: Record<string, string> = {
  width: '3px',
  height: '14px',
  borderRadius: '2px',
  background: 'var(--dsw-alias-state-business-primary)',
  flex: 'none',
}

const chevronStyle: Record<string, string> = {
  flex: 'none',
  marginLeft: '8px',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: '12px',
  transition: 'transform 150ms ease',
}

const bodyStyle: Record<string, string> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  fontSize: '13px',
}

const mutedStyle: Record<string, string> = {
  color: 'var(--dsw-alias-label-secondary)',
}

const rowStyle: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
}

const labelStackStyle: Record<string, string> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
}

const engineBlockStyle: Record<string, string> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-line-normal)',
  borderRadius: '10px',
  background: 'rgba(0,0,0,0.10)',
}

const engineHeadStyle: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '12px',
  color: 'var(--dsw-alias-label-secondary)',
}

const refreshButtonStyle: Record<string, string> = {
  appearance: 'none',
  WebkitAppearance: 'none',
  height: '24px',
  padding: '0 10px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-alias-line-normal)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: '12px',
  cursor: 'pointer',
}

const engineRowStyle: Record<string, string> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '13px',
}

const errorStyle: Record<string, string> = {
  color: '#f87171',
  fontSize: '12px',
}

/** Human label and color for one health value. */
function healthMeta(health: Health): { label: string; color: string } {
  if (health === 'ok') return { label: '正常', color: '#34d399' }
  if (health === 'fail') return { label: '失败', color: '#f87171' }
  return { label: '未测', color: '#8b95a7' }
}

/** Settings card for Ventus 搜索. */
export function VentusSearchSettingsCard(): unknown {
  const [collapsed, setCollapsed] = useState(true)
  const [state, setState] = useState<StateResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | undefined
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(STATE_URL, {
          signal: controller.signal,
          headers: { 'cache-control': 'no-cache' },
        })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const data = await response.json() as StateResponse
        setState(data)
        setError(null)
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    timer = setInterval(() => { void load() }, POLL_MS)
    return () => {
      controller.abort()
      if (timer !== undefined) clearInterval(timer)
    }
  }, [])

  const toggle = async (enabled: boolean): Promise<void> => {
    setSaving(true)
    try {
      const response = await fetch(STATE_URL, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json() as StateResponse
      setState(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const refresh = async (): Promise<void> => {
    try {
      const response = await fetch(STATE_URL, { headers: { 'cache-control': 'no-cache' } })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json() as StateResponse
      setState(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleRow = (
    label: string,
    hint: string,
    checked: boolean,
    onChange: (value: boolean) => void,
    busy = false,
  ): ReactNode => createElement(
    'label',
    { style: rowStyle },
    createElement(
      'span',
      { style: labelStackStyle },
      createElement('span', { style: { fontSize: 13 } }, label),
      createElement('span', { style: mutedStyle }, hint),
    ),
    createElement('input', {
      type: 'checkbox',
      checked,
      disabled: busy,
      onChange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
    }),
  )

  const healthRow = (name: string, health: Health): ReactNode => {
    const meta = healthMeta(health)
    return createElement(
      'div',
      { style: engineRowStyle },
      createElement('span', {}, name),
      createElement(
        'span',
        { style: { color: meta.color, fontWeight: 600 } },
        meta.label,
      ),
    )
  }

  const enabled = state?.enabled ?? true
  const engines = state?.engines ?? { bing: 'untested' as Health, so360: 'untested' as Health, bilibili: 'untested' as Health }
  const disabledStyle: Record<string, string | number> = { opacity: 0.45, pointerEvents: 'none' }

  const head = createElement(
    'div',
    {
      style: headStyle,
      role: 'button',
      tabIndex: 0,
      'aria-expanded': !collapsed,
      onClick: () => setCollapsed(current => !current),
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setCollapsed(current => !current)
        }
      },
    },
    createElement(
      'span',
      { style: titleStyle },
      createElement('span', { style: accentStyle }),
      'Ventus 搜索',
    ),
    createElement('span', { style: { ...chevronStyle, transform: collapsed ? 'none' : 'rotate(180deg)' } }, '▾'),
  )

  const body = collapsed
    ? null
    : createElement(
      'div',
      { style: bodyStyle },
      toggleRow(
        '启用 Ventus 搜索',
        '总开关：关闭后搜索与抓取 provider 立即不可用',
        enabled,
        value => { void toggle(value) },
        saving,
      ),
      createElement(
        'div',
        { style: { ...engineBlockStyle, ...(enabled ? {} : disabledStyle) } },
        createElement(
          'div',
          { style: engineHeadStyle },
          createElement('span', {}, '引擎健康'),
          createElement('button', { style: refreshButtonStyle, onClick: () => void refresh() }, '刷新'),
        ),
        healthRow('Bing', engines.bing),
        healthRow('360 搜索', engines.so360),
        healthRow('Bilibili', engines.bilibili),
      ),
      error ? createElement('div', { style: errorStyle }, error) : null,
    )

  return createElement('li', { style: cardStyle }, head, body)
}

/** Register the settings card into the Ventus settings list seat. */
export function apply(ctx: ClientContext): void {
  const disposeCard = ctx.slots.inject('ventus.settings.item', () => ctx.slots.register({
    name: 'ventus.settings.item',
    id: 'dsh-ventus-search',
    order: 30,
  }, VentusSearchSettingsCard))
  ctx.effect(() => () => { disposeCard() }, 'dsh-ventus-search: settings card')
}

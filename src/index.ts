/**
 * dsh-ventus-search — host half. Registers a multi-engine search provider and a
 * fetch provider into ctx.web, plus loopback-only state routes backing the
 * settings card (master switch + per-engine health). All routes/providers are
 * effect-owned and clean up with the fiber.
 * @module dsh-ventus-search
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { StateStore } from './state.js'
import type { EngineId } from './state.js'
import { VentusSearchProvider } from './search/provider.js'
import type { VentusSearchOptions } from './search/provider.js'
import { VentusFetchProvider } from './fetch/provider.js'
import type { VentusFetchOptions } from './fetch/provider.js'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ventus-search'

/** Services required before the providers and routes can mount. */
export const inject = ['web', 'webServer']

/** Plugin config (all fields defaulted by the schemastery schema). */
export interface Config {
  /** Master switch, persisted to the state file and changeable from the settings card. */
  enabled: boolean
  /** State file path; a leading ~ is expanded to the user's home directory. */
  stateFilePath: string
  engines: {
    bing: boolean
    so360: boolean
    bilibili: boolean
    bilibiliCookie: string
  }
  maxResults: number
  maxDomainResults: number
  requestTimeoutMs: number
  overallTimeoutMs: number
  maxConcurrency: number
  retryCount: number
  gracefulDegradation: boolean
  cache: {
    enabled: boolean
  }
  fetch: {
    enabled: boolean
    blockedDomains: string[]
    mirrorDomains: Record<string, string[]>
  }
}

/** Default ad/tracking domains refused by the fetch provider. */
const DEFAULT_BLOCKED_DOMAINS = ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com']

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  stateFilePath: z.string().default('~/.dsh/plugins/ventus-search/state.json'),
  engines: z.object({
    bing: z.boolean().default(true),
    so360: z.boolean().default(true),
    bilibili: z.boolean().default(true),
    bilibiliCookie: z.string().default(''),
  }).default({ bing: true, so360: true, bilibili: true, bilibiliCookie: '' }),
  maxResults: z.number().min(1).max(50).default(8),
  maxDomainResults: z.number().min(1).max(20).default(2),
  requestTimeoutMs: z.number().min(100).default(8000),
  overallTimeoutMs: z.number().min(1000).default(15000),
  maxConcurrency: z.number().min(1).max(16).default(4),
  retryCount: z.number().min(0).max(5).default(1),
  gracefulDegradation: z.boolean().default(true),
  cache: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  fetch: z.object({
    enabled: z.boolean().default(true),
    blockedDomains: z.array(z.string()).default([...DEFAULT_BLOCKED_DOMAINS]),
    mirrorDomains: z.dict(z.array(z.string())).default({}),
  }).default({
    enabled: true,
    blockedDomains: [...DEFAULT_BLOCKED_DOMAINS],
    mirrorDomains: {},
  }),
})

/** Expand a leading ~ in a configured path to the user's home directory. */
function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return join(homedir(), filePath.slice(2))
  }
  return filePath
}

/** Loopback-only guard plus same-origin browser marker check. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Write one JSON response with no-store semantics. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Read and parse a bounded JSON request body. */
function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error('invalid JSON body: ' + String(error)))
      }
    })
    request.on('error', reject)
  })
}

/** Map plugin config to the search provider options. */
function searchOptions(config: Config): VentusSearchOptions {
  return {
    engines: { ...config.engines },
    maxResults: config.maxResults,
    maxDomainResults: config.maxDomainResults,
    requestTimeoutMs: config.requestTimeoutMs,
    overallTimeoutMs: config.overallTimeoutMs,
    maxConcurrency: config.maxConcurrency,
    retryCount: config.retryCount,
    gracefulDegradation: config.gracefulDegradation,
    cacheEnabled: config.cache.enabled,
  }
}

/** Map plugin config to the fetch provider options. */
function fetchOptions(config: Config): VentusFetchOptions {
  return {
    enabled: config.fetch.enabled,
    blockedDomains: [...config.fetch.blockedDomains],
    mirrorDomains: { ...config.fetch.mirrorDomains },
    timeoutMs: config.requestTimeoutMs,
  }
}

/** Register the plugin. */
export function apply(ctx: Context, config: Config): void {
  const state = new StateStore(expandHome(config.stateFilePath))
  state.load(config.enabled)

  // Providers are created before the routes so the test route can call search().
  const searchProvider = new VentusSearchProvider(searchOptions(config), state)
  const fetchProvider = new VentusFetchProvider(fetchOptions(config), () => state.get().enabled)

  const stateRoute: WebRoute = {
    kind: 'exact',
    path: '/api/ventus-search/state',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if (req.method === 'GET') {
        writeJson(res, 200, state.get())
        return
      }
      if (req.method !== 'PATCH') {
        writeJson(res, 405, { error: 'method not allowed (expected GET or PATCH)' })
        return
      }
      try {
        const body = await readJsonBody(req) as Record<string, unknown> | null
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'body must be a JSON object' })
          return
        }
        const enabledPatch = typeof body.enabled === 'boolean' ? (body.enabled as boolean) : undefined
        const enginesRaw = body.engines
        const hasEnginePatch = typeof enginesRaw === 'object' && enginesRaw !== null
          && Object.keys(enginesRaw as object).length > 0
        const enginesValid = hasEnginePatch && Object.entries(enginesRaw as Record<string, unknown>).every(
          ([id, value]) => (id === 'bing' || id === 'so360' || id === 'bilibili') && typeof value === 'boolean',
        )
        if (enabledPatch === undefined && !hasEnginePatch) {
          writeJson(res, 400, { error: 'body must include enabled and/or engines' })
          return
        }
        if (enginesRaw !== undefined && !enginesValid) {
          writeJson(res, 400, { error: 'engines must be { bing?, so360?, bilibili? } with boolean values' })
          return
        }
        let next = state.get()
        if (enabledPatch !== undefined) next = state.setEnabled(enabledPatch)
        if (hasEnginePatch) {
          for (const [id, value] of Object.entries(enginesRaw as Record<string, unknown>)) {
            next = state.setEngineEnabled(id as EngineId, value as boolean)
          }
        }
        writeJson(res, 200, next)
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const testRoute: WebRoute = {
    kind: 'exact',
    path: '/api/ventus-search/test',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'method not allowed (expected POST)' })
        return
      }
      let body: Record<string, unknown>
      try {
        const parsed = await readJsonBody(req)
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('body must be a JSON object')
        }
        body = parsed as Record<string, unknown>
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      const query = typeof body.query === 'string' ? body.query : undefined
      if (query === undefined || query.trim().length === 0 || query.length > 200) {
        writeJson(res, 400, { error: 'query is required, non-empty, and at most 200 characters' })
        return
      }
      const started = Date.now()
      try {
        const result = await searchProvider.search({ query, maxResults: 5 })
        writeJson(res, 200, {
          ok: true,
          durationMs: Date.now() - started,
          sources: result.sources,
          engines: state.get().engines,
        })
      } catch (error) {
        writeJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          engines: state.get().engines,
        })
      }
    },
  }

  ctx.effect(() => {
    const disposeState = ctx.webServer.register(stateRoute)
    const disposeTest = ctx.webServer.register(testRoute)
    return () => {
      disposeState()
      disposeTest()
    }
  }, 'ventus-search: routes')

  ctx.effect(() => {
    const disposeSearch = ctx.web.registerSearchProvider(searchProvider)
    const disposeFetch = ctx.web.registerFetchProvider(fetchProvider)
    return () => {
      disposeSearch()
      disposeFetch()
    }
  }, 'ventus-search: providers')
}

// dsh-plugin-balance host half (full Node environment).
// Registers same-origin JSON routes the browser panel fetches:
// - GET /api/dsh-plugin-balance/balance   — DeepSeek API balance (key resolved per request, never leaves the host)
// - GET /api/dsh-plugin-balance/git?sessionId=… — git status of the session's workspace
// - GET /api/dsh-plugin-balance/usage — cross-session token usage history (daily series, model-split)
// - GET /api/dsh-plugin-balance/about — installed/latest DSH version (registry check via npm view)
// - POST /api/dsh-plugin-balance/update — one-click DSH self-update (detached npm exec + graceful exit)

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const name = 'dsh-plugin-balance'
export const inject = ['webServer', 'credentials', 'sessions', 'shell', 'sessionQuery', 'sessionPersistence']

const BALANCE_PATH = '/api/dsh-plugin-balance/balance'
const GIT_PATH = '/api/dsh-plugin-balance/git'
const USAGE_PATH = '/api/dsh-plugin-balance/usage'
const ABOUT_PATH = '/api/dsh-plugin-balance/about'
const UPDATE_PATH = '/api/dsh-plugin-balance/update'
const MAX_USAGE_DAYS = 180

const pluginVersion = (() => {
  try {
    const p = new URL('./package.json', import.meta.url)
    return JSON.parse(fs.readFileSync(p, 'utf8')).version
  } catch {
    return 'unknown'
  }
})()

// The web process boots as `node …/.bin/dsh web`; argv[1] is the bin shim.
// Resolve its real path and climb to the @deepseek-ai/dsh package root.
function installedDshVersion() {
  try {
    const bin = process.argv[1]
    if (bin == null) return undefined
    let dir = path.dirname(fs.realpathSync(bin))
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        if (pkg.name === '@deepseek-ai/dsh') return pkg.version
      } catch {}
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {}
  return undefined
}

// Numeric-segment compare so "0.1.0-rc.10" > "0.1.0-rc.6".
function cmpVersions(a, b) {
  const pa = String(a).split(/[^0-9]+/).filter(Boolean).map(Number)
  const pb = String(b).split(/[^0-9]+/).filter(Boolean).map(Number)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function textOf(result) {
  const out = result.stdout
  return typeof out === 'string' ? out : (out != null ? (out.content != null ? out.content : out.text != null ? out.text : '') : '')
}

async function fetchBalance(ctx) {
  const resolved = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
  const key = typeof resolved === 'string' ? resolved : resolved && resolved.value
  if (!key) return { ok: false, error: 'DEEPSEEK_API_KEY credential not configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const upstream = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: 'Bearer ' + key },
      signal: controller.signal,
    })
    const data = await upstream.json()
    return {
      ok: upstream.ok,
      statusCode: upstream.status,
      is_available: !!data.is_available,
      balance_infos: Array.isArray(data.balance_infos) ? data.balance_infos : [],
    }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchGit(ctx, sessionId) {
  const session = sessionId != null ? ctx.sessions.get(sessionId) : undefined
  const cwd = session != null && session.header != null ? session.header.cwd : undefined
  if (!cwd) return { ok: false, error: '未创建 Git 仓库' }
  const cwdNorm = String(cwd).replace(/\/+$/, '')
  // The repo root must BE the session's own workspace directory; git otherwise
  // walks up to an ancestor repo (e.g. the home directory) and reports its
  // changes as if they belonged to this project.
  const rootSpec = ctx.shell.resolve({
    command: 'git -C "' + cwdNorm.replace(/"/g, '\\"') + '" rev-parse --show-toplevel',
    timeoutMs: 15000,
    stdoutMaxBytes: 4096,
  })
  const rootResult = await ctx.shell.run(rootSpec)
  if (rootResult.exitCode !== 0) return { ok: false, error: '未创建 Git 仓库' }
  const root = textOf(rootResult).trim().replace(/\/+$/, '')
  if (root !== cwdNorm) return { ok: false, error: '未创建 Git 仓库' }
  const spec = ctx.shell.resolve({
    command: 'git -C "' + cwdNorm.replace(/"/g, '\\"') + '" status --porcelain=v1 -b',
    timeoutMs: 15000,
    stdoutMaxBytes: 65536,
  })
  const result = await ctx.shell.run(spec)
  const text = textOf(result)
  if (result.exitCode !== 0) return { ok: false, error: '未创建 Git 仓库' }
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { ok: true, branch: null, ahead: 0, behind: 0, changed: 0 }
  let branch = null
  let ahead = 0
  let behind = 0
  const first = lines[0]
  if (first.startsWith('## ')) {
    const rest = first.slice(3)
    const m = rest.match(/^([^.[\s]+)/)
    if (m != null) branch = m[1]
    const ab = rest.match(/\[ahead (\d+)(?:, behind (\d+))?\]/)
    if (ab != null) {
      ahead = parseInt(ab[1], 10) || 0
      behind = ab[2] != null ? parseInt(ab[2], 10) || 0 : 0
    } else {
      const ab2 = rest.match(/\[behind (\d+)\]/)
      if (ab2 != null) behind = parseInt(ab2[1], 10) || 0
    }
  }
  return { ok: true, branch, ahead, behind, changed: lines.length - 1 }
}

function dayKey(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

// Aggregate per-step usage events (assistant/chunk → chunk.type === "usage")
// from every session in the corpus into one continuous 180-day daily series.
// The client derives both the 7/14/30-day bar chart and the calendar heatmap
// from this single fixed window, so the selector never refetches. The result
// is day-granular history: a 5-minute server cache absorbs the client's
// 60s refresh, so the expensive full-log scan runs at most ~12×/hour instead
// of 60×/hour while the page is open.
let usageResultCache = { at: 0, payload: null }

async function fetchUsage(ctx) {
  const now = Date.now()
  if (usageResultCache.payload != null && (now - usageResultCache.at) < 5 * 60000) return usageResultCache.payload
  const since = now - MAX_USAGE_DAYS * 86400000
  const byDay = new Map()
  const records = await ctx.sessionQuery.listSessions()
  for (const rec of records) {
    // listSessions returns { header, live, persisted } records — the id lives
    // on the header. sessionPersistence.readFrom reads the raw event log with
    // no replay and no double cloning, unlike sessionQuery.readSession which
    // replays + deep-clones every event of every session and stalls the
    // request for tens of seconds on large logs (and listEvents strips data).
    if (rec == null || rec.header == null || rec.persisted !== true) continue
    let events
    try {
      const read = await ctx.sessionPersistence.readFrom(rec.header.id, 0)
      events = read != null ? read.events : undefined
    } catch {
      continue
    }
    if (!Array.isArray(events)) continue
    // The model is not on the usage chunk itself: request/header events carry
    // data.header.config.model and precede their step's chunks, so track the
    // running model while walking the ascending log and attribute each usage
    // total to it.
    let currentModel = 'unknown'
    for (const ev of events) {
      if (ev == null) continue
      if (ev.type === 'request/header') {
        const cfg = ev.data != null && ev.data.header != null ? ev.data.header.config : undefined
        currentModel = cfg != null && typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : 'unknown'
        continue
      }
      if (ev.type !== 'assistant/chunk') continue
      const chunk = ev.data != null ? ev.data.chunk : undefined
      if (chunk == null || chunk.type !== 'usage' || chunk.usage == null) continue
      const ts = typeof ev.time === 'number' ? ev.time : undefined
      if (ts == null || ts < since) continue
      const u = chunk.usage
      const input = u.inputTokens || 0
      const output = u.outputTokens || 0
      const reasoning = u.reasoningTokens || 0
      const cacheRead = u.cacheReadTokens || 0
      const cacheWrite = u.cacheWriteTokens || 0
      const total = input + output + reasoning + cacheRead + cacheWrite
      if (!(total > 0)) continue
      const dk = dayKey(ts)
      let d = byDay.get(dk)
      if (d == null) {
        d = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, steps: 0, models: {} }
        byDay.set(dk, d)
      }
      d.input += input
      d.output += output
      d.reasoning += reasoning
      d.cacheRead += cacheRead
      d.cacheWrite += cacheWrite
      d.total += total
      d.steps += 1
      d.models[currentModel] = (d.models[currentModel] || 0) + total
    }
  }
  // Continuous ascending day axis for the fixed 180-day window.
  const series = []
  for (let i = MAX_USAGE_DAYS - 1; i >= 0; i--) {
    const dk = dayKey(now - i * 86400000)
    const d = byDay.get(dk)
    series.push(Object.assign({ date: dk }, d != null ? d : { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, steps: 0, models: {} }))
  }
  const result = {
    ok: true,
    span: MAX_USAGE_DAYS,
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
    series,
  }
  usageResultCache = { at: now, payload: result }
  return result
}

// ---- version check & self-update ------------------------------------------

async function npmView(ctx, args) {
  const spec = ctx.shell.resolve({ command: 'npm view ' + args, timeoutMs: 30000, stdoutMaxBytes: 262144 })
  const result = await ctx.shell.run(spec)
  if (result.exitCode !== 0) throw new Error('npm view exited ' + result.exitCode)
  return textOf(result).trim()
}

async function fetchLatestInfo(ctx) {
  try {
    const tagsRaw = await npmView(ctx, '@deepseek-ai/dsh dist-tags --json')
    const tags = JSON.parse(tagsRaw)
    const latest = tags != null ? tags.latest : undefined
    let publishedAt
    try {
      const timeRaw = await npmView(ctx, '@deepseek-ai/dsh time --json')
      const time = JSON.parse(timeRaw)
      if (latest != null && time != null && time[latest] != null) publishedAt = time[latest]
    } catch {}
    return { latest, publishedAt }
  } catch (error) {
    // npm view failed (network/mirror): fall back to the canonical registry.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest', { signal: controller.signal })
      const data = await res.json()
      return { latest: data != null ? data.version : undefined, publishedAt: undefined }
    } catch {
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

let aboutCache = { at: 0, payload: null }

const RELEASES_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases'
const RELEASES_FEED_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases.atom'

function stripHtml(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|pre|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n\u2022 ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normTag(tag) {
  return String(tag).replace(/^v/i, '').replace(/^apps\/cli@/, '').trim()
}

// Official release notes live in the repo's GitHub releases (no changelog
// file is published). Parse the Atom feed and match the target version's
// entry; when the team has not published notes this returns null and the
// client falls back to a friendly "not published" line + link.
async function fetchReleaseNotes(version) {
  if (version == null) return { notesVersion: undefined, notesText: null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(RELEASES_FEED_URL, { signal: controller.signal })
    if (!res.ok) return { notesVersion: undefined, notesText: null }
    const xml = await res.text()
    const entries = []
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g
    let m
    while ((m = entryRe.exec(xml)) != null) {
      const block = m[1]
      const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]
      const content = (block.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1]
      if (title != null) entries.push({ tag: title, body: content || '' })
    }
    if (entries.length === 0) return { notesVersion: undefined, notesText: null }
    const target = normTag(version)
    const hit = entries.find((e) => normTag(e.tag) === target) || entries.find((e) => normTag(e.tag).startsWith(target))
    if (hit == null) return { notesVersion: undefined, notesText: null }
    return { notesVersion: version, notesText: stripHtml(hit.body) }
  } catch {
    return { notesVersion: undefined, notesText: null }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchAbout(ctx, force) {
  const now = Date.now()
  if (!force && aboutCache.payload != null && (now - aboutCache.at) < 60000) return aboutCache.payload
  const installed = installedDshVersion()
  let payload
  try {
    const info = await fetchLatestInfo(ctx)
    const latest = info.latest
    const upToDate = latest != null && installed != null ? cmpVersions(installed, latest) >= 0 : true
    // New version → show the NEW version's notes; up to date → show the
    // CURRENT version's notes.
    const notesTarget = !upToDate && latest != null ? latest : installed
    const notes = await fetchReleaseNotes(notesTarget)
    payload = { ok: true, installed, pluginVersion, latest, upToDate, publishedAt: info.publishedAt, checkError: undefined, checkedAt: now, notesVersion: notes.notesVersion, notesText: notes.notesText, releasesUrl: RELEASES_URL }
  } catch (error) {
    payload = { ok: true, installed, pluginVersion, latest: undefined, upToDate: true, publishedAt: undefined, checkError: error && error.message ? error.message : String(error), checkedAt: now, notesVersion: undefined, notesText: null, releasesUrl: RELEASES_URL }
  }
  aboutCache = { at: now, payload }
  return payload
}

export function apply(ctx) {
  const disposeBalance = ctx.webServer.register({
    kind: 'exact',
    path: BALANCE_PATH,
    async handler(req, res) {
      try {
        sendJson(res, 200, await fetchBalance(ctx))
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  })
  const disposeGit = ctx.webServer.register({
    kind: 'exact',
    path: GIT_PATH,
    async handler(req, res) {
      try {
        const url = new URL(req.url, 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        sendJson(res, 200, await fetchGit(ctx, sessionId))
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  })
  const disposeUsage = ctx.webServer.register({
    kind: 'exact',
    path: USAGE_PATH,
    async handler(req, res) {
      try {
        sendJson(res, 200, await fetchUsage(ctx))
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  })
  const disposeAbout = ctx.webServer.register({
    kind: 'exact',
    path: ABOUT_PATH,
    async handler(req, res) {
      try {
        const url = new URL(req.url, 'http://dsh.internal')
        sendJson(res, 200, await fetchAbout(ctx, url.searchParams.get('force') === '1'))
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  })
  const disposeUpdate = ctx.webServer.register({
    kind: 'exact',
    path: UPDATE_PATH,
    async handler(req, res) {
      try {
        const about = await fetchAbout(ctx, true)
        if (about.checkError != null || about.latest == null) {
          sendJson(res, 200, { ok: false, error: '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25\uff0c\u672a\u6267\u884c\u66f4\u65b0\uff1a' + (about.checkError || 'unknown') })
          return
        }
        if (about.upToDate) {
          sendJson(res, 200, { ok: false, error: '\u5df2\u662f\u6700\u65b0\u7248\u672c ' + about.installed + '\uff0c\u65e0\u9700\u66f4\u65b0' })
          return
        }
        // Self-update: a detached shell sleeps while this process exits, then
        // boots the fresh install with the same `npm exec … web` form the user
        // launched the server with. Output lands in ~/.dsh/dsh-web-update.log.
        const home = process.env.HOME || process.env.USERPROFILE || '.'
        const logFile = path.join(home, '.dsh', 'dsh-web-update.log')
        const script = 'sleep 4; exec npm exec --yes @deepseek-ai/dsh web >> "' + logFile.replace(/"/g, '\\"') + '" 2>&1'
        const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore', env: process.env })
        child.unref()
        sendJson(res, 200, { ok: true, message: '\u66f4\u65b0\u5df2\u542f\u52a8\uff08' + about.installed + ' \u2192 ' + about.latest + '\uff09\uff0c\u670d\u52a1\u5373\u5c06\u91cd\u542f' })
        setTimeout(() => process.exit(0), 1500)
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  })
  return () => {
    disposeBalance()
    disposeGit()
    disposeUsage()
    disposeAbout()
    disposeUpdate()
  }
}

// dsh-plugin-balance host half (full Node environment).
// Registers same-origin JSON routes the browser panel fetches:
// - GET /api/dsh-plugin-balance/balance   — DeepSeek API balance (key resolved per request, never leaves the host)
// - GET /api/dsh-plugin-balance/git?sessionId=… — git status of the session's workspace
// - GET /api/dsh-plugin-balance/usage?days=… — cross-session token usage history (daily series + day×hour heatmap)

export const name = 'dsh-plugin-balance'
export const inject = ['webServer', 'credentials', 'sessions', 'shell', 'sessionQuery', 'sessionPersistence']

const BALANCE_PATH = '/api/dsh-plugin-balance/balance'
const GIT_PATH = '/api/dsh-plugin-balance/git'
const USAGE_PATH = '/api/dsh-plugin-balance/usage'
const MAX_USAGE_DAYS = 180

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
// from this single fixed window, so the selector never refetches.
async function fetchUsage(ctx) {
  const now = Date.now()
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
    for (const ev of events) {
      if (ev == null || ev.type !== 'assistant/chunk') continue
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
        d = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, steps: 0 }
        byDay.set(dk, d)
      }
      d.input += input
      d.output += output
      d.reasoning += reasoning
      d.cacheRead += cacheRead
      d.cacheWrite += cacheWrite
      d.total += total
      d.steps += 1
    }
  }
  // Continuous ascending day axis for the fixed 180-day window.
  const series = []
  for (let i = MAX_USAGE_DAYS - 1; i >= 0; i--) {
    const dk = dayKey(now - i * 86400000)
    const d = byDay.get(dk)
    series.push(Object.assign({ date: dk }, d != null ? d : { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, steps: 0 }))
  }
  return {
    ok: true,
    span: MAX_USAGE_DAYS,
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
    series,
  }
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
  return () => {
    disposeBalance()
    disposeGit()
    disposeUsage()
  }
}

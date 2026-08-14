// dsh-plugin-balance host half (full Node environment).
// Registers same-origin JSON routes the browser panel fetches:
// - GET /api/dsh-plugin-balance/balance   — DeepSeek API balance (key resolved per request, never leaves the host)
// - GET /api/dsh-plugin-balance/git?sessionId=… — git status of the session's workspace

export const name = 'dsh-plugin-balance'
export const inject = ['webServer', 'credentials', 'sessions', 'shell']

const BALANCE_PATH = '/api/dsh-plugin-balance/balance'
const GIT_PATH = '/api/dsh-plugin-balance/git'

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
  return () => {
    disposeBalance()
    disposeGit()
  }
}

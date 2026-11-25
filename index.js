/**
 * Host half of dsh-calendar-board.
 *
 * The calendar data lives in a plain JSON file, so the agent, git and every AI
 * tool read the same file. This half only exposes that file over a same-origin
 * POST route; the browser half never touches the filesystem.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const inject = ['webServer', 'connection']

const PREFIX = '/calendar/api/'
const MAX_BODY = 2 * 1024 * 1024
const STATUS = {
  'invalid-input': 400,
  'not-found': 404,
  'io-error': 500,
  'invalid-data': 500,
}

const LINES = new Set(['A', 'B', 'C', 'D', '运营', '其他'])
const PROJECTS = new Set(['half', 'reading', 'ftc', 'x', 'local', 'other'])
const MARKER_TYPES = new Set(['festival', 'milestone'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function isoOr(value, fallback) {
  if (typeof value !== 'string' || value.length > 40) return fallback
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback
}

function normalizeTask(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('invalid-input', `tasks[${index}] 不是对象`)
  }
  const title = text(raw.title, 200)
  if (title === '') throw fail('invalid-input', `tasks[${index}].title 不能为空`)
  if (typeof raw.date !== 'string' || !DATE_RE.test(raw.date)) {
    throw fail('invalid-input', `tasks[${index}].date 必须是 YYYY-MM-DD`)
  }
  const time = typeof raw.time === 'string' && TIME_RE.test(raw.time) ? raw.time : null
  const status = raw.status === 'done' ? 'done' : 'todo'
  const line = LINES.has(raw.line) ? raw.line : '其他'
  const project = PROJECTS.has(raw.project) ? raw.project : 'other'
  const createdAt = isoOr(raw.createdAt, new Date().toISOString())
  const completedAt = status === 'done' ? isoOr(raw.completedAt, new Date().toISOString()) : null
  return {
    id: text(raw.id, 120) || makeId('t'),
    title,
    date: raw.date,
    time,
    status,
    line,
    project,
    priority: raw.priority === 'P0' || raw.priority === 'P1' ? raw.priority : null,
    outcome: text(raw.outcome, 4000),
    note: text(raw.note, 2000),
    prompt: text(raw.prompt, 4000),
    source: text(raw.source, 200),
    sessionId: text(raw.sessionId, 200) || null,
    createdAt,
    updatedAt: isoOr(raw.updatedAt, createdAt),
    completedAt,
  }
}

function normalizeGoal(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('invalid-input', `goals[${index}] 不是对象`)
  }
  const title = text(raw.title, 200)
  if (title === '') throw fail('invalid-input', `goals[${index}].title 不能为空`)
  const status = raw.status === 'done' ? 'done' : 'todo'
  return {
    id: text(raw.id, 120) || makeId('g'),
    title,
    date: typeof raw.date === 'string' && DATE_RE.test(raw.date) ? raw.date : null,
    metric: text(raw.metric, 200),
    project: PROJECTS.has(raw.project) ? raw.project : 'other',
    status,
    note: text(raw.note, 2000),
    createdAt: isoOr(raw.createdAt, new Date().toISOString()),
    completedAt: status === 'done' ? isoOr(raw.completedAt, new Date().toISOString()) : null,
  }
}

function normalizeMarker(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('invalid-input', `markers[${index}] 不是对象`)
  }
  const label = text(raw.label, 80)
  if (label === '') throw fail('invalid-input', `markers[${index}].label 不能为空`)
  if (typeof raw.date !== 'string' || !DATE_RE.test(raw.date)) {
    throw fail('invalid-input', `markers[${index}].date 必须是 YYYY-MM-DD`)
  }
  return {
    id: text(raw.id, 120) || makeId('m'),
    date: raw.date,
    label,
    type: MARKER_TYPES.has(raw.type) ? raw.type : 'festival',
    note: text(raw.note, 500),
  }
}

function emptyPlan() {
  return { version: 1, rev: 0, updatedAt: null, goals: [], tasks: [], markers: [] }
}

function normalizePlan(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('invalid-data', 'plan.json 的根节点必须是对象')
  }
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : []
  const goals = Array.isArray(raw.goals) ? raw.goals.map(normalizeGoal) : []
  const markers = Array.isArray(raw.markers) ? raw.markers.map(normalizeMarker) : []
  const seen = new Set()
  for (const task of tasks) {
    if (seen.has(task.id)) task.id = makeId('t')
    seen.add(task.id)
  }
  tasks.sort((left, right) => `${left.date} ${left.time ?? '99:99'}`.localeCompare(`${right.date} ${right.time ?? '99:99'}`))
  markers.sort((left, right) => left.date.localeCompare(right.date))
  return {
    version: 1,
    rev: Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    goals,
    tasks,
    markers,
  }
}

function resolveFile(config) {
  const configured = typeof config?.dataFile === 'string' ? config.dataFile.trim() : ''
  return configured
    || process.env.DSH_CALENDAR_FILE
    || join(homedir(), 'Desktop', 'calendar', 'plan.json')
}

function readPlan(file) {
  if (!existsSync(file)) return emptyPlan()
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    throw fail('io-error', `读取 plan.json 失败：${error.message}`)
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch (error) {
    throw fail('invalid-data', `plan.json 不是合法 JSON：${error.message}`)
  }
  return normalizePlan(data)
}

function writePlan(file, plan, mutate) {
  const now = new Date().toISOString()
  const next = mutate({ ...plan, tasks: [...plan.tasks], goals: [...plan.goals], markers: [...plan.markers] }, now)
  next.version = 1
  next.rev = plan.rev + 1
  next.updatedAt = now
  next.tasks = next.tasks.map((task) => ({ ...task, updatedAt: now }))
  next.tasks.sort((left, right) => `${left.date} ${left.time ?? '99:99'}`.localeCompare(`${right.date} ${right.time ?? '99:99'}`))
  next.markers = [...next.markers].sort((left, right) => left.date.localeCompare(right.date))
  try {
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.tmp-${process.pid}`
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(temp, file)
  } catch (error) {
    throw fail('io-error', `写入 plan.json 失败：${error.message}`)
  }
  return next
}

function upsertTask(plan, raw) {
  const task = normalizeTask(raw, 0)
  const index = plan.tasks.findIndex((item) => item.id === task.id)
  if (index === -1) plan.tasks.push(task)
  else plan.tasks[index] = { ...plan.tasks[index], ...task, createdAt: plan.tasks[index].createdAt }
  return plan
}

function applyMutation(plan, method, body, now) {
  if (method === 'upsert') return upsertTask(plan, body.task)
  if (method === 'remove') {
    const id = text(body.id, 120)
    const before = plan.tasks.length
    plan.tasks = plan.tasks.filter((task) => task.id !== id)
    if (plan.tasks.length === before) throw fail('not-found', '任务不存在')
    return plan
  }
  if (method === 'toggle') {
    const id = text(body.id, 120)
    const task = plan.tasks.find((item) => item.id === id)
    if (task === undefined) throw fail('not-found', '任务不存在')
    task.status = body.done === true ? 'done' : 'todo'
    task.completedAt = task.status === 'done' ? now : null
    return plan
  }
  if (method === 'goal-toggle') {
    const id = text(body.id, 120)
    const goal = plan.goals.find((item) => item.id === id)
    if (goal === undefined) throw fail('not-found', '目标不存在')
    goal.status = body.done === true ? 'done' : 'todo'
    goal.completedAt = goal.status === 'done' ? now : null
    return plan
  }
  if (method === 'goal-upsert') {
    const goal = normalizeGoal(body.goal, 0)
    const index = plan.goals.findIndex((item) => item.id === goal.id)
    if (index === -1) plan.goals.push(goal)
    else plan.goals[index] = { ...plan.goals[index], ...goal, createdAt: plan.goals[index].createdAt }
    return plan
  }
  throw fail('not-found', '未知接口')
}

function writeJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw fail('invalid-input', '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw fail('invalid-input', '请求体不是合法 JSON')
  }
}

export function apply(ctx, config = {}) {
  const file = resolveFile(config)
  const handle = async (req, res) => {
    if (ctx.connection.requestRejection(req) !== undefined) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'method', message: '只支持 POST' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const method = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : ''
    if (method === '' || method.includes('/')) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: '未知接口' } })
      return
    }
    try {
      if (method === 'load') {
        writeJson(res, 200, { ok: true, result: { plan: readPlan(file) } })
        return
      }
      if (!['upsert', 'remove', 'toggle', 'goal-toggle', 'goal-upsert'].includes(method)) {
        throw fail('not-found', '未知接口')
      }
      const body = await readJson(req)
      const plan = readPlan(file)
      const next = writePlan(file, plan, (draft, now) => applyMutation(draft, method, body, now))
      writeJson(res, 200, { ok: true, result: { plan: next } })
    } catch (error) {
      const code = error?.code ?? 'internal'
      writeJson(res, STATUS[code] ?? 500, {
        ok: false,
        error: { code, message: error?.message ?? '日历操作失败' },
      })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/calendar/api', handler: handle }),
    'dsh-calendar-board: http',
  )
}

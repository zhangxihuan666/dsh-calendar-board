/**
 * Browser half of dsh-calendar-board.
 *
 * A floating mini calendar lives in the shell overlay; clicking a day opens
 * the full month / week / day board. Every task can open a chat with a
 * pre-filled prompt, and completing it strikes it through in place.
 *
 * Plain browser JS on purpose: the DSH client loads this file through
 * window.__ModuleLoader__, so there is no build step and no JSX.
 */

window.__ModuleLoader__.load({
  id: 'dsh-calendar-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/calendar/api/'
    const LS_POS = 'dsh-calendar-board:pos:v4'
    const LS_COLLAPSED = 'dsh-calendar-board:collapsed'
    const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
    const WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    const LINE_NAMES = ['A', 'B', 'C', 'D', '运营', '其他']
    const LINE_COLORS = {
      A: '#4f7cff',
      B: '#2f9e6b',
      C: '#d97706',
      D: '#8b5cf6',
      运营: '#0891b2',
      其他: '#8a8f98',
    }
    const DEFAULT_PROJECTS = [
      { id: 'half', label: '工作', color: '#4f7cff' },
      { id: 'reading', label: '学习', color: '#2f9e6b' },
      { id: 'ftc', label: '生活', color: '#d97706' },
      { id: 'x', label: '副业', color: '#8b5cf6' },
      { id: 'local', label: '兴趣', color: '#0891b2' },
      { id: 'other', label: '其他', color: '#8a8f98' },
    ]
    const PROJECT_ID_RE = /^[\p{L}\p{N}_-]{1,32}$/u
    const PROJECT_COLOR_RE = /^#[0-9a-fA-F]{6}$/
    let PROJECTS = DEFAULT_PROJECTS
    let PROJECT_MAP = Object.fromEntries(PROJECTS.map((item) => [item.id, item]))

    // plan.json 里写了 projects 就用它覆盖默认表；没写就退回默认。
    function applyProjects(list) {
      const custom = Array.isArray(list)
        ? list
            .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && PROJECT_ID_RE.test(item.id.trim()))
            .slice(0, 12)
            .map((item) => ({
              id: item.id.trim(),
              label: typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim() : item.id.trim(),
              color: PROJECT_COLOR_RE.test(item.color ?? '') ? item.color : '#8a8f98',
            }))
        : []
      const next = custom.length === 0
        ? DEFAULT_PROJECTS
        : [...custom, { id: 'other', label: '其他', color: '#8a8f98' }].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
      if (next === PROJECTS) return
      if (next.map((item) => `${item.id}:${item.label}:${item.color}`).join('|') === PROJECTS.map((item) => `${item.id}:${item.label}:${item.color}`).join('|')) return
      PROJECTS = next
      PROJECT_MAP = Object.fromEntries(PROJECTS.map((item) => [item.id, item]))
    }
    const MARKER_COLOR = '#e0a100'

    function projectOf(task) {
      return PROJECT_MAP[task?.project] ?? PROJECT_MAP.other
    }

    function projectLabel(id) {
      return (PROJECT_MAP[id] ?? PROJECT_MAP.other).label
    }

    function groupByProject(tasks) {
      const map = new Map(PROJECTS.map((project) => [project.id, []]))
      for (const task of tasks) {
        const bucket = map.get(projectOf(task).id)
        bucket.push(task)
      }
      return map
    }

    function groupMarkers(markers) {
      const map = new Map()
      for (const marker of markers ?? []) {
        const bucket = map.get(marker.date)
        if (bucket === undefined) map.set(marker.date, [marker])
        else bucket.push(marker)
      }
      return map
    }

    // ---------------------------------------------------------------- dates

    function pad(value) {
      return value < 10 ? `0${value}` : String(value)
    }

    function toKey(date) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function parseKey(key) {
      const [year, month, day] = key.split('-').map(Number)
      return new Date(year, month - 1, day)
    }

    function todayKey() {
      return toKey(new Date())
    }

    function addDays(key, count) {
      const date = parseKey(key)
      date.setDate(date.getDate() + count)
      return toKey(date)
    }

    function startOfMonth(key) {
      const date = parseKey(key)
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`
    }

    function endOfMonth(key) {
      const date = parseKey(key)
      date.setMonth(date.getMonth() + 1, 0)
      return toKey(date)
    }

    function shiftMonth(key, count) {
      const date = parseKey(key)
      const day = date.getDate()
      date.setDate(1)
      date.setMonth(date.getMonth() + count)
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      date.setDate(Math.min(day, lastDay))
      return toKey(date)
    }

    function startOfWeek(key) {
      const date = parseKey(key)
      const offset = (date.getDay() + 6) % 7
      date.setDate(date.getDate() - offset)
      return toKey(date)
    }

    function formatMonth(key) {
      const date = parseKey(key)
      return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`
    }

    function formatDay(key) {
      const date = parseKey(key)
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAY_FULL[(date.getDay() + 6) % 7]}`
    }

    function formatRange(startKey, endKey) {
      const start = parseKey(startKey)
      const end = parseKey(endKey)
      if (start.getMonth() === end.getMonth()) {
        return `${start.getMonth() + 1} 月 ${start.getDate()} – ${end.getDate()} 日`
      }
      return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`
    }

    function monthGrid(key) {
      const first = parseKey(startOfMonth(key))
      const offset = (first.getDay() + 6) % 7
      const start = new Date(first)
      start.setDate(first.getDate() - offset)
      const cells = []
      for (let index = 0; index < 42; index += 1) {
        const date = new Date(start)
        date.setDate(start.getDate() + index)
        cells.push({
          key: toKey(date),
          day: date.getDate(),
          inMonth: date.getMonth() === first.getMonth(),
        })
      }
      return cells
    }

    function monthWeeks(key) {
      const first = startOfMonth(key)
      const last = endOfMonth(key)
      const weeks = []
      let cursor = startOfWeek(first)
      while (cursor <= last) {
        weeks.push(cursor)
        cursor = addDays(cursor, 7)
      }
      return weeks
    }

    function groupByDate(tasks) {
      const map = new Map()
      for (const task of tasks) {
        const bucket = map.get(task.date)
        if (bucket === undefined) map.set(task.date, [task])
        else bucket.push(task)
      }
      return map
    }

    // ------------------------------------------------------------------ api

    async function api(method, body) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      let response
      try {
        response = await fetch(`${API}${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('日历接口超时：Host 无响应，请重启 DSH 后再试')
        throw error
      } finally {
        clearTimeout(timer)
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`日历接口返回异常（${response.status}）`)
      }
      if (payload.ok !== true) {
        throw new Error(payload?.error?.message ?? `日历接口失败（${response.status}）`)
      }
      return payload.result
    }

    function loadPosition() {
      try {
        const raw = window.sessionStorage.getItem(LS_POS)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return parsed
        }
      } catch {
        // Ignore unavailable storage.
      }
      return {
        x: Math.max(8, window.innerWidth - 300),
        y: Math.max(8, window.innerHeight - 560),
      }
    }

    function savePosition(pos) {
      try {
        window.sessionStorage.setItem(LS_POS, JSON.stringify(pos))
      } catch {
        // Ignore unavailable storage.
      }
    }

    function loadCollapsed() {
      try {
        return window.sessionStorage.getItem(LS_COLLAPSED) === '1'
      } catch {
        return false
      }
    }

    function saveCollapsed(value) {
      try {
        window.sessionStorage.setItem(LS_COLLAPSED, value ? '1' : '0')
      } catch {
        // Ignore unavailable storage.
      }
    }

    function clampPosition(pos) {
      const maxX = Math.max(8, window.innerWidth - 296)
      const maxY = Math.max(8, window.innerHeight - 120)
      return {
        x: Math.min(Math.max(8, pos.x), maxX),
        y: Math.min(Math.max(8, pos.y), maxY),
      }
    }

    function buildPrompt(task) {
      const lines = [
        `【日历任务】${task.title}`,
        `项目：${projectLabel(task.project)}`,
        `日期：${task.date}${task.time ? ` ${task.time}` : ''}`,
        `产出：${task.outcome || '按任务标题执行，先给出可验收的产出。'}`,
        `备注：${task.note || '无'}`,
        `来源：${task.source || 'calendar/plan.json'}`,
        '',
        '先读项目仓库的 STATE.md 和相关 outputs/ 编号文件，再用一句话给出结论、三条最强反方、事实/假设/猜测分层、kill criteria、最便宜的下一步验证和置信度。',
        '不要复述背景，不要鼓励，直接给可执行的三步。',
      ]
      return lines.join('\n')
    }

    function statusLabel(task) {
      return task.status === 'done' ? '已完成' : '待办'
    }

    // ----------------------------------------------------------------- hook

    function usePlan() {
      const [plan, setPlan] = useState(null)
      const [capabilities, setCapabilities] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const channelRef = useRef(null) // 兼容旧缓存 bundle；新逻辑不自动广播

      const load = useCallback(async () => {
        try {
          const result = await api('load')
          applyProjects(result.plan?.projects)
          setPlan(result.plan)
          setCapabilities(result.capabilities ?? null)
          setError('')
        } catch (reason) {
          setError(reason?.message ?? '读取日历失败')
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        // 只在打开时读一次；不自动轮询，避免跨聊天框自动串改。
        load()
      }, [load])

      const mutate = useCallback(async (method, body) => {
        const result = await api(method, body)
        applyProjects(result.plan?.projects)
        setPlan(result.plan)
        setError('')
        return result.plan
      }, [])

      return { plan, capabilities, error, loading, load, mutate }
    }

    // ------------------------------------------------------------ mini view

    function MiniCalendar(props) {
      const {
        plan, cursor, collapsed, position, onPrev, onNext, onOpenDay,
        onOpenFull, onToggleCollapsed, onDragStart, onDragMove, onDragEnd,
        onToggleGoal, onResetPosition, onRefresh, hostOutdated,
      } = props
      const byDate = useMemo(() => groupByDate(plan.tasks), [plan.tasks])
      const markersByDate = useMemo(() => groupMarkers(plan.markers), [plan.markers])
      const cells = useMemo(() => monthGrid(cursor), [cursor])
      const monthTasks = useMemo(
        () => plan.tasks.filter((task) => task.date.slice(0, 7) === cursor.slice(0, 7)),
        [plan.tasks, cursor],
      )
      const monthGoals = useMemo(
        () => plan.goals.filter((goal) => goal.date !== null && goal.date.slice(0, 7) === cursor.slice(0, 7)),
        [plan.goals, cursor],
      )
      const doneCount = monthTasks.filter((task) => task.status === 'done').length
      const goalsDone = monthGoals.filter((goal) => goal.status === 'done').length
      const today = todayKey()

      if (collapsed) {
        const openCount = plan.tasks.filter((task) => task.status !== 'done' && task.date === today).length
        return h(
          'div',
          { className: 'calb-root', style: { left: `${position.x}px`, top: `${position.y}px` } },
          h(
            'button',
            {
              type: 'button',
              className: 'calb-pill',
              title: '打开日历',
              onClick: onToggleCollapsed,
            },
            h(CalendarGlyph, { size: 18 }),
            h('span', { className: 'calb-pill-day' }, String(parseKey(today).getDate())),
            openCount > 0 ? h('span', { className: 'calb-pill-dot' }) : null,
          ),
        )
      }

      return h(
        'div',
        { className: 'calb-root', style: { left: `${position.x}px`, top: `${position.y}px` } },
        h(
          'section',
          { className: 'calb-card', 'aria-label': '日历缩图' },
          h(
            'header',
            {
              className: 'calb-card-head',
              onPointerDown: onDragStart,
              onPointerMove: onDragMove,
              onPointerUp: onDragEnd,
              onPointerCancel: onDragEnd,
            },
            h('div', { className: 'calb-card-title' }, h(CalendarGlyph, { size: 15 }), h('span', null, formatMonth(cursor))),
            h(
              'div',
              { className: 'calb-card-actions', onPointerDown: (event) => event.stopPropagation() },
              h('button', { type: 'button', className: 'calb-icon-btn', title: '上个月', onClick: onPrev }, '‹'),
              h('button', { type: 'button', className: 'calb-icon-btn', title: '下个月', onClick: onNext }, '›'),
              h('button', { type: 'button', className: 'calb-icon-btn', title: '从磁盘刷新', onClick: onRefresh }, '↻'),
              h('button', { type: 'button', className: 'calb-icon-btn', title: '复位到右下角', onClick: onResetPosition }, '⌖'),
              h('button', { type: 'button', className: 'calb-icon-btn', title: '收起', onClick: onToggleCollapsed }, '–'),
            ),
          ),
          hostOutdated
            ? h('div', { className: 'calb-host-warning' }, 'Host 旧版仍运行：重启 DSH 后再改；现在写入会丢项目/节点标记。')
            : null,
          h(
            'div',
            { className: 'calb-dow' },
            WEEKDAYS.map((label) => h('span', { key: label }, label)),
          ),
          h(
            'div',
            { className: 'calb-mini-grid' },
            cells.map((cell) => {
              const tasks = byDate.get(cell.key) ?? []
              const markers = markersByDate.get(cell.key) ?? []
              const markerText = markers.map((marker) => marker.label).join(' / ')
              return h(
                'button',
                {
                  key: cell.key,
                  type: 'button',
                  className: [
                    'calb-mini-day',
                    cell.inMonth ? '' : 'is-out',
                    cell.key === today ? 'is-today' : '',
                    markers.length > 0 ? 'has-marker' : '',
                  ].filter(Boolean).join(' '),
                  onClick: () => onOpenDay(cell.key),
                  title: [
                    cell.key,
                    tasks.length > 0 ? `${tasks.length} 项` : '',
                    markerText,
                  ].filter(Boolean).join(' · '),
                },
                h('span', { className: 'calb-mini-num' }, String(cell.day)),
                h(
                  'span',
                  { className: 'calb-mini-dots' },
                  cell.key === today ? h('span', { className: 'calb-mini-dot is-today' }) : null,
                  markers.length > 0 ? h('span', { className: 'calb-mini-dot is-marker' }) : null,
                ),
              )
            }),
          ),
          h(
            'div',
            { className: 'calb-mini-goals' },
            h(
              'div',
              { className: 'calb-mini-goals-head' },
              h('span', null, '本月要产出'),
              h('span', { className: 'calb-mini-goals-count' }, `${goalsDone}/${monthGoals.length}`),
            ),
            monthGoals.length === 0
              ? h('div', { className: 'calb-mini-goals-empty' }, '本月还没有月度目标。')
              : monthGoals.slice(0, 3).map((goal) =>
                  h(
                    'label',
                    { key: goal.id, className: `calb-mini-goal${goal.status === 'done' ? ' is-done' : ''}` },
                    h('input', {
                      type: 'checkbox',
                      className: 'calb-mini-check',
                      checked: goal.status === 'done',
                      onChange: () => onToggleGoal(goal),
                      'aria-label': `完成目标 ${goal.title}`,
                    }),
                    h('span', { className: 'calb-mini-goal-dot', style: { background: projectOf(goal).color } }),
                    h('span', { className: 'calb-mini-goal-title' }, goal.title),
                  ),
                ),
            h('button', { type: 'button', className: 'calb-link calb-mini-all', onClick: onOpenFull }, '看全部 →'),
          ),
          h(
            'footer',
            { className: 'calb-card-foot' },
            h('span', null, `本月 ${monthTasks.length} 项 · 完成 ${doneCount}`),
            h('button', { type: 'button', className: 'calb-link', onClick: onOpenFull }, '打开日历'),
          ),
        ),
      )
    }

    // ------------------------------------------------------------ full view

    function FullCalendar(props) {
      const {
        plan, view, cursor, selected, onView, onCursor, onSelect, onClose,
        onOpenTask, onNewTask, onToggleTask, onToggleGoal, onAddGoal,
        onRefresh, hostOutdated, embedded = false,
      } = props
      const byDate = useMemo(() => groupByDate(plan.tasks), [plan.tasks])
      const markersByDate = useMemo(() => groupMarkers(plan.markers), [plan.markers])
      const monthTasks = useMemo(
        () => plan.tasks.filter((task) => task.date.slice(0, 7) === cursor.slice(0, 7)),
        [plan.tasks, cursor],
      )
      const selectedTasks = byDate.get(selected) ?? []
      const selectedMarkers = markersByDate.get(selected) ?? []

      const step = (direction) => {
        if (view === 'month') {
          const next = shiftMonth(cursor, direction)
          onCursor(next)
          onSelect(next)
          return
        }
        if (view === 'week') {
          const next = addDays(cursor, direction * 7)
          onCursor(next)
          onSelect(next)
          return
        }
        const next = addDays(selected, direction)
        onCursor(next)
        onSelect(next)
      }

      const goToday = () => {
        const today = todayKey()
        onCursor(today)
        onSelect(today)
      }

      return h(
        'div',
        {
          className: `calb-backdrop${embedded ? ' is-embedded' : ''}`,
          onMouseDown: (event) => {
            if (!embedded && event.target === event.currentTarget) onClose()
          },
        },
        h(
          'section',
          { className: 'calb-modal', role: embedded ? 'region' : 'dialog', 'aria-modal': embedded ? undefined : 'true', 'aria-label': '日历' },
          h(
            'header',
            { className: 'calb-modal-head' },
            h(
              'div',
              { className: 'calb-modal-title' },
              h('div', { className: 'calb-modal-eyebrow' }, '项目日历 · 月 / 周 / 日'),
              h('h2', null, view === 'month' ? formatMonth(cursor) : view === 'week' ? formatRange(startOfWeek(cursor), addDays(startOfWeek(cursor), 6)) : formatDay(selected)),
            ),
            h(
              'div',
              { className: 'calb-modal-tools' },
              h('button', { type: 'button', className: 'calb-btn', onClick: goToday }, '今天'),
              h('button', { type: 'button', className: 'calb-icon-btn', onClick: () => step(-1), title: '上一段' }, '‹'),
              h('button', { type: 'button', className: 'calb-icon-btn', onClick: () => step(1), title: '下一段' }, '›'),
              h('button', { type: 'button', className: 'calb-icon-btn', onClick: onRefresh, title: '从磁盘刷新' }, '↻'),
              h(
                'div',
                { className: 'calb-tabs', role: 'tablist' },
                [['month', '月'], ['week', '周'], ['day', '日']].map(([key, label]) =>
                  h(
                    'button',
                    {
                      key,
                      type: 'button',
                      role: 'tab',
                      'aria-selected': view === key,
                      className: `calb-tab${view === key ? ' is-active' : ''}`,
                      onClick: () => onView(key),
                    },
                    label,
                  ),
                ),
              ),
              embedded ? null : h('button', { type: 'button', className: 'calb-icon-btn calb-close', onClick: onClose, title: '关闭' }, '×'),
            ),
          ),
          h(
            'div',
            { className: 'calb-modal-body' },
            h(
              'main',
              { className: 'calb-main' },
              view === 'month'
                ? h(MonthView, {
                    cells: monthGrid(cursor),
                    byDate,
                    markersByDate,
                    selected,
                    onSelect,
                    onOpenTask,
                    onNewTask,
                    onOpenDay: (key) => {
                      onSelect(key)
                      onCursor(key)
                      onView('day')
                    },
                  })
                : view === 'week'
                  ? h(WeekView, {
                      start: startOfWeek(cursor),
                      byDate,
                      markersByDate,
                      onOpenTask,
                      onNewTask,
                      onOpenDay: (key) => {
                        onSelect(key)
                        onCursor(key)
                        onView('day')
                      },
                    })
                  : h(DayView, {
                      date: selected,
                      tasks: selectedTasks,
                      markers: selectedMarkers,
                      onOpenTask,
                      onNewTask,
                      onToggleTask,
                    }),
            ),
            h(Aside, {
              plan,
              monthTasks,
              cursor,
              selected,
              selectedTasks,
              selectedMarkers,
              onOpenTask,
              onToggleGoal,
              onAddGoal,
              hostOutdated,
            }),
          ),
        ),
      )
    }

    function MonthView({ cells, byDate, markersByDate, selected, onOpenTask, onNewTask, onOpenDay }) {
      const today = todayKey()
      return h(
        'div',
        { className: 'calb-month' },
        h('div', { className: 'calb-month-dow' }, WEEKDAYS.map((label) => h('span', { key: label }, label))),
        h(
          'div',
          { className: 'calb-month-grid' },
          cells.map((cell) => {
            const tasks = byDate.get(cell.key) ?? []
            const markers = markersByDate.get(cell.key) ?? []
            return h(
              'div',
              {
                key: cell.key,
                className: [
                  'calb-month-cell',
                  cell.inMonth ? '' : 'is-out',
                  cell.key === today ? 'is-today' : '',
                  cell.key === selected ? 'is-selected' : '',
                  markers.length > 0 ? 'has-marker' : '',
                ].filter(Boolean).join(' '),
                onClick: () => onOpenDay(cell.key),
              },
              h(
                'div',
                { className: 'calb-month-cell-head' },
                h('span', { className: 'calb-month-num' }, String(cell.day)),
                markers.length > 0
                  ? h('span', {
                      className: 'calb-marker-pin',
                      title: markers.map((marker) => marker.label).join(' / '),
                    })
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'calb-cell-add',
                    title: '在这一天新增任务',
                    onClick: (event) => {
                      event.stopPropagation()
                      onNewTask(cell.key)
                    },
                  },
                  '+',
                ),
              ),
              markers.length > 0
                ? h('div', { className: 'calb-marker-label', title: markers.map((marker) => marker.label).join(' / ') }, markers[0].label)
                : null,
              h(
                'div',
                { className: 'calb-chips' },
                tasks.slice(0, 2).map((task) => {
                  const project = projectOf(task)
                  return h(
                    'button',
                    {
                      key: task.id,
                      type: 'button',
                      className: `calb-chip${task.status === 'done' ? ' is-done' : ''}`,
                      style: { borderLeftColor: project.color },
                      title: `${project.label} · ${task.time ? `${task.time} · ` : ''}${task.title}`,
                      onClick: (event) => {
                        event.stopPropagation()
                        onOpenTask(task.id)
                      },
                    },
                    h('span', { className: 'calb-chip-project', style: { background: project.color } }),
                    h('span', { className: 'calb-chip-title' }, task.title),
                    task.time ? h('span', { className: 'calb-chip-time' }, task.time) : null,
                  )
                }),
                tasks.length > 2 ? h('span', { className: 'calb-chip-more' }, `+${tasks.length - 2}`) : null,
              ),
            )
          }),
        ),
      )
    }

    function WeekView({ start, byDate, markersByDate, onOpenTask, onNewTask, onOpenDay }) {
      const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
      const today = todayKey()
      return h(
        'div',
        { className: 'calb-week' },
        days.map((key) => {
          const tasks = byDate.get(key) ?? []
          const markers = markersByDate.get(key) ?? []
          return h(
            'div',
            { key, className: `calb-week-col${key === today ? ' is-today' : ''}` },
            h(
              'button',
              { type: 'button', className: 'calb-week-head', onClick: () => onOpenDay(key) },
              h('span', { className: 'calb-week-dow' }, WEEKDAY_FULL[(parseKey(key).getDay() + 6) % 7]),
              h('span', { className: 'calb-week-num' }, `${parseKey(key).getMonth() + 1}/${parseKey(key).getDate()}`),
            ),
            markers.length > 0
              ? h('div', { className: 'calb-week-marker', title: markers.map((marker) => marker.label).join(' / ') }, markers[0].label)
              : null,
            h(
              'div',
              { className: 'calb-week-list' },
              tasks.map((task) => {
                const project = projectOf(task)
                return h(
                  'button',
                  {
                    key: task.id,
                    type: 'button',
                    className: `calb-week-item${task.status === 'done' ? ' is-done' : ''}`,
                    style: { borderLeftColor: project.color },
                    onClick: () => onOpenTask(task.id),
                  },
                  h('span', { className: 'calb-week-item-title' }, task.title),
                  h('span', { className: 'calb-week-item-meta' }, `${task.time ?? '全天'} · ${project.label}`),
                )
              }),
              h(
                'button',
                { type: 'button', className: 'calb-week-add', onClick: () => onNewTask(key) },
                '+ 新增',
              ),
            ),
          )
        }),
      )
    }

    function DayView({ date, tasks, markers, onOpenTask, onNewTask, onToggleTask }) {
      const groups = Array.from(groupByProject(tasks).entries()).filter(([, items]) => items.length > 0)
      return h(
        'div',
        { className: 'calb-day' },
        h(
          'div',
          { className: 'calb-day-head' },
          h(
            'div',
            null,
            h('div', { className: 'calb-day-title' }, formatDay(date)),
            h('div', { className: 'calb-day-sub' }, `${tasks.length} 项 · 完成 ${tasks.filter((task) => task.status === 'done').length} · ${groups.length} 个项目`),
          ),
          h('button', { type: 'button', className: 'calb-btn calb-btn-primary', onClick: () => onNewTask(date) }, '+ 新增任务'),
        ),
        markers.length > 0
          ? h(
              'div',
              { className: 'calb-day-markers' },
              markers.map((marker) =>
                h(
                  'span',
                  { key: marker.id, className: `calb-marker-chip is-${marker.type}` },
                  h('span', { className: 'calb-marker-dot' }),
                  `${marker.label}${marker.note ? ` · ${marker.note}` : ''}`,
                ),
              ),
            )
          : null,
        tasks.length === 0
          ? h('div', { className: 'calb-empty' }, '这一天还没有任务。', h('button', { type: 'button', className: 'calb-link', onClick: () => onNewTask(date) }, '补一条'))
          : h(
              'div',
              { className: 'calb-day-groups' },
              groups.map(([projectId, items]) => {
                const project = PROJECT_MAP[projectId] ?? PROJECT_MAP.other
                const done = items.filter((task) => task.status === 'done').length
                return h(
                  'section',
                  { key: projectId, className: 'calb-day-group', style: { '--project-color': project.color } },
                  h(
                    'div',
                    { className: 'calb-day-group-head' },
                    h('span', { className: 'calb-project-dot', style: { background: project.color } }),
                    h('span', { className: 'calb-day-group-name' }, project.label),
                    h('span', { className: 'calb-day-group-count' }, `${done}/${items.length}`),
                  ),
                  h(
                    'div',
                    { className: 'calb-day-group-grid' },
                    items.map((task) =>
                      h(
                        'div',
                        { key: task.id, className: `calb-day-card${task.status === 'done' ? ' is-done' : ''}`, style: { borderLeftColor: project.color } },
                        h('input', {
                          type: 'checkbox',
                          className: 'calb-check',
                          checked: task.status === 'done',
                          onChange: () => onToggleTask(task),
                          'aria-label': `完成 ${task.title}`,
                        }),
                        h(
                          'button',
                          { type: 'button', className: 'calb-day-card-main', onClick: () => onOpenTask(task.id) },
                          h(
                            'div',
                            { className: 'calb-day-card-top' },
                            h('span', { className: 'calb-day-card-title' }, task.title),
                            task.time ? h('span', { className: 'calb-time' }, task.time) : null,
                          ),
                          task.outcome ? h('div', { className: 'calb-day-card-outcome' }, task.outcome) : null,
                          h('div', { className: 'calb-day-card-meta' }, `${project.label}${task.priority ? ` · ${task.priority}` : ''}${task.source ? ` · ${task.source}` : ''}`),
                        ),
                        h('button', { type: 'button', className: 'calb-btn calb-btn-ghost', onClick: () => onOpenTask(task.id) }, '查看'),
                      ),
                    ),
                  ),
                )
              }),
            ),
      )
    }

    function Aside({ plan, monthTasks, cursor, selected, selectedTasks, selectedMarkers, onOpenTask, onToggleGoal, onAddGoal, hostOutdated }) {
      const [history, setHistory] = useState([])
      useEffect(() => {
        let live = true
        api('history')
          .then((result) => {
            if (live) setHistory(Array.isArray(result?.items) ? result.items.slice(0, 4) : [])
          })
          .catch(() => {
            if (live) setHistory([])
          })
        return () => {
          live = false
        }
      }, [plan.rev])
      const monthGoals = useMemo(
        () => plan.goals.filter((goal) => goal.date !== null && goal.date.slice(0, 7) === cursor.slice(0, 7)),
        [plan.goals, cursor],
      )
      const monthDone = monthTasks.filter((task) => task.status === 'done').length
      const goalsDone = monthGoals.filter((goal) => goal.status === 'done').length
      const goalGroups = Array.from(groupByProject(monthGoals).entries()).filter(([, items]) => items.length > 0)
      const taskGroups = Array.from(groupByProject(selectedTasks).entries()).filter(([, items]) => items.length > 0)

      return h(
        'aside',
        { className: 'calb-aside' },
        hostOutdated
          ? h('div', { className: 'calb-host-warning' }, 'Host 旧版仍运行：重启 DSH 后再改；现在写入会丢项目/节点标记。')
          : null,
        h(
          'section',
          { className: 'calb-panel' },
          h(
            'div',
            { className: 'calb-panel-head' },
            h('h3', null, '本月产出'),
            h('span', { className: 'calb-panel-count' }, `${goalsDone}/${monthGoals.length}`),
          ),
          h(
            'div',
            { className: 'calb-progress' },
            h('div', {
              className: 'calb-progress-fill',
              style: { width: `${monthGoals.length === 0 ? 0 : Math.round((goalsDone / monthGoals.length) * 100)}%` },
            }),
          ),
          h('div', { className: 'calb-aside-sub' }, `任务进度 ${monthDone}/${monthTasks.length}`),
          goalGroups.length === 0
            ? h('div', { className: 'calb-muted' }, '本月还没有目标。')
            : goalGroups.map(([projectId, goals]) => {
                const project = PROJECT_MAP[projectId] ?? PROJECT_MAP.other
                return h(
                  'div',
                  { key: projectId, className: 'calb-aside-project' },
                  h(
                    'div',
                    { className: 'calb-aside-project-head' },
                    h('span', { className: 'calb-project-dot', style: { background: project.color } }),
                    h('span', null, project.label),
                    h('span', { className: 'calb-aside-project-count' }, `${goals.filter((goal) => goal.status === 'done').length}/${goals.length}`),
                    h('button', {
                      type: 'button',
                      className: 'calb-icon-btn calb-aside-project-add',
                      title: `在${project.label}新增目标`,
                      onClick: () => onAddGoal(project.id),
                    }, '+'),
                  ),
                  goals.map((goal) =>
                    h(
                      'label',
                      { key: goal.id, className: `calb-goal${goal.status === 'done' ? ' is-done' : ''}` },
                      h('input', {
                        type: 'checkbox',
                        className: 'calb-check',
                        checked: goal.status === 'done',
                        onChange: () => onToggleGoal(goal),
                        'aria-label': `完成目标 ${goal.title}`,
                      }),
                      h(
                        'span',
                        { className: 'calb-goal-body' },
                        h('span', { className: 'calb-goal-title' }, goal.title),
                        goal.metric ? h('span', { className: 'calb-goal-meta' }, goal.metric) : null,
                      ),
                    ),
                  ),
                )
              }),
          h('button', { type: 'button', className: 'calb-link calb-aside-add', onClick: () => onAddGoal() }, '+ 新增月度目标'),
        ),
        history.length > 0
          ? h(
              'section',
              { className: 'calb-panel calb-history' },
              h(
                'div',
                { className: 'calb-panel-head' },
                h('h3', null, '最近变更'),
                h('span', { className: 'calb-panel-count' }, '自动记录'),
              ),
              history.map((entry) => {
                const action = entry.action === 'remove'
                  ? '删除'
                  : entry.action === 'toggle'
                    ? (entry.afterStatus === 'done' ? '完成' : '撤销')
                    : entry.action === 'goal-toggle'
                      ? (entry.afterStatus === 'done' ? '目标完成' : '目标撤销')
                      : entry.action === 'goal-upsert'
                        ? '更新目标'
                        : (entry.beforeStatus === null ? '新增' : '更新')
                const time = typeof entry.at === 'string'
                  ? new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                  : ''
                return h(
                  'div',
                  { key: `${entry.at}-${entry.id}-${entry.rev}`, className: 'calb-history-item' },
                  h('span', { className: 'calb-history-action' }, action),
                  h('span', { className: 'calb-history-title' }, entry.title || entry.id),
                  h('span', { className: 'calb-history-time' }, time),
                )
              }),
            )
          : null,
        h(
          'section',
          { className: 'calb-panel' },
          h(
            'div',
            { className: 'calb-panel-head' },
            h('h3', null, `选中日 · ${formatDay(selected)}`),
            h('span', { className: 'calb-panel-count' }, `${selectedTasks.length} 项`),
          ),
          selectedMarkers.length > 0
            ? h(
                'div',
                { className: 'calb-aside-markers' },
                selectedMarkers.map((marker) =>
                  h(
                    'span',
                    { key: marker.id, className: `calb-marker-chip is-${marker.type}` },
                    h('span', { className: 'calb-marker-dot' }),
                    marker.label,
                  ),
                ),
              )
            : null,
          taskGroups.length === 0
            ? h('div', { className: 'calb-muted' }, '这一天没有任务。')
            : taskGroups.map(([projectId, items]) => {
                const project = PROJECT_MAP[projectId] ?? PROJECT_MAP.other
                return h(
                  'div',
                  { key: projectId, className: 'calb-aside-project' },
                  h(
                    'div',
                    { className: 'calb-aside-project-head' },
                    h('span', { className: 'calb-project-dot', style: { background: project.color } }),
                    h('span', null, project.label),
                    h('span', { className: 'calb-aside-project-count' }, `${items.filter((task) => task.status === 'done').length}/${items.length}`),
                  ),
                  items.map((task) =>
                    h(
                      'button',
                      {
                        key: task.id,
                        type: 'button',
                        className: `calb-weekly-item${task.status === 'done' ? ' is-done' : ''}`,
                        onClick: () => onOpenTask(task.id),
                      },
                      h('span', { className: 'calb-weekly-dot', style: { background: project.color } }),
                      h('span', { className: 'calb-weekly-title' }, task.title),
                      task.time ? h('span', { className: 'calb-weekly-time' }, task.time) : null,
                    ),
                  ),
                )
              }),
          h('div', { className: 'calb-aside-note' }, '数据在 calendar/plan.json；红点=今天，黄点=节日/节点。页面不自动刷新；外部改动后点 ↻ 重新读取。改动自动记录到 history/changes.jsonl。'),
        ),
      )
    }

    // -------------------------------------------------------------- dialogs

    function TaskDetail({ task, onClose, onToggle, onEdit, onRemove, onChat }) {
      const project = projectOf(task)
      return h(
        'div',
        {
          className: 'calb-detail-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'section',
          { className: 'calb-detail', role: 'dialog', 'aria-modal': 'true', 'aria-label': task.title },
          h(
            'header',
            { className: 'calb-detail-head' },
            h('div', null, h('div', { className: 'calb-detail-kicker' }, `${task.date}${task.time ? ` · ${task.time}` : ''} · ${project.label}`), h('h3', null, task.title)),
            h('button', { type: 'button', className: 'calb-icon-btn', onClick: onClose, title: '关闭' }, '×'),
          ),
          h(
            'div',
            { className: 'calb-detail-meta' },
            h('span', { className: 'calb-badge calb-badge-project', style: { borderColor: project.color, color: project.color } }, project.label),
            h('span', { className: `calb-badge${task.status === 'done' ? ' is-done' : ''}` }, statusLabel(task)),
            h('span', { className: 'calb-badge' }, `${task.line} 线`),
            task.priority ? h('span', { className: 'calb-badge' }, task.priority) : null,
            task.source ? h('span', { className: 'calb-badge' }, task.source) : null,
          ),
          task.outcome ? h('div', { className: 'calb-detail-block' }, h('h4', null, '产出'), h('p', null, task.outcome)) : null,
          task.note ? h('div', { className: 'calb-detail-block' }, h('h4', null, '备注'), h('p', null, task.note)) : null,
          h('div', { className: 'calb-detail-actions' },
            h('button', { type: 'button', className: 'calb-btn calb-btn-primary', onClick: onChat }, '打开聊天'),
            h('button', { type: 'button', className: 'calb-btn', onClick: onToggle }, task.status === 'done' ? '撤销完成' : '完成'),
            h('button', { type: 'button', className: 'calb-btn', onClick: onEdit }, '编辑'),
            h('button', { type: 'button', className: 'calb-btn calb-danger', onClick: onRemove }, '删除'),
          ),
        ),
      )
    }

    function TaskForm({ initial, onClose, onSave }) {
      const [draft, setDraft] = useState(() => ({ ...initial }))
      const [error, setError] = useState('')
      const [saving, setSaving] = useState(false)
      const firstRef = useRef(null)

      useEffect(() => {
        setDraft({ ...initial })
        setError('')
        const timer = window.setTimeout(() => firstRef.current?.focus(), 30)
        return () => window.clearTimeout(timer)
      }, [initial])

      const set = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }))

      const submit = async (event) => {
        event.preventDefault()
        if (draft.title.trim() === '') {
          setError('标题不能为空')
          return
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
          setError('日期格式必须是 YYYY-MM-DD')
          return
        }
        setSaving(true)
        try {
          const time = typeof draft.time === 'string' ? draft.time.trim() : ''
          await onSave({
            ...draft,
            title: draft.title.trim(),
            outcome: draft.outcome.trim(),
            note: draft.note.trim(),
            time: time === '' ? null : time,
          })
        } catch (reason) {
          setError(reason?.message ?? '保存失败')
          setSaving(false)
        }
      }

      return h(
        'div',
        {
          className: 'calb-detail-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'form',
          { className: 'calb-form', onSubmit: submit },
          h(
            'header',
            { className: 'calb-detail-head' },
            h('div', null, h('div', { className: 'calb-detail-kicker' }, initial.id ? '编辑任务' : '新增任务'), h('h3', null, initial.id ? initial.title : '写下一件要发生的事')),
            h('button', { type: 'button', className: 'calb-icon-btn', onClick: onClose, title: '关闭' }, '×'),
          ),
          h(
            'div',
            { className: 'calb-form-body' },
            h('label', { className: 'calb-field' }, h('span', null, '标题'), h('input', { ref: firstRef, value: draft.title, onChange: set('title'), placeholder: '例如：发第 4 篇互动帖', maxLength: 200 })),
            h(
              'div',
              { className: 'calb-field-row' },
              h('label', { className: 'calb-field' }, h('span', null, '日期'), h('input', { type: 'date', value: draft.date, onChange: set('date') })),
              h('label', { className: 'calb-field' }, h('span', null, '时间（可空）'), h('input', { type: 'time', value: draft.time ?? '', onChange: set('time') })),
            ),
            h(
              'div',
              { className: 'calb-field-row' },
              h('label', { className: 'calb-field' }, h('span', null, '项目'), h('select', { value: draft.project ?? 'other', onChange: set('project') }, PROJECTS.map((project) => h('option', { key: project.id, value: project.id }, project.label)))),
              h('label', { className: 'calb-field' }, h('span', null, '线'), h('select', { value: draft.line, onChange: set('line') }, LINE_NAMES.map((name) => h('option', { key: name, value: name }, name)))),
            ),
            h('label', { className: 'calb-field' }, h('span', null, '要交付的产出'), h('textarea', { rows: 3, value: draft.outcome, onChange: set('outcome'), placeholder: '完成的标准是什么？例如：一篇 800 字笔记 + 3 张图，20:00 发出' })),
            h('label', { className: 'calb-field' }, h('span', null, '备注 / 约束'), h('textarea', { rows: 2, value: draft.note, onChange: set('note'), placeholder: '例如：不要放价格；先私信收钱' })),
            initial.id ? h('label', { className: 'calb-field' }, h('span', null, '绑定会话 ID（可空）'), h('input', { value: draft.sessionId ?? '', onChange: set('sessionId'), placeholder: '已有会话时填；留空则打开新会话' })) : null,
            error ? h('div', { className: 'calb-error' }, error) : null,
          ),
          h(
            'footer',
            { className: 'calb-form-foot' },
            h('button', { type: 'button', className: 'calb-btn', onClick: onClose }, '取消'),
            h('button', { type: 'submit', className: 'calb-btn calb-btn-primary', disabled: saving }, saving ? '保存中…' : '保存'),
          ),
        ),
      )
    }

    function GoalForm({ initial, onClose, onSave }) {
      const [draft, setDraft] = useState(() => ({ ...initial }))
      const [error, setError] = useState('')
      const [saving, setSaving] = useState(false)
      const firstRef = useRef(null)

      useEffect(() => {
        setDraft({ ...initial })
        setError('')
        const timer = window.setTimeout(() => firstRef.current?.focus(), 30)
        return () => window.clearTimeout(timer)
      }, [initial])

      const set = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }))
      const monthLabel = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? formatMonth(draft.date) : '所选月份'

      const submit = async (event) => {
        event.preventDefault()
        if (draft.title.trim() === '') {
          setError('目标名称不能为空')
          return
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
          setError('日期格式必须是 YYYY-MM-DD')
          return
        }
        setSaving(true)
        try {
          await onSave({
            ...draft,
            title: draft.title.trim(),
            metric: draft.metric.trim(),
          })
        } catch (reason) {
          setError(reason?.message ?? '保存目标失败')
          setSaving(false)
        }
      }

      return h(
        'div',
        {
          className: 'calb-detail-backdrop calb-confirm-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !saving) onClose()
          },
        },
        h(
          'form',
          { className: 'calb-form calb-goal-form', onSubmit: submit },
          h(
            'header',
            { className: 'calb-detail-head' },
            h('div', null, h('div', { className: 'calb-detail-kicker' }, '月度目标'), h('h3', null, '这个月要交出什么？')),
            h('button', { type: 'button', className: 'calb-icon-btn', onClick: onClose, title: '关闭' }, '×'),
          ),
          h(
            'div',
            { className: 'calb-form-body' },
            h('label', { className: 'calb-field' }, h('span', null, '目标名称'), h('input', { ref: firstRef, value: draft.title, onChange: set('title'), placeholder: '例如：本月读完 1 本，产出 3 条笔记', maxLength: 200 })),
            h('label', { className: 'calb-field' }, h('span', null, '怎么算完成（可空）'), h('input', { value: draft.metric, onChange: set('metric'), placeholder: '例如：3 条笔记 / ≥10 单', maxLength: 200 })),
            h(
              'div',
              { className: 'calb-field-row' },
              h('label', { className: 'calb-field' }, h('span', null, '项目'), h('select', { value: draft.project, onChange: set('project') }, PROJECTS.map((project) => h('option', { key: project.id, value: project.id }, project.label)))),
              h('label', { className: 'calb-field' }, h('span', null, '归属日期'), h('input', { type: 'date', value: draft.date, onChange: set('date') })),
            ),
            h('div', { className: 'calb-form-hint' }, `保存后会出现在 ${monthLabel} 的「本月产出」里。`),
            error ? h('div', { className: 'calb-error' }, error) : null,
          ),
          h(
            'footer',
            { className: 'calb-form-foot' },
            h('button', { type: 'button', className: 'calb-btn', onClick: onClose, disabled: saving }, '取消'),
            h('button', { type: 'submit', className: 'calb-btn calb-btn-primary', disabled: saving }, saving ? '保存中…' : '添加目标'),
          ),
        ),
      )
    }

    function ConfirmDialog({ title, message, onClose, onConfirm }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const confirm = async () => {
        setBusy(true)
        setError('')
        try {
          await onConfirm()
        } catch (reason) {
          setError(reason?.message ?? '操作失败')
          setBusy(false)
        }
      }

      return h(
        'div',
        {
          className: 'calb-detail-backdrop calb-confirm-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !busy) onClose()
          },
        },
        h(
          'section',
          { className: 'calb-confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'calb-confirm-title' }, title),
          h('p', { className: 'calb-confirm-message' }, message),
          error ? h('div', { className: 'calb-error' }, error) : null,
          h(
            'div',
            { className: 'calb-confirm-actions' },
            h('button', { type: 'button', className: 'calb-btn', onClick: onClose, disabled: busy }, '取消'),
            h('button', { type: 'button', className: 'calb-btn calb-danger', onClick: confirm, disabled: busy }, busy ? '删除中…' : '删除'),
          ),
        ),
      )
    }

    // --------------------------------------------------------------- shell

    function CalendarOverlay({ workspace }) {
      const { plan, capabilities, error, loading, mutate } = usePlan()
      const [open, setOpen] = useState(false)
      const [view, setView] = useState('month')
      const [cursor, setCursor] = useState(() => todayKey())
      const [selected, setSelected] = useState(() => todayKey())
      const [detailId, setDetailId] = useState(null)
      const [form, setForm] = useState(null)
      const [goalForm, setGoalForm] = useState(null)
      const [confirmTask, setConfirmTask] = useState(null)
      const [collapsed, setCollapsed] = useState(loadCollapsed)
      const [position, setPosition] = useState(loadPosition)
      const [toast, setToast] = useState('')
      const dragRef = useRef(null)
      const posRef = useRef(position)
      const toastTimer = useRef(null)
      posRef.current = position

      const notify = useCallback((message) => {
        setToast(message)
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(''), 3200)
      }, [])

      useEffect(() => () => {
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      }, [])

      useEffect(() => {
        const onResize = () => setPosition((current) => clampPosition(current))
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      useEffect(() => {
        if (!open) return undefined
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          document.body.style.overflow = previous
        }
      }, [open])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (confirmTask !== null) setConfirmTask(null)
          else if (goalForm !== null) setGoalForm(null)
          else if (form !== null) setForm(null)
          else if (detailId !== null) setDetailId(null)
          else if (open) setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [confirmTask, detailId, form, goalForm, open])

      const tasks = plan?.tasks ?? []
      const goals = plan?.goals ?? []
      const hostOutdated = plan !== null && (capabilities === null || capabilities.projects !== true)
      const detailTask = detailId === null ? null : tasks.find((task) => task.id === detailId) ?? null

      const guardedMutate = useCallback(async (method, body) => {
        if (hostOutdated) {
          throw new Error('Host 还是旧版：请退出 DeepSeek Harness 再重新打开。重启前新增/勾选会把项目与节点标记剥掉。')
        }
        return mutate(method, body)
      }, [hostOutdated, mutate])

      const openDay = (key) => {
        setSelected(key)
        setCursor(key)
        setView('day')
        setOpen(true)
      }

      const openFull = () => {
        const nextSelected = selected.slice(0, 7) === cursor.slice(0, 7) ? selected : startOfMonth(cursor)
        setSelected(nextSelected)
        setView('month')
        setOpen(true)
      }

      const stepMonth = (direction) => {
        setCursor(shiftMonth(cursor, direction))
      }

      const toggleTask = async (task) => {
        try {
          await guardedMutate('toggle', { id: task.id, done: task.status !== 'done' })
        } catch (reason) {
          notify(reason?.message ?? '更新失败')
        }
      }

      const toggleGoal = async (goal) => {
        try {
          await guardedMutate('goal-toggle', { id: goal.id, done: goal.status !== 'done' })
        } catch (reason) {
          notify(reason?.message ?? '更新失败')
        }
      }

      const saveTask = async (draft) => {
        await guardedMutate('upsert', { task: draft })
        setForm(null)
        notify(draft.id ? '任务已更新' : '任务已添加')
      }

      const requestRemove = (task) => setConfirmTask(task)

      const performRemove = async () => {
        if (confirmTask === null) return
        await guardedMutate('remove', { id: confirmTask.id })
        setConfirmTask(null)
        setDetailId(null)
        notify('任务已删除')
      }

      const openGoalForm = (projectId) => {
        const project = PROJECTS.some((item) => item.id === projectId) ? projectId : 'reading'
        setDetailId(null)
        setForm(null)
        setGoalForm({
          id: '',
          title: '',
          metric: '',
          project,
          date: endOfMonth(cursor),
        })
      }

      const saveGoal = async (draft) => {
        await guardedMutate('goal-upsert', { goal: draft })
        setGoalForm(null)
        notify(`已添加到 ${projectLabel(draft.project)} 的本月产出`)
      }

      const newTask = (date) => {
        setForm({
          id: '',
          title: '',
          date,
          time: null,
          status: 'todo',
          line: '运营',
          project: 'half',
          priority: null,
          outcome: '',
          note: '',
          prompt: '',
          source: '',
          sessionId: null,
        })
      }

      const editTask = (task) => {
        setDetailId(null)
        setForm({ ...task })
      }

      const openChat = (task) => {
        if (workspace === undefined || workspace === null) {
          notify('会话服务还没就绪')
          return
        }
        try {
          if (task.sessionId) workspace.openSession(task.sessionId)
          else workspace.startSession(undefined, { prompt: buildPrompt(task), whenDraftExists: 'append' })
        } catch (reason) {
          notify(reason?.message ?? '打开会话失败')
          return
        }
        setDetailId(null)
        setOpen(false)
      }

      const onDragStart = (event) => {
        if (event.button !== 0) return
        dragRef.current = { dx: event.clientX - posRef.current.x, dy: event.clientY - posRef.current.y }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }

      const onDragMove = (event) => {
        if (dragRef.current === null) return
        const next = clampPosition({
          x: event.clientX - dragRef.current.dx,
          y: event.clientY - dragRef.current.dy,
        })
        posRef.current = next
        setPosition(next)
      }

      const onDragEnd = () => {
        if (dragRef.current === null) return
        dragRef.current = null
        savePosition(posRef.current)
      }

      const resetPosition = () => {
        const next = {
          x: Math.max(8, window.innerWidth - 300),
          y: Math.max(8, window.innerHeight - 560),
        }
        posRef.current = next
        setPosition(next)
        savePosition(next)
      }

      const toggleCollapsed = () => {
        setCollapsed((current) => {
          saveCollapsed(!current)
          return !current
        })
      }

      if (loading && plan === null) {
        return h('div', { className: 'calb-root', style: { left: `${position.x}px`, top: `${position.y}px` } },
          h('div', { className: 'calb-card calb-loading' }, '日历加载中…'))
      }

      return h(
        React.Fragment,
        null,
        h(MiniCalendar, {
          plan: plan ?? { tasks: [], goals: [], markers: [] },
          cursor,
          collapsed,
          position,
          onPrev: () => stepMonth(-1),
          onNext: () => stepMonth(1),
          onOpenDay: openDay,
          onOpenFull: openFull,
          onToggleCollapsed: toggleCollapsed,
          onDragStart,
          onDragMove,
          onDragEnd,
          onToggleGoal: toggleGoal,
          onResetPosition: resetPosition,
          onRefresh: load,
          hostOutdated,
        }),
        error !== '' ? h('div', { className: 'calb-toast calb-toast-error' }, error) : null,
        toast !== '' ? h('div', { className: 'calb-toast' }, toast) : null,
        open && plan !== null
          ? h(FullCalendar, {
              plan,
              view,
              cursor,
              selected,
              onView: setView,
              onCursor: setCursor,
              onSelect: setSelected,
              onClose: () => setOpen(false),
              onOpenTask: setDetailId,
              onNewTask: newTask,
              onToggleTask: toggleTask,
              onToggleGoal: toggleGoal,
              onAddGoal: openGoalForm,
              onRefresh: load,
              hostOutdated,
              mutate,
              notify,
            })
          : null,
        detailTask !== null
          ? h(TaskDetail, {
              task: detailTask,
              onClose: () => setDetailId(null),
              onToggle: () => toggleTask(detailTask),
              onEdit: () => editTask(detailTask),
              onRemove: () => requestRemove(detailTask),
              onChat: () => openChat(detailTask),
            })
          : null,
        form !== null
          ? h(TaskForm, {
              initial: form,
              onClose: () => setForm(null),
              onSave: saveTask,
            })
          : null,
        goalForm !== null
          ? h(GoalForm, {
              initial: goalForm,
              onClose: () => setGoalForm(null),
              onSave: saveGoal,
            })
          : null,
        confirmTask !== null
          ? h(ConfirmDialog, {
              title: '删除任务',
              message: `删除「${confirmTask.title}」？这会从 calendar/plan.json 里移除，不能撤销。`,
              onClose: () => setConfirmTask(null),
              onConfirm: performRemove,
            })
          : null,
      )
    }

    function CalendarGlyph({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 5, width: 18, height: 16, rx: 4, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', { d: 'M3 10h18M8 3v4M16 3v4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('circle', { cx: 9, cy: 15, r: 1.35, fill: '#e5484d' }),
        h('circle', { cx: 15, cy: 15, r: 1.35, fill: 'currentColor', opacity: 0.55 }),
      )
    }

    // ------------------------------------------------------------------ css

    const CSS = `
      .calb-root{position:fixed;z-index:60;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;line-height:1.45}
      .calb-card{pointer-events:auto;width:288px;border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.12));border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 14px 38px rgba(15,23,42,.16),0 2px 6px rgba(15,23,42,.06);overflow:hidden;user-select:none}
      .calb-card-head{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 6px 12px;cursor:grab;touch-action:none}
      .calb-card-head:active{cursor:grabbing}
      .calb-card-title{display:flex;align-items:center;gap:6px;font-weight:650;font-size:13px;letter-spacing:.01em}
      .calb-card-actions{display:flex;align-items:center;gap:2px}
      .calb-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#5c6370);font-size:17px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}
      .calb-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.07));color:var(--dsw-alias-label-primary,#1f2329)}
      .calb-dow{display:grid;grid-template-columns:repeat(7,1fr);padding:0 8px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:10px;text-align:center}
      .calb-mini-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;padding:3px 8px 6px}
      .calb-mini-day{position:relative;height:28px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center}
      .calb-mini-day:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.07))}
      .calb-mini-day.is-out{color:var(--dsw-alias-label-tertiary,#b0b4bb);opacity:.55}
      .calb-mini-day.is-today{box-shadow:inset 0 0 0 1.4px var(--dsw-alias-brand-primary,#4f7cff);color:var(--dsw-alias-brand-primary,#4f7cff);font-weight:700}
      .calb-mini-num{position:relative;z-index:1}
      .calb-mini-dots{position:absolute;left:50%;bottom:2px;transform:translateX(-50%);display:flex;align-items:center;gap:2px}
      .calb-mini-dot{width:4px;height:4px;border-radius:50%;background:#e5484d}
      .calb-mini-dot.is-marker{background:#e0a100}
      .calb-host-warning{margin:6px 10px 2px;border:1px solid rgba(217,119,6,.28);border-radius:7px;background:rgba(217,119,6,.09);color:#9a5b00;font-size:10px;line-height:1.45;padding:5px 7px}
      .calb-mini-goals{border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07));padding:7px 10px 4px;user-select:none}
      .calb-mini-goals-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px;font-weight:650;color:var(--dsw-alias-label-secondary,#5c6370);letter-spacing:.03em}
      .calb-mini-goals-count{font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-mini-goal{display:flex;align-items:center;gap:5px;padding:3px 0;min-width:0;cursor:pointer}
      .calb-mini-goal.is-done .calb-mini-goal-title{text-decoration:line-through;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-mini-check{width:13px;height:13px;margin:0;flex:none;accent-color:var(--dsw-alias-brand-primary,#4f7cff);cursor:pointer}
      .calb-mini-goal-dot{width:5px;height:5px;border-radius:50%;flex:none}
      .calb-mini-goal-title{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
      .calb-mini-goals-empty{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);padding:3px 0}
      .calb-mini-all{font-size:9px;margin-top:2px}
      .calb-card-foot{display:flex;align-items:center;justify-content:space-between;padding:7px 12px 9px;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07));color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:11px}
      .calb-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4f7cff);font:inherit;cursor:pointer;padding:0}
      .calb-link:hover{text-decoration:underline}
      .calb-pill{pointer-events:auto;position:relative;display:flex;align-items:center;gap:5px;height:38px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.12));border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 8px 22px rgba(15,23,42,.16);cursor:pointer;font:inherit;font-size:12px}
      .calb-pill-day{font-weight:700}
      .calb-pill-dot{width:6px;height:6px;border-radius:50%;background:#e5484d}
      .calb-loading{pointer-events:auto;padding:18px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px}
      .calb-backdrop{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(10,14,22,.42);backdrop-filter:blur(3px);pointer-events:auto}
      .calb-backdrop.is-embedded{position:relative;inset:auto;display:block;height:100%;padding:0;background:transparent;backdrop-filter:none}
      .calb-backdrop.is-embedded .calb-modal{width:100%;max-width:none;height:100%;max-height:none;border:0;border-radius:0;box-shadow:none}
      .calb-backdrop.is-embedded .calb-modal-body{min-height:0;min-width:0}
      .calb-backdrop.is-embedded .calb-main{min-width:0}
      .calb-backdrop.is-embedded .calb-close{display:none}
      .calb-page{height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff)}
      .calb-modal{display:flex;flex-direction:column;width:min(1080px,94vw);max-height:86vh;border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.12));border-radius:18px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 30px 90px rgba(10,14,22,.34);overflow:hidden}
      .calb-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07))}
      .calb-modal-eyebrow{font-size:10px;letter-spacing:.14em;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-bottom:3px}
      .calb-modal-title h2{margin:0;font-size:21px;font-weight:680;letter-spacing:-.01em}
      .calb-modal-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .calb-tabs{display:flex;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(31,35,41,.05));gap:1px}
      .calb-tab{border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#5c6370);font:inherit;font-size:12px;padding:4px 10px;cursor:pointer}
      .calb-tab.is-active{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 1px 3px rgba(15,23,42,.12);font-weight:600}
      .calb-close{font-size:20px;margin-left:2px}
      .calb-modal-body{display:grid;grid-template-columns:minmax(0,1fr) 302px;flex:1;min-height:0;overflow:hidden}
      .calb-main{overflow:auto;padding:14px 16px 20px;min-height:0}
      .calb-aside{overflow:auto;border-left:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07));padding:14px 14px 20px;background:var(--dsw-alias-bg-layer-2,rgba(248,249,251,.6))}
      .calb-history-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:center;padding:4px 0;font-size:11px;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.06))}
      .calb-history-action{color:var(--dsw-alias-brand-primary,#4f7cff);font-weight:600}
      .calb-history-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#5d6470)}
      .calb-history-time{color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums}
      .calb-month-dow,.calb-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
      .calb-month-dow{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:10px;text-align:center;padding-bottom:4px}
      .calb-month-grid{gap:5px}
      .calb-month-cell{min-width:0;min-height:88px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07));border-radius:9px;padding:5px;background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;transition:border-color .12s ease,background .12s ease}
      .calb-month-cell:hover{border-color:var(--dsw-alias-border-l4,rgba(31,35,41,.2));background:var(--dsw-alias-bg-layer-2,rgba(248,249,251,.7))}
      .calb-month-cell.is-out{opacity:.42}
      .calb-month-cell.is-today{border-color:var(--dsw-alias-brand-primary,#4f7cff)}
      .calb-month-cell.is-selected{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4f7cff)}
      .calb-month-cell-head{display:flex;align-items:center;gap:3px;margin-bottom:3px}
      .calb-month-num{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#5c6370)}
      .calb-marker-pin{width:5px;height:5px;border-radius:50%;background:#e0a100;flex:none}
      .calb-marker-label{font-size:8px;line-height:1.2;color:#9a6b00;background:rgba(224,161,0,.12);border-radius:3px;padding:1px 3px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .calb-cell-add{opacity:0;margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
      .calb-month-cell:hover .calb-cell-add{opacity:1}
      .calb-chips{display:flex;flex-direction:column;gap:3px;min-width:0}
      .calb-chip{display:flex;align-items:center;gap:3px;border:0;border-left:3px solid #8a8f98;border-radius:3px;background:var(--dsw-alias-bg-layer-2,rgba(31,35,41,.045));padding:2px 4px;text-align:left;cursor:pointer;font:inherit;min-width:0;width:100%}
      .calb-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.09))}
      .calb-chip.is-done{opacity:.55}
      .calb-chip.is-done .calb-chip-title{text-decoration:line-through}
      .calb-chip-project{width:4px;height:4px;border-radius:50%;flex:none}
      .calb-chip-title{font-size:10px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex:1;min-width:0}
      .calb-chip-time{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);flex:none}
      .calb-chip-more{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);padding-left:2px}
      .calb-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;min-height:420px}
      .calb-week-col{border:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07));border-radius:9px;padding:6px;background:var(--dsw-alias-bg-layer-1,#fff);min-width:0}
      .calb-week-col.is-today{border-color:var(--dsw-alias-brand-primary,#4f7cff)}
      .calb-week-head{display:flex;flex-direction:column;align-items:flex-start;border:0;background:transparent;padding:2px 2px 6px;cursor:pointer;font:inherit;color:inherit;width:100%}
      .calb-week-dow{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-week-num{font-size:12px;font-weight:650}
      .calb-week-marker{font-size:8px;line-height:1.2;color:#9a6b00;background:rgba(224,161,0,.12);border-radius:3px;padding:2px 3px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .calb-week-list{display:flex;flex-direction:column;gap:4px}
      .calb-week-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:0;border-left:3px solid #8a8f98;border-radius:4px;background:var(--dsw-alias-bg-layer-2,rgba(31,35,41,.045));padding:4px 5px;cursor:pointer;text-align:left;font:inherit;width:100%;min-width:0}
      .calb-week-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.09))}
      .calb-week-item.is-done{opacity:.55}
      .calb-week-item.is-done .calb-week-item-title{text-decoration:line-through}
      .calb-week-item-title{font-size:10px;line-height:1.3;max-width:100%;overflow:hidden;text-overflow:ellipsis}
      .calb-week-item-meta{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-week-add{margin-top:4px;border:1px dashed var(--dsw-alias-border-l2,rgba(31,35,41,.14));border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);font:inherit;font-size:10px;padding:3px;cursor:pointer;width:100%}
      .calb-week-add:hover{color:var(--dsw-alias-brand-primary,#4f7cff);border-color:var(--dsw-alias-brand-primary,#4f7cff)}
      .calb-day{width:100%;min-width:0}
      .calb-day-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:4px 0 12px}
      .calb-day-title{font-size:18px;font-weight:680}
      .calb-day-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-top:2px}
      .calb-day-markers{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:10px}
      .calb-marker-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(224,161,0,.28);border-radius:5px;background:rgba(224,161,0,.1);color:#8a6100;font-size:10px;padding:2px 6px}
      .calb-marker-chip.is-milestone{border-color:rgba(47,158,107,.28);background:rgba(47,158,107,.1);color:#257a53}
      .calb-marker-dot{width:5px;height:5px;border-radius:50%;background:#e0a100;flex:none}
      .calb-marker-chip.is-milestone .calb-marker-dot{background:#2f9e6b}
      .calb-day-groups{display:flex;flex-direction:column;gap:14px}
      .calb-day-group{border:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.08));border-radius:12px;padding:10px;background:var(--dsw-alias-bg-layer-2,rgba(31,35,41,.025));min-width:0}
      .calb-day-group-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary,#5c6370)}
      .calb-project-dot{width:7px;height:7px;border-radius:50%;flex:none}
      .calb-day-group-count{margin-left:auto;font-size:10px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-day-group-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-top:8px}
      .calb-day-card{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.08));border-left:3px solid #8a8f98;border-radius:9px;padding:8px 9px;background:var(--dsw-alias-bg-layer-1,#fff);min-width:0}
      .calb-day-card.is-done{opacity:.6}
      .calb-day-card.is-done .calb-day-card-title{text-decoration:line-through}
      .calb-day-card-main{flex:1;min-width:0;border:0;background:transparent;padding:0;text-align:left;font:inherit;color:inherit;cursor:pointer}
      .calb-day-card-top{display:flex;align-items:flex-start;gap:6px}
      .calb-day-card-title{font-size:12px;font-weight:600;line-height:1.35;min-width:0}
      .calb-time{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-left:auto;flex:none}
      .calb-day-card-outcome{font-size:10px;color:var(--dsw-alias-label-secondary,#5c6370);margin-top:3px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .calb-day-card-meta{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-top:4px}
      .calb-btn-ghost{height:24px;padding:0 7px;font-size:10px;flex:none}
      .calb-check{accent-color:var(--dsw-alias-brand-primary,#4f7cff);width:15px;height:15px;margin-top:2px;flex:none;cursor:pointer}
      .calb-empty{border:1px dashed var(--dsw-alias-border-l2,rgba(31,35,41,.16));border-radius:10px;padding:26px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px}
      .calb-empty .calb-link{margin-left:6px}
      .calb-panel{margin-bottom:16px}
      .calb-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
      .calb-panel-head h3{margin:0;font-size:11px;font-weight:650;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#5c6370)}
      .calb-panel-count{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(31,35,41,.09));overflow:hidden;margin-bottom:10px}
      .calb-progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#4f7cff,#2f9e6b);transition:width .2s ease}
      .calb-weekly-block{padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.06))}
      .calb-weekly-block:first-child{border-top:0;padding-top:0}
      .calb-weekly-head{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-bottom:4px}
      .calb-weekly-item{display:flex;align-items:center;gap:5px;border:0;background:transparent;padding:2px 0;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}
      .calb-weekly-item:hover .calb-weekly-title{color:var(--dsw-alias-brand-primary,#4f7cff)}
      .calb-weekly-item.is-done .calb-weekly-title{text-decoration:line-through;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-weekly-dot{width:5px;height:5px;border-radius:50%;flex:none}
      .calb-weekly-title{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .calb-weekly-more{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);padding:2px 0 0 10px}
      .calb-goal{display:flex;align-items:flex-start;gap:7px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.06))}
      .calb-goal:first-of-type{border-top:0}
      .calb-goal.is-done .calb-goal-title{text-decoration:line-through;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-goal-body{min-width:0}
      .calb-goal-title{font-size:11px;font-weight:600;line-height:1.35}
      .calb-goal-meta{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-top:1px}
      .calb-muted{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);padding:4px 0}
      .calb-aside-note{margin-top:14px;font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.5;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.06));padding-top:8px}
      .calb-aside-sub{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-bottom:8px}
      .calb-aside-project{padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.06))}
      .calb-aside-project:first-of-type{border-top:0;padding-top:0}
      .calb-aside-project-head{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:650;color:var(--dsw-alias-label-secondary,#5c6370);margin-bottom:2px}
      .calb-aside-project-count{margin-left:auto;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-aside-project-add{width:16px;height:16px;padding:0;border:0;background:transparent;font-size:14px;line-height:1;color:var(--dsw-alias-label-tertiary,#8a8f98)}
      .calb-aside-project-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.06));color:var(--dsw-alias-label-primary,#1f2329)}
      .calb-aside-add{margin-top:4px;font-size:10px}
      .calb-aside-markers{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
      .calb-weekly-time{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8f98);flex:none;margin-left:auto}
      .calb-badge-project{background:transparent;border:1px solid currentColor}
      .calb-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.14));border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px;cursor:pointer}
      .calb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.06))}
      .calb-btn-primary{background:#4f7cff !important;border-color:transparent;color:#fff !important;font-weight:600}
      .calb-btn-primary:hover{background:var(--dsw-alias-brand-primary,#3f6df0);filter:brightness(.96)}
      .calb-btn:disabled{opacity:.55;cursor:default}
      .calb-danger{color:#e5484d;border-color:rgba(229,72,77,.35)}
      .calb-danger:hover{background:rgba(229,72,77,.08)}
      .calb-detail-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(10,14,22,.34);pointer-events:auto}
      .calb-detail{width:min(520px,92vw);max-height:82vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.12));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 26px 70px rgba(10,14,22,.3);padding:16px 18px}
      .calb-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .calb-detail-kicker{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);margin-bottom:3px}
      .calb-detail-head h3{margin:0;font-size:18px;font-weight:680;line-height:1.3}
      .calb-detail-meta{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px}
      .calb-badge{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgba(31,35,41,.06));color:var(--dsw-alias-label-secondary,#5c6370);font-size:10px}
      .calb-badge.is-done{background:rgba(47,158,107,.12);color:#2f9e6b}
      .calb-detail-block{margin-top:12px}
      .calb-detail-block h4{margin:0 0 3px;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-weight:600}
      .calb-detail-block p{margin:0;font-size:12px;line-height:1.6;white-space:pre-wrap}
      .calb-detail-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07))}
      .calb-form{width:min(560px,92vw);max-height:88vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.12));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 26px 70px rgba(10,14,22,.3);padding:16px 18px}
      .calb-form-body{display:flex;flex-direction:column;gap:11px;margin-top:14px}
      .calb-field{display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);flex:1;min-width:0}
      .calb-field input,.calb-field textarea,.calb-field select{border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.14));border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px;padding:7px 8px;outline:none}
      .calb-field input:focus,.calb-field textarea:focus,.calb-field select:focus{border-color:var(--dsw-alias-brand-primary,#4f7cff);box-shadow:0 0 0 2px rgba(79,124,255,.14)}
      .calb-field textarea{resize:vertical;min-height:56px}
      .calb-field-row{display:flex;gap:8px}
      .calb-form-foot{display:flex;justify-content:flex-end;gap:7px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,41,.07))}
      .calb-form-hint{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.45}
      .calb-goal-form{width:min(520px,92vw)}
      .calb-confirm-backdrop{z-index:86}
      .calb-confirm{width:min(420px,92vw);border:1px solid var(--dsw-alias-border-l2,rgba(31,35,41,.12));border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 26px 70px rgba(10,14,22,.3);padding:18px 18px 14px}
      .calb-confirm-title{font-size:16px;font-weight:680;letter-spacing:-.01em}
      .calb-confirm-message{margin:8px 0 14px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#5c6370)}
      .calb-confirm-actions{display:flex;justify-content:flex-end;gap:7px}
      .calb-error{border-radius:6px;background:rgba(229,72,77,.1);color:#c62f34;font-size:11px;padding:6px 8px}
      .calb-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:95;border-radius:8px;background:rgba(24,28,36,.92);color:#fff;font-size:12px;padding:8px 14px;box-shadow:0 10px 30px rgba(10,14,22,.28);pointer-events:none;max-width:80vw}
      .calb-toast-error{background:rgba(198,47,52,.95)}
      @media (max-width:880px){
        .calb-modal-body{grid-template-columns:minmax(0,1fr)}
        .calb-aside{display:none}
        .calb-modal{width:96vw;max-height:92vh}
        .calb-month-cell{min-height:74px}
        .calb-week{min-height:320px}
        .calb-modal-head{flex-direction:column;align-items:stretch}
        .calb-modal-tools{justify-content:flex-start}
      }
    `

    // ---------------------------------------------------------------- apply

    function CalendarPage({ workspace }) {
      const { plan, capabilities, error, loading, load, mutate } = usePlan()
      const [view, setView] = useState('month')
      const [cursor, setCursor] = useState(() => todayKey())
      const [selected, setSelected] = useState(() => todayKey())
      const [detailId, setDetailId] = useState(null)
      const [form, setForm] = useState(null)
      const [goalForm, setGoalForm] = useState(null)
      const [confirmTask, setConfirmTask] = useState(null)
      const [toast, setToast] = useState('')
      const toastTimer = useRef(null)

      const notify = useCallback((message) => {
        setToast(message)
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(''), 3200)
      }, [])

      useEffect(() => () => {
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      }, [])

      const tasks = plan?.tasks ?? []
      const hostOutdated = plan !== null && (capabilities === null || capabilities.projects !== true)
      const detailTask = detailId === null ? null : tasks.find((task) => task.id === detailId) ?? null

      const guardedMutate = useCallback(async (method, body) => {
        if (hostOutdated) throw new Error('Host 还是旧版：请退出 DeepSeek Harness 再重新打开。')
        return mutate(method, body)
      }, [hostOutdated, mutate])

      const newTask = (date) => setForm({
        id: '', title: '', date, time: null, status: 'todo', line: '运营', project: 'half',
        priority: null, outcome: '', note: '', prompt: '', source: '', sessionId: null,
      })

      const openGoalForm = (projectId) => {
        const project = PROJECTS.some((item) => item.id === projectId) ? projectId : 'reading'
        setGoalForm({ id: '', title: '', metric: '', project, date: endOfMonth(cursor) })
      }

      const openChat = (task) => {
        if (!workspace) { notify('会话服务还没就绪'); return }
        try {
          if (task.sessionId) workspace.openSession(task.sessionId)
          else workspace.startSession(undefined, { prompt: buildPrompt(task), whenDraftExists: 'append' })
        } catch (reason) { notify(reason?.message ?? '打开会话失败') }
      }

      if (loading && plan === null) {
        return h('div', { className: 'calb-page' },
          h('div', { className: 'calb-card calb-loading', style: { margin: '48px auto', maxWidth: '420px' } }, '日历加载中…'))
      }
      if (error && plan === null) {
        return h('div', { className: 'calb-page' },
          h('div', { className: 'calb-card', style: { margin: '48px auto', maxWidth: '520px', padding: '18px' } },
            h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '日历没读出来'),
            h('div', { style: { color: 'var(--dsw-alias-label-secondary,#666)', fontSize: '12px', lineHeight: 1.6 } }, error),
            h('button', { type: 'button', className: 'calb-btn', style: { marginTop: '12px' }, onClick: load }, '重试')))
      }

      return h('div', { className: 'calb-page' },
        h(FullCalendar, {
          plan: plan ?? { tasks: [], goals: [], markers: [] },
          view, cursor, selected,
          onView: setView,
          onCursor: setCursor,
          onSelect: setSelected,
          onClose: () => {},
          onOpenTask: (task) => setDetailId(task.id),
          onNewTask: newTask,
          onToggleTask: async (task) => { try { await guardedMutate('toggle', { id: task.id, done: task.status !== 'done' }) } catch (reason) { notify(reason?.message ?? '更新失败') } },
          onToggleGoal: async (goal) => { try { await guardedMutate('goal-toggle', { id: goal.id, done: goal.status !== 'done' }) } catch (reason) { notify(reason?.message ?? '更新失败') } },
          onAddGoal: openGoalForm,
          onRefresh: load,
          hostOutdated,
          embedded: true,
        }),
        detailTask === null ? null : h(TaskDetail, {
          task: detailTask,
          onClose: () => setDetailId(null),
          onToggle: async (task) => { try { await guardedMutate('toggle', { id: task.id, done: task.status !== 'done' }) } catch (reason) { notify(reason?.message ?? '更新失败') } },
          onEdit: (task) => { setDetailId(null); setForm({ ...task }) },
          onRemove: (task) => setConfirmTask(task),
          onChat: openChat,
        }),
        form === null ? null : h(TaskForm, {
          initial: form,
          onClose: () => setForm(null),
          onSave: async (draft) => { await guardedMutate('upsert', { task: draft }); setForm(null); notify(draft.id ? '任务已更新' : '任务已添加') },
        }),
        goalForm === null ? null : h(GoalForm, {
          initial: goalForm,
          onClose: () => setGoalForm(null),
          onSave: async (draft) => { await guardedMutate('goal-upsert', { goal: draft }); setGoalForm(null); notify(`已添加到 ${projectLabel(draft.project)} 的本月产出`) },
        }),
        confirmTask === null ? null : h(ConfirmDialog, {
          title: '删除这个任务？',
          message: confirmTask.title,
          onClose: () => setConfirmTask(null),
          onConfirm: async () => { await guardedMutate('remove', { id: confirmTask.id }); setConfirmTask(null); setDetailId(null); notify('任务已删除') },
        }),
        toast === '' ? null : h('div', { className: 'calb-toast' }, toast))
    }

    function CalendarIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'data-dsh-calendar-entry': '1' },
        h('rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }),
        h('path', { d: 'M8 3v4M16 3v4M3 10h18' }),
        h('circle', { cx: 12, cy: 15, r: 1.4, fill: 'currentColor', stroke: 'none' }))
    }

    return {
      inject: ['slots', 'uiWorkspace', 'layout'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshCalendarBoard = 'styles'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-calendar-board: styles')

        ctx.slots.inject('main', () => {
          const handle = ctx.slots.register({
            name: 'main',
            key: 'calendar-board',
            inject: () => ({ workspace: ctx.uiWorkspace }),
          }, CalendarPage)
          window.setTimeout(() => {
            try { ctx.layout?.selectPanel?.('calendar-board') } catch {}
          }, 50)
          return handle
        })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'calendar-board',
          order: 10,
          label: () => '日历',
        }, CalendarIcon))
        ctx.effect(() => {
          let tries = 0
          const timer = window.setInterval(() => {
            tries += 1
            if (document.querySelector('.calb-page') !== null) {
              window.clearInterval(timer)
              return
            }
            const button = Array.from(document.querySelectorAll('button'))
              .find((item) => item.textContent.trim() === '日历' && item.closest('.calb-page') === null)
            if (button) {
              button.click()
              window.clearInterval(timer)
              return
            }
            if (tries >= 40) window.clearInterval(timer)
          }, 500)
          return () => window.clearInterval(timer)
        }, 'dsh-calendar-board: open panel')
      },
    }
  },
})

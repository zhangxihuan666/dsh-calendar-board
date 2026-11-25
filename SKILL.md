---
name: dsh-calendar-board
description: 在 DeepSeek Harness 主界面维护一张「项目日历」：迷你月历只标今天、节点用黄点；月/周/日视图按项目分组；任务可一键跳转到对应聊天；本月产出可勾选。当用户说“把这件事排进日历”“今天要做什么”“这个月要产出什么”“把任务标完成”“加一个节点/节日”，或需要读取/修改 `calendar/plan.json` 时使用。
---

# DSH Calendar Board

一张跟着项目仓库走的日历。数据是普通 JSON，Agent、Git、任何 AI 工具都能读；DSH 里只是多了一个可视化的壳。

## 何时使用

- 用户要**排期**：把一篇文章、一次发布、一个交付、一次复盘放到某天/某周。
- 用户要**看今天/本周/本月**：先读 `plan.json`，再按项目汇总，不要凭记忆回答。
- 用户要**勾完成**：改 `status: "done"`，不要删除任务。
- 用户要**加节点**：节日、上线日、截止日、评审日，写进 `markers`，不要伪装成任务。
- 用户要**月度盘点**：按 `project` 分组统计 `goals` 和 `tasks`，指出“计划了但没排时间”的项。

## 数据在哪

默认：

```text
~/Desktop/calendar/plan.json
```

可用环境变量 `DSH_CALENDAR_FILE` 或插件配置 `dataFile` 覆盖。

如果项目仓库里已经有一份日历，推荐用符号链接，让 Git 继续做单一事实源：

```bash
mkdir -p ~/Desktop/calendar
ln -sf "/path/to/project/calendar/plan.json" ~/Desktop/calendar/plan.json
```

## 数据模型

```json
{
  "version": 1,
  "rev": 10,
  "updatedAt": "2026-11-25T13:00:00.000Z",
  "goals": [
    {
      "id": "g-launch",
      "title": "12 月 1 日首批 20 单可下单",
      "date": "2026-11-30",
      "metric": "20 单",
      "project": "half",
      "status": "todo",
      "note": "",
      "createdAt": "2026-11-25T12:00:00.000Z",
      "completedAt": null
    }
  ],
  "tasks": [
    {
      "id": "t-20261125-2000",
      "title": "发首篇笔记",
      "date": "2026-11-25",
      "time": "20:00",
      "status": "todo",
      "line": "A",
      "project": "half",
      "priority": "P0",
      "outcome": "发布并记录 2 小时数据",
      "note": "",
      "prompt": "",
      "source": "outputs/46-排期.md",
      "sessionId": null,
      "createdAt": "2026-11-25T12:00:00.000Z",
      "updatedAt": "2026-11-25T12:00:00.000Z",
      "completedAt": null
    }
  ],
  "markers": [
    {
      "id": "m-launch",
      "date": "2026-12-01",
      "label": "上线",
      "type": "milestone",
      "note": ""
    }
  ]
}
```

固定枚举：

| 字段 | 可选值 |
|---|---|
| `project` | `half` / `reading` / `ftc` / `x` / `local` / `other` |
| `line` | `A` / `B` / `C` / `D` / `运营` / `其他` |
| `priority` | `P0` / `P1` / `null` |
| `status` | `todo` / `done` |
| `markers[].type` | `festival`（黄点）/ `milestone`（绿点） |

约束：

- `date` 必须是 `YYYY-MM-DD`；`time` 是 `HH:MM` 或 `null`。
- `goals[].date` 为 `null` 时不会出现在「本月产出」；建议填当月最后一天。
- 不要改已有任务的 `id`；新增用 `t-YYYYMMDD-HHMM-随机`。
- 每次写入把 `rev` 加 1，并更新 `updatedAt`。
- 保留未知字段（例如未来版本加的字段），不要整包重写成只有已知字段。

## 三条工作流

### 1. 排一个任务

1. 先读 `plan.json`，确认同一天没有重复任务。
2. 追加一条 task：写清 `title`、`date`、`time`、`project`、`outcome`。
3. `outcome` 是“做完后能看见什么”，不是动作。例：
   - 差：`写小红书`
   - 好：`发布第 4 篇，评论 ≥20 条`
4. 如果这件事需要 AI 接着做，把上下文写进 `prompt`；不要只写“帮我做”。
5. 原子写：写 `plan.json.tmp`，再 `rename`。不要边写边让 UI 轮询读到半截 JSON。

### 2. 完成 / 撤销

- 完成：`status: "done"`，`completedAt` 写当前 ISO 时间。
- 撤销：`status: "todo"`，`completedAt: null`。
- 不要删除任务来“划掉”；删除只用于误建。

### 3. 月度盘点

按 `project` 分组，输出：

```text
项目 | 本月目标 | 已完成 | 本月任务 | 已完成 | 没有排时间的任务
```

然后只给三条判断：

1. 哪个项目“目标多、任务少”；
2. 哪个项目“任务多、没有产出定义”；
3. 本周最该砍掉的一件事。

不要写鼓励话，不要复述背景。

## 和 UI 的对应关系

- 迷你月历：只有**今天**一个红点；`markers` 日期显示黄点（节日）/绿点（节点）。
- 「本月要产出」：本月 `goals` 前三条，可直接勾选；「看全部」打开大日历。
- 大日历：月 / 周 / 日三视图；任务 chip 左边框是项目色；右侧「本月产出」按项目分组。
- 日视图：按项目分组，每组内部是自适应网格；任务卡有勾选框、打开聊天、查看。
- 打开聊天：用任务的 `title / project / date / outcome / note / source` 生成 prompt，交给 `ctx.uiWorkspace.startSession`；已有 `sessionId` 则直接 `openSession`。
- 完成：任务变灰、标题加删除线。

## HTTP API（给宿主/调试用）

只接受同源 POST，浏览器会自动带 DSH 的 auth cookie；**不要用 curl 直接测**，会 403。

| 路径 | body | 说明 |
|---|---|---|
| `/calendar/api/load` | `{}` | 读整份 plan |
| `/calendar/api/upsert` | `{ task }` | 新增或按 id 覆盖任务 |
| `/calendar/api/remove` | `{ id }` | 删除任务 |
| `/calendar/api/toggle` | `{ id, done }` | 完成 / 撤销 |
| `/calendar/api/goal-toggle` | `{ id, done }` | 目标完成 / 撤销 |
| `/calendar/api/goal-upsert` | `{ goal }` | 新增或覆盖目标 |

统一返回：

```json
{ "ok": true, "result": { "plan": {} } }
```

或：

```json
{ "ok": false, "error": { "code": "invalid-input", "message": "..." } }
```

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 黄点/项目颜色消失 | Host 还是旧版，`normalizePlan` 把 `markers/project` 剥了 | 重启 DSH，让 Host 重新加载；不要在旧 Host 下批量勾任务 |
| 迷你卡挡住输入框 | 旧位置缓存在 localStorage | 点 `⌖` 复位，或清 `dsh-calendar-board:pos:v4` |
| 页面 403 | 没有浏览器 auth cookie | 在 DSH 窗口内操作；不要放宽 `requestRejection` |
| 任务不出现 | `date` 格式错 / `status` 不是 `todo|done` / JSON 坏了 | 先 `node -e "JSON.parse(...)"` 校验 |
| 两个 agent 同时写 | 一个读旧 `rev` 后整包覆盖 | 只做逐条 upsert；大改前先备份 `plan.json` |

## 交付前自检

```bash
node --check index.js
node --check client.js
node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/Desktop/calendar/plan.json','utf8')); console.log('json ok')"
```

再确认：今天只有一个红点；有 `markers` 的日期有黄/绿点；点任务能打开详情；「打开聊天」能落到输入框。

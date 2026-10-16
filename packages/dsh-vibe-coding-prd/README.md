# dsh-vibe-coding-prd

**把一个说不清需求的人，通过一问一答，带到一份 AI 能直接照着开工的 PRD。**

这是 [dsh-vibe-coding-prd](https://github.com/OWNER/dsh-vibe-coding-prd) 仓库里的 DSH 插件包，
也可以单独安装使用。它把"一问一答理需求"做成可执行的流程工具：模型负责像产品顾问一样问话，
插件负责按门推进、账本留痕、把答案变成文件。**该强制的地方写进代码，而不是写在提示词里靠模型自觉。**

**零运行时依赖。** 本包不 import 任何 `@deepseek-ai/*`：宿主从安装位置解析这些包，
工作区里的插件解析不到，导入会让整个插件激活失败。

## 安装

```powershell
# 从 npm
dsh plugin --profile desktop add dsh-vibe-coding-prd

# 从 GitHub 子目录
dsh plugin --profile desktop add github:<用户名>/dsh-vibe-coding-prd#path:packages/dsh-vibe-coding-prd

# 从本机路径（开发时）
# 让 Harness 会话里的 agent 执行：
# plugin_manager action=install_bundle target=<本包绝对路径>
```

装完**重启 Harness 宿主**：模块代次缓存在进程里，热切换不会加载新的 `index.js`。
确认生效的办法：对 agent 说"我们走到哪了"，能调用 `interview_status` 就是成了。

## 怎么用

对 agent 说一句"我想做个 XX，但不知道怎么跟 AI 说"就够了：

```
interview_start      读账本（或新建）并报"当前走到哪一步"
interview_next       取当前这一问的完整提问稿（问题、选项、退出条件、还缺什么）
（模型把问题发给你 —— 选项会渲染成可点按钮）
interview_advance    记答案并过门；缺东西就返回 gaps，流程停在本步
… 重复 10 步 …
interview_finalize   出口门自检 + 落盘 prd.md / 项目说明书.md
```

同时注册了一个名为 `vibe-coding-interview` 的技能，任何会话都能发现这套访谈行为规范。

## 七个工具

| 工具 | 作用 | 关键返回 |
|------|------|---------|
| `interview_start` | 开场 / 续接：读账本恢复进度，不存在就初始化到 S1.0；项目目录不确定或账本属于别处时拒绝执行 | `resumed`、`step`、`mode`、`project`、`missingRequired` |
| `interview_next` | 取当前这一问：提问稿、给用户的选项、退出条件、已收字段、分步提交计划 | `ask`、`fields`、`options`、`exitCondition`、`submissionPlan` |
| `interview_advance` | 记答案并判断退出条件；**一次只交 1-3 个字段**，每批立即落盘 | `advanced`、`gaps`、`stillMissing`、`oversized`、`next` |
| `interview_skip` | 跳过可选步骤并留痕；必经步骤一律拒绝 | `skipped`、`reason` |
| `interview_finalize` | 出口门自检 + 落盘两份（或三份）文档；`terms` 可加英文自检白名单 | `written`、`checks`、`blocking`、`files` |
| `interview_status` | 只读查看进度、跳步留痕、阻塞项、目录归属异常 | 全量步骤状态 |
| `interview_ask` | 直接把当前这一问弹给用户并等回答 | `answer` |

七个工具的 `parameters` 都是标准 JSON Schema，返回值都是 JSON，`output.render` 给出一行中文摘要。

## 分步提交：为什么一次只交 1-3 个字段（v0.2）

工具参数是流式拼出来的，**参数越长、嵌套越深，越容易在拼装环节产出非法 JSON**：
harness 判定 `MALFORMED_RESPONSE` 后会中止整轮，已经做完的步骤全部作废
（真实案例：一轮 45 步 + 89 次工具调用，废在最后一个 11 条中文长句的深嵌套参数上）。

所以 `interview_advance` 把"分批交"做成了正经用法，而不是提醒：

- `interview_next` 返回 `submissionPlan`，按 `≤ 3 个字段、≤ 1200 字符` 把这一步还没交的字段切成小批；
- `interview_advance` 每收到一批**立即落盘**，返回 `saved`、`submitted`、`collected`、`stillMissing`；
  退出条件没满足也不会回退，下一批接着交就行；
- 一次交多了不拒收（答案绝不丢），但会带 `oversized` 警告与"下一步怎么拆"的说明；
- 重试友好：就算某次调用在拼装阶段就失败，上一批的进度已经在 `docs/` 里了。

## 工作目录：账本属于哪个项目（v0.2）

账本是状态来源，所以"账本属于哪个项目"必须说清楚，否则会拿 A 项目的进度续 B 项目。

- 项目目录只来自两处：显式 `workspace`（绝对路径）或**会话工作目录**（`exec.agent.session.header.cwd`）。
  两者都没有时**拒绝执行**——不再回落到宿主进程的当前目录（那可能是 profile 目录，里面躺着别的项目的账本）。
- 账本头部与状态文件都记 `工作目录`。加载时比对，不一致就**不续接、不写文件**，
  只报告"发现历史账本在别处"，并给出两条路：`interview_start adoptWorkspace: true`（目录确实搬了家）
  或换对的 `workspace` / `reset: true`（确认是另一个项目）。
- 续接成功会返回 `project.name` 与 `confirm`，要求先跟用户对一下项目名再往下走。

## 十步门禁

S1.0 破冰 → S1.1 分诊定深度 → S1.2 资源现实盘点 → S1.3 ★ 定形态 → S1.4 补全需求 →
S1.5 信息架构（可选）→ S1.6 边界与禁区 → S1.7 验收 + MVP → S1.8 技术栈雏形（可选）→ S1.9 落盘。

- **必经 8 步，可选 2 步。** 可选步骤只能通过 `interview_skip` 跳过，理由必须 ≥ 4 个字并写进账本「跳步留痕」。
- **轻重两种模式。** S1.1 分诊后，轻模式按固定分组"几步一起问、一次报门"
  （S1.0+1.1+1.2 / S1.3+1.4+1.6 / S1.7+1.9）；**出口门无论轻重都不打折**。
- **停在本步是正常行为。** `interview_advance` 返回 `advanced: false` 时，
  模型必须补问 `gaps` 里的缺口，不允许绕过工具自己往下走。

## 产出文件

| 文件 | 说明 |
|------|------|
| `docs/进度账本.md` | 流程唯一状态来源，插件自动维护。人可读，含每步状态与跳步留痕 |
| `docs/.vibe-coding-prd-state.json` | 状态旁挂文件：账本给人看，这份给机器读 |
| `docs/prd.md` | 产品结论、目标用户、形态与资源约束、信息架构、边界情况、验收标准、MVP、以后再说 |
| `docs/项目说明书.md` | 一句话、四要素需求基准描述、选定技术栈、验收清单、决策复盘案例库入口 |
| `docs/开发文档.md` | 可选（`includeDevDoc: true`），进入正式开发时用 |

默认写在**会话的工作目录**下；要写到别处就传 `workspace` 绝对路径。
`docs/进度账本.md` 的头部会记下这个工作目录，换目录续接时会先拦一道（见上）。

## 出口门（不过就不写文件）

`interview_finalize` 逐条返回 `pass/fail`，只要有一条 error 未过就**一个文件都不写**：

1. 必经步骤全部 ✅、跳过的可选步骤有留痕
2. PRD 元信息（文档状态 / 版本 / 产品名称）已填
3. 核心定位是一句完整的话（≥ 10 字）
4. 明确不做 ≥ 1 条
5. 「它活在哪」已选定
6. 验收标准 ≥ 1 条且具体可验证（"系统正常""体验良好"这类空话会被直接拒绝）
7. MVP 完成定义 ≥ 1 条
8. 需求基准描述覆盖场景 / 目标 / 约束 / 验收
9. 无占位符 / TODO / TBD / `___` 残留（URL、路由、行内代码里的 `<id>` 不算占位）
10. 无英文正文（术语、代码、URL、品牌名除外）
11. 无密钥、密码、token 等敏感信息

第 9、10 两条 v0.2 起收窄了判定，不再误伤正当写法；真被误判时把品牌名 / 术语放进
`interview_finalize` 的 `terms`（会累积进状态文件），不要为了过门去改产品名。

## 自测

```bash
node test/engine.test.mjs   # 引擎层：门控、校验门、账本往返、出口门、文档结构、形状与自检（36 项）
node test/tools.test.mjs    # 工具层：注册表契约、完整访谈流程、目录守卫、分步提交（28 项）
```

工具层测试用一个假 ctx 收集注册的工具，照真实调用顺序把整场访谈点一遍，
覆盖三条硬约束：退出条件不满足必须停在本步、必填步骤不能跳、出口门没过不许写文件。
v0.2 起还覆盖目录守卫（没有可信目录 / 账本属于别处时拒绝执行）与分步提交（分批交、每批落盘）。
不需要起 Harness。

## 设计取舍

- **零依赖是刻意的。** 见文首说明。代价是工具定义要手写原生 JSON Schema。
- **工具是"给模型看的"。** 插件不自己弹窗打断对话，而是把提问稿交给模型，由模型决定怎么说——
  这才是"像产品顾问一样访谈"，而不是"填问卷"。
- **账本与状态分离。** 账本可读、可贴回对话；状态文件保真。账本丢了流程能重建，答案丢了就得重问。
- **校验规则只有一份。** v0.1 在引擎层与工具层各写了一份，两处会走偏（形状问题就是这么漏过去的）；
  v0.2 起工具层直接调 `engine.validateAnswer`。
- **宁可不干活，也不串项目。** 项目目录不可信时一律拒绝执行，把选择交回用户，而不是替用户猜一个目录。
- **摘要渲染永不抛错。** `output.render` 可能在回放旧日志时拿到结构不完整的值，
  统一走兜底，避免把 UI 槽位打崩。
- **技能注册失败不影响工具可用。** 技能文件读不到就跳过注册。

## 许可

[MIT](https://github.com/OWNER/dsh-vibe-coding-prd/blob/main/LICENSE)

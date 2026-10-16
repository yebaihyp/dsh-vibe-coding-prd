# 变更记录

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-16

按《会话中断分析报告》（2026-10-15，会话 `session-d6932cb0`）的插件侧建议做的一轮修复。
报告里 P2（跨会话 shell 收尾输出串台）与 P4（会话日志多帧 zstd）属于 harness 侧，不在本插件范围。

### 新增

- **分步提交入口**（报告 2.8-B，本期主线）：工具参数是流式拼出来的，参数越长、嵌套越深，
  越容易在拼装环节产出非法 JSON，harness 判定 `MALFORMED_RESPONSE` 后中止整轮
  （报告里的案例：一轮 45 步全废在第 1179 字符之后多出的 35 字符尾巴上）。插件侧的对策：
  - `interview_next` 返回 `submissionPlan`：把当前步骤还没交的字段切成小批
    （每批 ≤ 3 个字段、估算 ≤ 1200 字符），并给出 `stillMissing`；
  - `interview_advance` 每收到一批**立即落盘**，返回 `saved` / `submitted` / `collected` / `stillMissing`；
    未过门时直接告诉你"下一次只交这批"，不再是笼统的缺口清单；
  - 单次提交超过上限不拒收（答案绝不丢），但返回 `oversized` 与一条 warning，说明下一步怎么拆；
  - 工具描述里写明硬要求：一次 1-3 个字段、≤ 1200 字符。
- `interview_finalize` 新增 `terms` 参数：英文自检的白名单（项目名 / 品牌名 / 术语），累积进状态文件。
- 账本与状态文件记录**工作目录**（`state.workspace`、账本头部"工作目录"一行），状态文件格式版本升到 2。

### 修复

- **账本跨项目误续**（报告 P3）：`interview_start` 未显式指定 `workspace` 时会回落到
  `process.cwd()`，而宿主进程的当前目录可能是 profile 目录——那里躺着别的项目的账本，
  于是开场误报"某项目已完成 10/10"。现在：
  - 项目目录只来自显式 `workspace` 或会话工作目录（`exec.agent.session.header.cwd`，与内置 bash 工具同一取法）；
  - 两者都拿不到就**拒绝执行**，一个文件都不写，并说明为什么不回落到进程当前目录；
  - 账本记录的工作目录与本次不一致时**不续接、不写文件**，只报告"发现历史账本在别处"，
    并给出两条路：`adoptWorkspace: true`（目录确实搬了家）或换对的 `workspace` / `reset: true`；
  - 续接成功时返回 `project.name` 与 `confirm`，要求先跟用户确认项目名；
  - v0.1 的旧状态文件没有工作目录，加载时补记并在返回值里用 `workspaceAdopted` 标出来。
- **渲染器与字段形状不一致**（报告 P5）：`itemShape: ['item']` 的数组元素被当字符串用，
  文档里出现 `[object Object]`，`{"item":"…"}` 还会撞上占位符自检导致落盘被拦。现在：
  - 新增 `itemText()` / `normalizeValues()`：`"…"`、`{item:"…"}` 两种形状都认，
    写入状态之前统一归一化成字符串；
  - 两段式字段（`infoArch` 的 entry/destination、`dataJourney` 的 gap/handling）额外接受
    `"首页 → 结果页"` 这种一行写法，渲染与校验都按对象读；
  - 所有渲染器（prd / 项目说明书 / 开发文档）与校验器统一走这两个函数，不再直接 `String(item)` 或 `JSON.stringify(item)`。
- **自检误伤正当写法**（报告 P6）：
  - 占位符检查改为逐行判定（`scanPlaceholders`）：URL、路由、行内代码里的 `<id>` / `<标签>` 放行；
    花括号里带引号或"纯 ASCII + 冒号"的按 JSON / 代码片段处理；`{{…}}`、TODO/TBD、`___` 照旧拦；
  - 英文正文检查收窄（`scanEnglish`）：围栏代码块、行内代码、URL、含中文的行、
    去掉空白不足 40 字的短行都不判——三段式英文品牌名（"Land of Knowledge"）不再让文档标题自己过不了门；
    可用 `terms` 白名单进一步豁免。
- **校验规则两份走偏**：工具层原先另抄了一份字段校验，与引擎层规则不一致（P5 的形状问题正是这么漏过去的）；
  现在工具层直接调 `engine.validateAnswer`，重复代码删除。
- **账本往返丢备注**：`parseLedger()` 不读「阶段进度」的备注列，仅凭账本恢复（状态旁挂文件丢了）时
  这一格会被默认值盖掉；已读回。本仓库 `docs/进度账本.md` 这份真实产物现在能做到 parse → render 完全一致。
- S1.8「选定 / 否决」的判定统一为引擎层版本（`选定|选它|选择`、`否决|排除|放弃|不选`）。

### 变更

- 工具返回值新增 `ok` / `refused` / `reason` 字段，拒绝类结果与正常结果可以一眼区分；
  `output.render` 的摘要对拒绝类结果单独给一行。
- `interview_start` / `interview_advance` / `interview_skip` / `interview_finalize` / `interview_status` / `interview_next`
  全部走同一套目录解析与归属校验。

### 自测

- 引擎层 22 → **36 项**（新增形状归一化、占位符与英文自检边界、分批计划、体积测量、账本工作目录与备注往返）；
- 工具层 19 → **28 项**（新增目录守卫三例、分批提交三例、形状与 `terms` 白名单的端到端两例）。

## [0.1.0] - 2026-10-09

首个可用版本：访谈式需求梳理的 DSH 插件，一问一答产出可开工的 PRD。

### 新增

- **七个访谈工具**（Host 半边，零依赖）：
  `interview_start`、`interview_next`、`interview_advance`、`interview_skip`、
  `interview_finalize`、`interview_status`、`interview_ask`。
- **十步门控状态机**：S1.0 破冰 → S1.1 分诊 → S1.2 资源盘点 → S1.3 定形态 →
  S1.4 补全需求 → S1.5 信息架构（可选）→ S1.6 边界禁区 → S1.7 验收+MVP →
  S1.8 技术栈雏形（可选）→ S1.9 落盘。8 步必经、2 步可选。
- **退出条件强制**：`interview_advance` 在条件不满足时返回 `advanced: false` 与缺口清单，
  流程停在本步；必经步骤调用 `interview_skip` 一律被拒绝。
- **跳步留痕**：可选步骤的跳过理由（≥ 4 字）自动写入 `docs/进度账本.md` 的「跳步留痕」。
- **轻 / 重双模式**：S1.1 分诊后，轻模式按三组"几步一起问、一次报门"（S1.0+1.1+1.2 /
  S1.3+1.4+1.6 / S1.7+1.9）；出口门无论轻重都不打折。
- **答案质量门**：空话黑名单（"系统正常""体验良好"等）与可观察性检查；
  S1.8 必须同时写明"选定"与"否决"。
- **出口门自检**：11 条机器校验，任一条 error 未过就不写任何文件。
- **文档渲染**：`docs/prd.md`、`docs/项目说明书.md`，可选 `docs/开发文档.md`；
  按固定结构渲染，含四要素需求基准描述与两个保留章节入口，无占位符残留。
- **跨会话续接**：账本（人读）+ 状态旁挂文件（机器读），`interview_start` 一次调用恢复进度。
- **技能注册**：随插件注册 `vibe-coding-interview` 技能，任何会话都能发现访谈行为规范。
- **自测**：引擎层 22 项、工具层 19 项，裸 Node 可跑（`npm test`）。

### 已知限制

- 不负责 S2 架构选型与 S3 上线准备，只做 S1 需求对齐；出口门通过后由用户决定是否继续。
- 账本与状态文件写在会话工作目录下；跨机器协作需要把整个项目目录一起带走。
- 未提供可视化界面，全部交互通过对话与工具完成。

### 修复（开发期）

- 账本原先只记录流程进度、不保存访谈答案，导致换目录后答案丢失；
  改为账本 + `docs/.vibe-coding-prd-state.json` 双写。
- 空话验收标准的检查顺序有误，短句会先命中"太短"分支而漏掉空话判定。
- 工具定义原先导入 `@deepseek-ai/dsh-tools`，工作区路径解析不到会导致整个插件激活失败；
  改为手写原生 JSON Schema、零依赖。
- `output.schema` 原先写作 DSH DSL 的 `type: 'json'`，注册表只认标准 JSON Schema 类型名；
  改为空 schema `{}`，并补上对象节点的 `additionalProperties`。

### 整理

- 仓库收敛为单一插件项目：移除 Codex Skill 形态的脚手架
  （`SKILL.md`、`AGENTS.md`、`CLAUDE.md`、`harness.json`、`examples/`、`references/`），
  只保留 `packages/dsh-vibe-coding-prd`。原先散落在这些文件里的写作规范与维护约定，
  已并入 `CONTRIBUTING.md` 与插件自己的 README。
- 移除文档里与第三方插件分发平台有关的内容（上架指引、推广清单、相关故障归因）；
  故障排查改为只描述 DSH 自身的机制：补丁层的停用行与 profile 的 bundles 列表。
- 产物结构改由 `engine.js` 固定渲染，不再声明"对齐 templates 目录"。
- `docs/` 保留为跑完十步的真实产物示例。

[0.1.0]: https://github.com/OWNER/dsh-vibe-coding-prd/releases/tag/v0.1.0
[0.2.0]: https://github.com/OWNER/dsh-vibe-coding-prd/releases/tag/v0.2

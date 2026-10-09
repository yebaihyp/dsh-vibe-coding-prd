# 变更记录

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

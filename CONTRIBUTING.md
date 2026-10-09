# 贡献与维护说明

> 这份文件写给一年后回来改代码的人，也包括你自己。

## 维护成本优先

本项目的最高原则是**复杂度是负债，不是资产**。提 PR 前先问一句：这个改动一年后还修得动吗？

具体到本仓库：

- **不引入运行时依赖。** 插件本体零依赖是刻意的设计（原因见下方"为什么零依赖"），
  任何新增依赖的 PR 都需要在这份文件里补一段理由。
- **不引入构建步骤。** 源码即产物，`node index.js` 能被宿主直接 import。
  没有 TypeScript 编译、没有打包器，改了就能生效。
- **不为了"更工程化"重构。** 引擎是纯函数集合，工具层是薄封装，这个形状够用。

## 为什么零依赖

DSH 宿主从**安装位置**解析 `@deepseek-ai/*` 包，而工作区里的插件解析不到它们。
导入 `@deepseek-ai/dsh-tools` 拿 `defineTool` 会让插件在整个 profile 里激活失败
（症状：`failed to import`）。所以工具定义手写原生 JSON Schema。

两个必须遵守的 schema 约束（违反会直接激活失败）：

1. `parameters` 与 `output.schema` 只能用标准 JSON Schema 类型名
   （`object`/`array`/`string`/`number`/`integer`/`boolean`/`null`）。
   DSH 的 DSL 里那个 `type: 'json'` 是作者侧写法，注册表不认；要"任意值"就用 `{}`。
2. 每个 `type: 'object'` 节点必须显式写 `additionalProperties`（布尔值）。

`test/tools.test.mjs` 里有一项自检会模拟这两条规则，改 schema 时它会兜住。

## 本地开发流程

```powershell
# 1. 跑自测（不需要装任何依赖）
node packages/dsh-vibe-coding-prd/test/engine.test.mjs
node packages/dsh-vibe-coding-prd/test/tools.test.mjs

# 2. 装进当前 profile（本机路径安装）
#    在 Harness 会话里让 agent 执行：
#    plugin_manager action=install_bundle target=<本仓库 packages/dsh-vibe-coding-prd 绝对路径>

# 3. 改了代码要重启宿主才生效
#    DSH 的模块代次缓存在进程里，热切换不会加载新的 index.js
```

## 插件"突然消失"时怎么查

开发期最烦的一种现象：昨天工具还在，今天工具目录里一个都没有。**九成是插件被停用了，不是代码坏了。**
按这个顺序查，不要一上来就改代码：

1. **看补丁层有没有停用行**：`$env:DSH_PROFILE_DIR\cordis.patch.yml` 里若出现
   `- id: vibe-coding-prd` + `disabled: true`，插件就是被停用的。任何对 profile
   做改写的操作都可能留下这类行——它们是持久化的，重启也不会自己消失。
2. **看 bundles 列表**：profile `package.json` 的 `dsh.profile.bundles` 里少了
   `dsh-vibe-coding-prd`，同样说明它没被挂载。
3. **重新启用**：`plugin_manager action=set_bundle target=dsh-vibe-coding-prd enabled=true`。
   若补丁层里的停用行还在，删掉它（**先备份该文件**，只删指向本插件的那两行）。
4. **确认代码本身没坏**：在 profile 目录下直接跑一次导入，能拿到 7 个工具名就说明插件是好的：

```powershell
node -e "import('dsh-vibe-coding-prd').then(m=>{const t=[];m.apply({tools:{register(d){t.push(d.name);return()=>{}}},userQuestions:{},skills:{register(){return()=>{}}}});console.log(t.length, t.join(', '))})"
```

排查时注意一点：`application: applied` 只表示组合应用成功，**不代表进行中的会话能立刻用上新工具**。
当前会话的工具清单在开场时就固定了，中途启用的工具要等下一次会话才出现在工具目录里。

## 测试怎么写

现有两层测试，新增功能请落在对应层：

| 层 | 文件 | 覆盖什么 |
|----|------|---------|
| 引擎层 | `test/engine.test.mjs` | 纯逻辑：节点门控、字段校验、账本解析往返、出口门判定、文档渲染结构 |
| 工具层 | `test/tools.test.mjs` | 注册表契约、七个工具的真实调用顺序、状态续接、提问通道透传 |

工具层测试用一个假 ctx（`{ tools, userQuestions, skills }`）收集注册结果，
所以**不需要真的起一个 Harness** 就能跑完整场访谈。新增工具时记得补注册表契约自检的覆盖。

## 改访谈流程时要动的地方

流程定义集中在 `packages/dsh-vibe-coding-prd/engine.js` 的 `NODES` 数组：

- 加/删/改步骤 → 改 `NODES`；同步检查 `LIGHT_GROUPS`（轻模式合并分组）是否还对得上。
- 改某一步的字段 → 改该节点的 `fields`；字段名要与 `interview_advance` 的 `values` 键一致。
- 改出口门 → 改 `exitGateChecks()`；同时更新 `packages/dsh-vibe-coding-prd/skills/vibe-coding-interview.md`
  和 README 里的出口门清单，三处必须一致。
- 改文档结构 → 改 `renderPrd()` / `renderSpec()` / `renderDevDoc()`；
  它们决定了产物长什么样，改完记得同步 README 里的产出文件表。

## 提交规范

- 正文与代码注释用简体中文，变量名/函数名用英文（见名知意）。
- 文件编码 UTF-8 无 BOM、行尾 LF（`.editorconfig` 与 `.gitattributes` 已强制）。
- 提交信息用一句话说清"改了什么、为什么"，不要写"update"。例：
  `修复：账本不保存答案，换目录后访谈状态丢失`
- 涉及行为变更的，同步更新 `CHANGELOG.md`。

## 安全与隐私

- 访谈产物可能含个人或商业信息，**不要**把真实项目的 `docs/` 提交到本仓库。
- 插件会把用户答案原样写进 `docs/` 下的文件，所以 `interview_advance` 的工具描述里
  明确提醒模型不要把密钥、密码、token 写进去。改这条描述时不要削弱这个提醒。
- 报 bug 时请附最小复现步骤，不要贴真实项目内容。

## 发布检查清单

发版前逐条确认：

- [ ] `node packages/dsh-vibe-coding-prd/test/engine.test.mjs` 全绿
- [ ] `node packages/dsh-vibe-coding-prd/test/tools.test.mjs` 全绿
- [ ] `packages/dsh-vibe-coding-prd/package.json` 的 `version` 已递增
- [ ] `CHANGELOG.md` 已补本次版本条目
- [ ] 在真实 profile 里装一次，确认 `application: applied` 且七个工具出现在工具目录
- [ ] 确认补丁层里没有指向本插件的 `disabled: true` 残留（这类行会持久化，重启也不会消失）
- [ ] 跑一次完整访谈（十步 → 落盘），确认两份文档产出且出口门自检通过

## 许可

MIT，见 [LICENSE](LICENSE)。提交贡献即表示同意以同一许可发布。

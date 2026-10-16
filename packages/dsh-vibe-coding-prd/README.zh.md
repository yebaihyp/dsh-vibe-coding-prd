# dsh-vibe-coding-prd（中文说明）

> English: [README.md](README.md)

**把一个说不清需求的人，通过一问一答，带到一份 AI 能直接照着开工的 PRD。**

这是 DeepSeek Harness 的访谈式需求梳理插件：把"一问一答理需求"做成**有状态、有门禁、会落盘**的流程工具。
模型负责像产品顾问一样问话，插件负责按门推进、账本留痕、把答案变成文件。
**该强制的地方写进代码，而不是写在提示词里靠模型自觉。**

## 安装

```powershell
dsh plugin --profile desktop add dsh-vibe-coding-prd
```

装完**重启 Harness 宿主**（模块代次缓存在进程里）。确认生效：对 agent 说"我们走到哪了"，
能调用 `interview_status` 就是成了。

## 用法

对 agent 说"我想做个 XX，但不知道怎么跟 AI 说"，它会依次调用：

```
interview_start → interview_next → （问你）→ interview_advance
         └─ 重复十步 ─┘
interview_finalize → 落盘 docs/prd.md 与 docs/项目说明书.md
```

同时注册了技能 `vibe-coding-interview`，任何会话都能发现这套访谈规范。

## 关键约束

- **一步没过，不进下一步**：`interview_advance` 返回 `advanced: false` 时，流程停在本步。
- **必经步骤不能跳**：`interview_skip` 会拒绝，只允许跳 S1.5、S1.8 两个可选步骤，且必须写理由留痕。
- **出口门不打折**：11 条机器校验，有一条 error 未过就一个文件都不写。
- **空话进不了 PRD**："系统正常""体验良好"这类验收标准会被直接拒绝。
- **分步提交**（v0.2）：`interview_advance` 一次只交 1-3 个字段，每批立即落盘；
  `interview_next` 返回的 `submissionPlan` 已经分好批。一次塞太多字段容易让工具参数拼出非法
  JSON、整轮作废——分批交才是省事的做法。
- **账本不串项目**（v0.2）：项目目录只认显式 `workspace` 或会话工作目录，拿不到就拒绝执行；
  账本里记的工作目录与本次不一致时不续接，只提示"发现历史账本在别处"。
- **自检不误伤**（v0.2）：URL / 路由 / 行内代码里的 `<id>` 不算占位符，标题里的三段式英文品牌名
  不算英文正文；真被误判就把品牌名 / 术语放进 `interview_finalize` 的 `terms`。

完整的十步说明、出口门清单与设计取舍见 [README.md](README.md)。

## 许可

[MIT](https://github.com/OWNER/dsh-vibe-coding-prd/blob/main/LICENSE)

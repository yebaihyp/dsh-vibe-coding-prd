/**
 * 访谈引擎（纯逻辑，不依赖 DSH 运行时）
 *
 * 把"一问一答理需求"这件事写成一段可执行的状态机：节点顺序、退出条件、可选步骤、
 * 轻/重模式、答案校验、出口门自检、文档渲染。
 *
 * 设计原则：
 * 1. 步骤即门：节点顺序固定，退出条件不满足就不放行；只有 required=false 的节点可跳，
 *    且必须在账本"跳步留痕"写一行理由。
 * 2. 深度随风险走：S1.1 分诊出轻/重两种模式，轻模式允许"几步合并、一次报门"，
 *    但出口门无论轻重都不打折。
 * 3. 复杂度是负债：未提供的可选信息一律留空，绝不编造；技术取向默认推最简可用形态。
 *
 * 本文件不含任何 I/O 副作用，全部输入通过参数传入，方便脱离 DSH 单测。
 */

/** 节点定义：S1.0 → S1.9，顺序即门 */
export const NODES = [
  {
    id: 'S1.0',
    name: '破冰',
    required: true,
    defaultMode: 'light',
    auto: true,
    header: '破冰',
    ask: '用两句话回应用户：先复述你理解的"他想做个什么"，再确认"谁会用"。别展开成方案，别急着问细节。',
    guidance: [
      '只问两件事：一句话描述 + 谁会用它。',
      '用户说得含糊也没关系，先记下来，后面几步会补。',
      '不要在这一步提技术、形态、框架。'
    ],
    fields: [
      { key: 'oneLiner', label: '一句话描述', hint: '用一句话说清"这个产品为谁、解决什么"', minChars: 6 },
      { key: 'audience', label: '谁会用它', hint: '自己 / 同事 / 客户 / 陌生人，尽量具体', minChars: 2 }
    ],
    exit: '拿到一句话描述 + 谁用',
    next: 'S1.1'
  },
  {
    id: 'S1.1',
    name: '分诊定深度',
    required: true,
    defaultMode: 'light',
    header: '选择访谈深度',
    ask: '把"轻模式"和"重模式"用大白话讲给用户听，给出你的推荐，让他点头或改。',
    guidance: [
      '判断标准：自己用 / 一次性 / 跑 demo → 轻；给别人用 / 长期跑 / 涉及钱或别人数据 / 出错有代价 → 重。',
      '从用户已经说过的话里推断，不要做开放式提问。',
      '判定结果要落进 mode 字段，它会决定后面哪些步骤可以合并报门。'
    ],
    fields: [
      {
        key: 'mode',
        label: '访谈深度',
        enum: ['light', 'heavy'],
        hint: 'light=自己用/一次性/demo；heavy=给别人用/有代价'
      }
    ],
    exit: '判定轻/重，并写入账本',
    next: 'S1.2'
  },
  {
    id: 'S1.2',
    name: '资源现实盘点',
    required: true,
    defaultMode: 'light',
    header: '现有资源清单',
    ask: '把资源清单整张发给用户，让他勾选或口头回答，允许"不确定"。收到后先复述一遍你的理解再往下走。',
    guidance: [
      '清单一次发完，不要零散地问。',
      '这五项是后面砍方案、定技术栈的硬约束，填得越实，后面的选型越不脱离现实。',
      '用户答"不确定"的项，你替他给默认值，并说明理由。'
    ],
    fields: [
      {
        key: 'resources',
        label: '现有资源清单',
        type: 'object',
        requiredKeys: ['machine', 'skill'],
        properties: {
          machine: { label: '机器与运行环境', hint: '常开服务器 / 只有自己电脑 / 某云或静态托管 / 都没有' },
          skill: { label: '自身能力与投入', hint: '不会写代码全靠 AI / 能改简单的 / 愿不愿意长期维护' },
          services: { label: '已有的账号与密钥', hint: 'AI 接口 key、现成后端（飞书多维表、Supabase 等）、域名、通知渠道' },
          budget: { label: '预算', hint: '一次性预算、每月可接受开销、是否对按量计费敏感' },
          data: { label: '数据', hint: '要存多少、留多久、是否涉及别人的个人信息' }
        },
        hint: '逐项记下用户的原话要点；不确定的项写成你替他定的默认值。'
      }
    ],
    exit: '现有资源清单已回填',
    next: 'S1.3'
  },
  {
    id: 'S1.3',
    name: '定形态：它活在哪',
    required: true,
    defaultMode: 'light',
    header: '它活在哪',
    ask: '拿资源清单来定形态。给选项 + 推荐 + 代价，让用户拍板；别问他编程语言。',
    guidance: [
      '这是最关键的一步：一步没定，不准进 S1.4。',
      '清单已经替你砍掉一半选项了（没服务器、不想买 → 排除"需常开服务器"那类）。',
      '默认推"够用的最简形态"。展示型官网/留资类产品，纯前端网页 + 表单就够了。',
      '不要因为"显得正经"就给用户加上他养不起的后端。'
    ],
    options: [
      { value: 'static-web', label: '纯前端网页（无后端、无服务器）', cost: '最省心，能扔到任何静态托管；但"提交后存哪"要先留作后续（本地记录或发邮件）' },
      { value: 'server-app', label: '需要一台常开服务器（有后端/数据库）', cost: '复杂度和维护成本跳一档：你得管这台机器，它挂了服务就停' },
      { value: 'local-script', label: '可直接运行的单文件/脚本', cost: '最简单；但没界面、要会运行，不适合给小白用户' },
      { value: 'no-code', label: '零代码/自动化平台', cost: '上手快；但有订阅费、逻辑一复杂就难维护，且看不懂里面发生了什么' }
    ],
    fields: [
      { key: 'form', label: '它活在哪', enum: ['static-web', 'server-app', 'local-script', 'no-code'], hint: '四选一，必须明确' },
      { key: 'formReason', label: '为什么是它', minChars: 4, hint: '一句话：拿资源清单里的哪一条推出了这个结论' }
    ],
    exit: '「它活在哪」已选定一项',
    next: 'S1.4'
  },
  {
    id: 'S1.4',
    name: '补全需求',
    required: true,
    defaultMode: 'heavy',
    header: '把需求问全',
    ask: '先按四要素问清"想要什么"，再用数据旅程扫一遍他没想到的情况；每发现一个缺口，追问"那这种情况你希望它怎么办"。',
    guidance: [
      '四要素：场景、目标、约束（验收标准在第 S1.7 步单独问，这里不用管）。',
      '数据旅程：数据从哪来 → 怎么处理 → 到哪去。每一段都问会不会 断 / 多 / 假 / 错 / 慢 / 挂 / 丢 / 漏。',
      '用户答不上来的，给建议而不是留空。',
      '冒出来的新点子先记进 deferred，别打断当前主线。'
    ],
    fields: [
      { key: 'scene', label: '场景', minChars: 6, hint: '谁、在什么情况下、多久用一次' },
      { key: 'goal', label: '目标', minChars: 6, hint: '做完这件事，用户得到什么结果' },
      { key: 'constraints', label: '约束', minChars: 4, hint: '时间、钱、能力、合规、必须复用已有资源' },
      {
        key: 'dataJourney',
        label: '数据旅程缺口',
        type: 'array',
        minItems: 1,
        itemShape: ['gap', 'handling'],
        hint: '每条一个缺口：gap=可能出什么情况（断/多/假/错/慢/挂/丢/漏），handling=你希望它怎么办',
        itemHint: '例如 gap="抓不到网页时"，handling="跳过并在报告里标注未获取"'
      },
      { key: 'deferred', label: '以后再说', type: 'array', itemShape: ['item'], optional: true, hint: '访谈中冒出来、但这版不做的点子' }
    ],
    exit: '数据旅程扫过，发现的缺口每条都有"怎么办"的决定',
    next: 'S1.5'
  },
  {
    id: 'S1.5',
    name: '信息架构',
    required: false,
    defaultMode: 'heavy',
    header: '页面与去向',
    ask: '若是有界面的产品：从"关键用户任务"出发问页面和导航，然后逐个确认"每个能点的地方点完去哪"。',
    guidance: [
      '盯死一条：有没有死胡同——任何可点的元素都必须有明确去向。',
      '空路由、未知路由、旧路由怎么处理，也算输入"会不会断"的一部分。',
      '纯脚本、纯后端、没有界面的产品：直接跳过，并在账本写一行理由。'
    ],
    fields: [
      {
        key: 'infoArch',
        label: '页面与去向',
        type: 'array',
        itemShape: ['entry', 'destination'],
        hint: 'entry=能点的入口/页面，destination=点完去哪；没有界面就跳步'
      }
    ],
    exit: 'UI 类产品：页面去向无死胡同；否则跳步并留痕',
    next: 'S1.6'
  },
  {
    id: 'S1.6',
    name: '边界与禁区',
    required: true,
    defaultMode: 'heavy',
    header: '边界与禁区',
    ask: '问清"它明确不做什么"，以及有没有合规/内容红线、有没有"内部实现别漏成卖点"的东西。',
    guidance: [
      '"明确不做"至少 1 条，这是防 AI 跑偏最有效的一句话。',
      '合规红线示例：不承诺固定结果、不公开价格、不展示未授权案例。',
      '内部架构（用了几个 agent、什么框架）是实现细节，不能写进用户侧定位。'
    ],
    fields: [
      {
        key: 'notDoing',
        label: '明确不做',
        type: 'array',
        minItems: 1,
        itemShape: ['item'],
        hint: '至少 1 条边界，写成"本期不做 XX"'
      },
      {
        key: 'compliance',
        label: '必须表达 / 禁止表达',
        type: 'object',
        optional: true,
        properties: {
          must: { label: '必须表达', hint: '对外必须讲清的话' },
          forbidden: { label: '禁止表达', hint: '不能说的话、不能给的承诺' }
        }
      }
    ],
    exit: '「明确不做」至少 1 条 + 合规红线已问',
    next: 'S1.7'
  },
  {
    id: 'S1.7',
    name: '验收 + MVP + 以后再说',
    required: true,
    defaultMode: 'heavy',
    header: '怎么算做完了',
    ask: '逐条问"怎么算这一版做完了"，把答案逼成可二元判断的事实；然后定 MVP 完成线。',
    guidance: [
      '验收标准优先用 EARS 格式：当【前置条件】，在【动作】时，则【可观察的结果】。',
      '"正常""好用""流畅"这类空话会被门禁拒绝，必须换成能手动验证的事实。',
      '冒出来的需求多时，按"必须做/应该做/以后再说"三档排，别都塞进第一版。'
    ],
    fields: [
      {
        key: 'acceptance',
        label: '验收标准',
        type: 'array',
        minItems: 1,
        itemShape: ['item'],
        hint: '每条都要能被手动验证。推荐 EARS：当【前置条件】，在【动作】时，则【可观察的结果】',
        itemHint: '例如"当我在页面填入 5 个竞品链接并点击生成，则 60 秒内出现一份含定价/功能/动态/评价四列的对比表"'
      },
      {
        key: 'mvp',
        label: 'MVP 完成定义',
        type: 'array',
        minItems: 1,
        itemShape: ['item'],
        hint: '达到什么状态就算这版做完，写成能打勾的条目'
      }
    ],
    exit: '至少 1 条 EARS 可验证验收 + MVP 完成线已定',
    next: 'S1.8'
  },
  {
    id: 'S1.8',
    name: '技术栈雏形',
    required: false,
    defaultMode: 'light',
    header: '技术取向',
    ask: '拿 S1.2 的资源清单逐项对照着推技术取向，给出"推荐 + 代价 + 可否决"，让用户点头。',
    guidance: [
      '铁律：别一上来就推"后端 + 数据库 + Python"，那是 AI 训练数据里最常见的样子，不一定适合用户。',
      '没服务器、不想买 → 砍掉一切要常开后端的技术，优先能扔静态托管的方案。',
      '已有现成服务（飞书多维表、Supabase 等）→ 优先用它当后端，别新起一套。',
      '有 AI 接口 key 且对成本敏感 → 估算每次调用成本，并把"省调用"写进方案。',
      '主动挡住工程师条件反射式的加料：Docker / Nginx / MySQL / Redis / 微服务，单机小项目逐个反问"我这场景需要吗"。'
    ],
    fields: [
      { key: 'techChoice', label: '选定', minChars: 4, hint: '选定的方案，一句话' },
      { key: 'techReason', label: '为什么选它 + 否决了什么', minChars: 8, hint: '必须同时写到"选定"和"否决"：否决了哪些方案、为什么' }
    ],
    exit: '形态对应的技术取向已定',
    next: 'S1.9'
  },
  {
    id: 'S1.9',
    name: '落盘',
    required: true,
    defaultMode: 'light',
    header: '落盘并给出下一步',
    ask: '调用 interview_finalize 产出两份文档，然后提议生成可点击的 HTML 原型。',
    guidance: [
      '落盘前先自查：全文无 {占位符}、无英文正文、无密钥。',
      '写完后主动说："要不要我先生成一个能点的 HTML 原型？你点一遍，往往能发现一堆现在没想到的需求。"'
    ],
    fields: [{ key: 'projectName', label: '产品名称', minChars: 2, hint: '两份文档与账本会用同一个名字' }],
    exit: 'prd.md + 项目说明书.md 已写',
    next: null
  }
];

/** 轻模式下的合并报门分组：几步一起问、一次报门 */
export const LIGHT_GROUPS = [
  ['S1.0', 'S1.1', 'S1.2'],
  ['S1.3', 'S1.4', 'S1.6'],
  ['S1.7', 'S1.9']
];

export const FORM_OPTIONS = NODES.find((node) => node.id === 'S1.3').options;

const FORM_LABELS = {
  'static-web': '纯前端网页（无后端、无服务器）',
  'server-app': '需要一台常开服务器（有后端/数据库）',
  'local-script': '可直接运行的单文件/脚本',
  'no-code': '零代码/自动化平台'
};

const MODE_LABELS = { light: '轻', heavy: '重' };

/** 空话黑名单：验收标准里出现这些词，说明还没写成可验证的事实 */
const EMPTY_PHRASES = [
  '系统正常', '功能正常', '运行正常', '正常工作', '正常使用', '一切正常',
  '体验良好', '体验流畅', '用户友好', '界面美观', '性能良好', '稳定可靠',
  '若干', '等等等', '待定', '视情况'
];

/**
 * 分步提交上限（v0.2，报告 2.8-B）。
 *
 * 背景：工具参数是流式拼出来的，参数越长、嵌套越深，越容易在拼装环节产出非法 JSON，
 * harness 判定 MALFORMED_RESPONSE 后中止整轮。可复现的必要条件就是"参数足够长且结构复杂"，
 * 所以给单次 interview_advance 定一个软上限：超限不拒收（答案照常落盘，绝不丢），
 * 只提醒下一次拆开交。字段数与字符数的判定见 measureSubmission()。
 */
export const SUBMIT_LIMITS = { maxFields: 3, maxChars: 1200, maxItems: 3 };

/** 中文与全角标点：行内出现它们就不算"英文正文" */
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** 段英文特征：连续 3 个及以上拉丁词（是否真算"英文正文"还要过 scanEnglish 的行级判定） */
const ENGLISH_RUN = /[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){2,}/;

/** 明显是敏感信息的特征：密钥赋值、常见 key 前缀 */
const SECRET_PATTERNS = [
  /\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9]{10,}/,
  /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*\S{6,}/i
];

/** 生成一份空状态 */
export function createState(projectName) {
  return {
    version: 2,
    projectName: projectName || '',
    // 工作目录：账本与状态都记一份，加载时和本次解析出的目录比对（报告 P3）
    workspace: '',
    stage: 'S1',
    stageName: '需求对齐',
    step: 'S1.0',
    mode: '',
    updatedAt: '',
    nextNumber: 1,
    steps: {},
    answers: {},
    skipped: [],
    blocks: [],
    // 英文自检的白名单：项目名之外，用户坚持要用的品牌名 / 术语（报告 P6）
    terms: [],
    notes: ''
  };
}

/** 按 id 取节点 */
export function nodeById(id) {
  return NODES.find((node) => node.id === id) || null;
}

/** 取下一个节点 id */
export function nextNodeId(id) {
  const index = NODES.findIndex((node) => node.id === id);
  return index >= 0 && index + 1 < NODES.length ? NODES[index + 1].id : null;
}

/** 判断某一步当前是什么状态：⬜ 未开始 / 🔄 进行中 / ✅ 完成 / ⏭️ 跳过 */
export function stepStatus(state, id) {
  const record = state.steps[id];
  if (record?.status) return record.status;
  return '⬜';
}

/** 该节点是否可跳：只有 required=false 才行 */
export function canSkip(node) {
  return node.required === false;
}

/** 找到当前待办的节点：第一个未完成的必填节点；必填全完成后才轮到可选节点 */
export function currentStep(state) {
  if (nextNodeId(state.step) || isStepDone(state, state.step)) {
    const pending = NODES.find((node) => !isStepDone(state, node.id) && node.required);
    if (pending) return pending.id;
    const optional = NODES.find((node) => !isStepDone(state, node.id));
    if (optional) return optional.id;
    return null;
  }
  return state.step;
}

function isStepDone(state, id) {
  const status = stepStatus(state, id);
  return status === '✅' || status === '⏭️';
}

/** 把状态渲染成 docs/进度账本.md 的文本（严格保持模板结构） */
export function renderLedger(state) {
  const mode = state.mode ? MODE_LABELS[state.mode] : '待判定（S1.1）';
  const stepCells = (node) => {
    const status = stepStatus(state, node.id);
    const record = state.steps[node.id];
    const exitOk = record?.exitOk ? '已满足' : node.exit;
    return `| ${node.id} ${node.name} | ${node.required ? '必经' : '可选'} | ${status} | ${exitOk} |`;
  };
  const skippedLines = state.skipped.length
    ? state.skipped.map((item) => `- ${item.step} ${item.name}：跳过。理由：${item.reason}`)
    : ['- （暂无）'];
  const blockLines = state.blocks.length ? state.blocks.map((line) => `- ${line}`) : ['- 无'];

  return `# 进度账本

> 这是整个流程的状态来源。AI **每轮对话开场先读它**、**每过一道门就更新它**。
> 由 dsh-vibe-coding-prd 插件自动维护，不必手工编辑。

- 项目名称：${state.projectName || '（待 S1.9 落盘时确定）'}
- 工作目录：${state.workspace || '（未记录）'}
- 当前阶段：S1 · 需求对齐
- 当前步骤：${state.step}
- 模式：${mode}
- 最近更新：${state.updatedAt || '（未更新）'}

---

## 阶段进度

| 阶段 | 状态 | 出口门 | 备注 |
|------|------|--------|------|
| S1 需求对齐 | ${state.stage === 'S2' ? '已完成' : '进行中'} | ${state.stage === 'S2' ? '✓ 已过' : '✗ 未过'} | ${state.notes || '入口路径：访谈 Agent'} |
| S2 架构选型 | 未开始 | — | 被 S1 阻塞 |
| S3 上线准备 | 未开始 | — | demo 阶段不进入；要做正式系统再开 |

状态取值：未开始 / 进行中 / 已完成。出口门：✗ 未过 / ✓ 已过。

---

## 当前阶段的步骤

> 重模式逐步报门；轻模式按组合并报门（组 A/B/C，见插件说明）。

| 步骤 | 必经? | 状态 | 退出条件是否满足 |
|------|-------|------|------------------|
${NODES.map(stepCells).join('\n')}

状态取值：⬜ 未开始 / 🔄 进行中 / ✅ 完成 / ⏭️ 跳过（须在下方留痕）。

---

## 跳步留痕（深度自适应）

> 只有分诊判"轻"时，才允许跳 \`可选\` 步骤。每跳一步在这里写一行理由。

${skippedLines.join('\n')}

---

## 阻塞项

${blockLines.join('\n')}
`;
}

/**
 * 从账本文本恢复状态。只解析必要字段；解析不出来就返回 null，由调用方从零开始。
 * 这是"账本是唯一状态来源"的落地：文档在，流程就能接着走。
 */
export function parseLedger(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  // 只认自己渲染出来的账本：结构不对就当作没有账本，宁可重开也不要误读
  if (!text.includes('## 阶段进度') || !text.includes('## 当前阶段的步骤')) return null;
  if (!/^\|\s*S1\.0\s/m.test(text)) return null;
  const state = createState('');
  const pick = (label) => {
    const match = text.match(new RegExp(`^-\\s*${label}：\\s*(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  const name = pick('项目名称');
  if (name && !name.startsWith('（')) state.projectName = name;
  // 账本里记的工作目录：加载时和本次解析出的目录比对，不一致就不续接（报告 P3）
  const workspace = pick('工作目录');
  if (workspace && !workspace.startsWith('（')) state.workspace = workspace;
  const step = pick('当前步骤');
  if (/^S1\.\d$/.test(step)) state.step = step;
  const modeRaw = pick('模式');
  if (modeRaw.startsWith('轻')) state.mode = 'light';
  else if (modeRaw.startsWith('重')) state.mode = 'heavy';
  const updated = pick('最近更新');
  if (updated && !updated.startsWith('（')) state.updatedAt = updated;
  if (/S1 需求对齐\s*\|\s*已完成/.test(text)) state.stage = 'S2';
  // 备注列也要读回来，否则仅凭账本恢复（状态旁挂文件丢了）时这一格会被默认值盖掉
  const stageRow = text.match(/^\|\s*S1 需求对齐\s*\|[^|]*\|[^|]*\|([^|]*)\|/m);
  const notes = stageRow ? stageRow[1].trim() : '';
  if (notes && notes !== '入口路径：访谈 Agent') state.notes = notes;

  const rows = text.matchAll(/^\|\s*(S1\.\d)\s+[^|]*\|\s*(必经|可选)\s*\|\s*([^|]*)\|([^|]*)\|/gm);
  for (const row of rows) {
    const id = row[1];
    const status = row[3].trim();
    if (!/^(⬜|🔄|✅|⏭️)/.test(status)) continue;
    state.steps[id] = { status: status.slice(0, 2), exitOk: row[4].includes('已满足') };
  }

  const skipSection = text.split('## 跳步留痕（深度自适应）')[1]?.split('---')[0] || '';
  for (const line of skipSection.split('\n')) {
    const match = line.match(/^-\s*(S1\.\d)\s*([^：:]*)[：:]\s*跳过。理由：\s*(.+)$/);
    if (match) state.skipped.push({ step: match[1], name: match[2].trim(), reason: match[3].trim() });
  }

  const blockSection = text.split('## 阻塞项')[1] || '';
  for (const line of blockSection.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') && trimmed !== '- 无') state.blocks.push(trimmed.slice(2));
  }
  return state;
}

/**
 * 数组元素的文本形式。
 *
 * 字段定义里 itemShape: ['item'] 表示元素是 {item:"…"} 对象，但模型经常直接给字符串。
 * 两种形状都要能读——v0.2 修的就是报告 P5：渲染器把对象当字符串用，
 * 文档里于是出现 `[object Object]` 与 `{"item":"…"}`（后者还会被占位符自检误杀）。
 */
export function itemText(item) {
  if (item === undefined || item === null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (typeof item === 'object') {
    for (const key of ['item', 'text', 'title', 'content', 'value']) {
      if (typeof item[key] === 'string' && item[key].trim()) return item[key];
    }
    const texts = Object.values(item).filter((value) => typeof value === 'string' && value.trim());
    if (texts.length === 1) return texts[0];
    return JSON.stringify(item);
  }
  return String(item);
}

/**
 * 两段式条目（{entry, destination} / {gap, handling}）拆成两段文本。
 * 模型偶尔把两段写成一行（"首页 → 结果页"），这里也认，避免文档里出现 undefined。
 */
export function pairText(item, keys) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return keys.map((key) => itemText(item[key]));
  }
  const parts = itemText(item).split(/\s*(?:→|->|=>)\s*/);
  return keys.map((key, index) => String(parts[index] ?? '').trim());
}

/**
 * 把一步的答案归一化成引擎内部形状（写入状态之前做，所以状态文件、账本、文档看到的是同一种形状）：
 * - itemShape: ['item']：元素统一成字符串（{item:"…"} → "…"）；
 * - itemShape: [a, b]：字符串形式按 "→" 拆成 {a, b} 对象，其余保持原样；
 * - 其它字段原样。
 */
export function normalizeValues(node, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return values;
  const out = { ...values };
  for (const field of node.fields) {
    const value = out[field.key];
    if (field.type !== 'array' || !Array.isArray(field.itemShape) || !Array.isArray(value)) continue;
    if (field.itemShape.length === 1) {
      out[field.key] = value.map(itemText).filter((text) => String(text).trim() !== '');
      continue;
    }
    if (field.itemShape.length === 2) {
      const keys = field.itemShape;
      out[field.key] = value.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) return item;
        const parts = itemText(item).split(/\s*(?:→|->|=>)\s*/).filter((part) => part.trim());
        if (parts.length < 2) return item;
        return { [keys[0]]: parts[0].trim(), [keys[1]]: parts.slice(1).join(' → ').trim() };
      });
    }
  }
  return out;
}

/** 校验单个字段的答案，返回问题列表 */
function validateField(node, field, value) {
  const issues = [];
  const label = field.label;
  const optional = field.optional === true;

  if (value === undefined || value === null || value === '') {
    if (!optional) issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label}：不能为空（${field.hint}）` });
    return issues;
  }

  if (field.type === 'array') {
    if (!Array.isArray(value) || value.length === 0) {
      if (!optional) issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label}：至少要 1 条（${field.hint}）` });
      return issues;
    }
    if (field.minItems && value.length < field.minItems) {
      issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label}：至少要 ${field.minItems} 条，现在是 ${value.length} 条` });
    }
    value.forEach((item, index) => {
      const text = itemText(item);
      if (!text || text.trim().length < 2) {
        issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label} 第 ${index + 1} 条太短，写不成一条需求` });
      }
      if (field.itemShape?.length === 2) {
        const [a, b] = field.itemShape;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          issues.push({
            field: field.key,
            severity: 'error',
            message: `${node.id} ${label} 第 ${index + 1} 条要写成对象 {"${a}":"…","${b}":"…"}（${field.itemHint || ''}）`
          });
          return;
        }
        for (const key of [a, b]) {
          if (!item[key] || String(item[key]).length < 2) {
            issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label} 第 ${index + 1} 条缺少「${key}」（${field.itemHint || ''}）` });
          }
        }
      }
    });
    return issues;
  }

  if (field.type === 'object') {
    if (typeof value !== 'object') {
      issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label}：要写成对象（${field.hint}）` });
      return issues;
    }
    for (const key of field.requiredKeys || []) {
      const cell = value[key];
      const text = typeof cell === 'string' ? cell : JSON.stringify(cell ?? '');
      if (!text || text.length < 2) {
        issues.push({
          field: `${field.key}.${key}`,
          severity: 'error',
          message: `${node.id} ${label}：缺少「${field.properties?.[key]?.label || key}」（${field.properties?.[key]?.hint || ''}）`
        });
      }
    }
    return issues;
  }

  const text = String(value).trim();
  if (field.enum && !field.enum.includes(text)) {
    issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label}：只能取 ${field.enum.join(' / ')}，收到"${text}"` });
  }
  if (field.minChars && text.length < field.minChars) {
    issues.push({ field: field.key, severity: 'error', message: `${node.id} ${label}：至少 ${field.minChars} 个字，现在只有 ${text.length} 个字` });
  }
  return issues;
}

/** 校验验收标准：必须是可二元判断的事实 */
export function checkAcceptance(items) {
  const issues = [];
  (Array.isArray(items) ? items : []).forEach((raw, index) => {
    const text = itemText(raw).trim();
    const position = `验收标准 第 ${index + 1} 条`;
    const empty = EMPTY_PHRASES.find((phrase) => text.includes(phrase));
    if (empty) {
      issues.push({ field: 'acceptance', severity: 'error', message: `${position}里出现空话"${empty}"："${text}"。空话无法验收，换成可观察的结果。` });
      return;
    }
    if (text.length < 12) {
      issues.push({ field: 'acceptance', severity: 'error', message: `${position}太短："${text}"。写成一句能被验证的完整事实。` });
      return;
    }
    const observable = /当|在.*时|则|后|看到|显示|出现|生成|返回|导出|收到|打开|点击|输入|填|超过|不超过|秒|分钟|条|个|份|字节|KB|MB|%|：|\d/.test(text);
    if (!observable) {
      issues.push({
        field: 'acceptance',
        severity: 'warning',
        message: `${position}看不出可观察的结果："${text}"。建议改成 EARS 格式：当【前置条件】，在【动作】时，则【可观察的结果】。`
      });
    }
  });
  return issues;
}

/** 校验某一步的答案是否满足退出条件 */
export function validateAnswer(state, node, values) {
  const normalized = normalizeValues(node, values);
  const issues = [];
  if (node.auto) {
    if (!normalized.oneLiner) issues.push({ field: 'oneLiner', severity: 'error', message: 'S1.0 破冰：还没拿到"一句话描述"' });
  }
  for (const field of node.fields) {
    issues.push(...validateField(node, field, normalized[field.key]));
  }
  if (node.id === 'S1.7' && Array.isArray(normalized.acceptance)) {
    issues.push(...checkAcceptance(normalized.acceptance));
  }
  if (node.id === 'S1.8') {
    const joined = `${normalized.techChoice || ''} ${normalized.techReason || ''}`;
    if (!/(选定|选它|选择)/.test(joined)) {
      issues.push({ field: 'techChoice', severity: 'error', message: 'S1.8 技术栈雏形：必须明确写出"选定"了什么方案' });
    }
    if (!/(否决|排除|放弃|不选)/.test(joined)) {
      issues.push({ field: 'techReason', severity: 'error', message: 'S1.8 技术栈雏形：必须写出"否决"了哪些方案及理由（出口门要求同时含"选定"与"否决"）' });
    }
  }
  return issues;
}

/** 把答案合并进状态，并推进到下一步 */
export function applyAnswer(state, stepId, values, meta = {}) {
  const node = nodeById(stepId);
  if (!node) throw new Error(`未知步骤：${stepId}`);
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error(`${stepId} ${node.name}：答案必须是一个对象，字段名取该步骤的 fields[].key`);
  }
  const normalized = normalizeValues(node, values);
  const next = { ...state, steps: { ...state.steps }, answers: { ...state.answers } };
  if (!next.steps[stepId]) next.nextNumber += 1;
  next.steps[stepId] = { status: '✅', exitOk: true, at: meta.at || '' };
  next.answers[stepId] = { ...(next.answers[stepId] || {}), ...normalized };
  if (normalized.mode === 'light' || normalized.mode === 'heavy') next.mode = normalized.mode;
  if (normalized.projectName) next.projectName = String(normalized.projectName).trim();
  if (node.id === 'S1.4' && Array.isArray(next.answers[stepId].deferred)) {
    // 归一化后再去重，否则 {item:"…"} 与 "…" 会被当成两条
    const merged = [...(next.answers.deferred || []), ...next.answers[stepId].deferred].map(itemText);
    next.answers[stepId].deferred = [...new Set(merged)];
    next.answers.deferred = next.answers[stepId].deferred;
  }
  const following = nextNodeId(stepId);
  next.step = following || 'S1.9';
  next.updatedAt = meta.at || next.updatedAt;
  return next;
}

/** 跳过一个可选步骤，并留下痕迹 */
export function skipStep(state, stepId, reason, meta = {}) {
  const node = nodeById(stepId);
  if (!node) throw new Error(`未知步骤：${stepId}`);
  if (!canSkip(node)) throw new Error(`${stepId} ${node.name} 是必经步骤，不允许跳过（required=true）`);
  if (isStepDone(state, stepId)) throw new Error(`${stepId} ${node.name} 已经过门，不能再标记为跳过`);
  if (!reason || String(reason).trim().length < 4) {
    throw new Error('跳步必须写明理由，至少 4 个字，例如"纯脚本，无界面"');
  }
  const next = { ...state, steps: { ...state.steps }, skipped: [...state.skipped] };
  next.steps[stepId] = { status: '⏭️', exitOk: true, reason: String(reason).trim(), at: meta.at || '' };
  next.skipped = next.skipped.filter((item) => item.step !== stepId);
  next.skipped.push({ step: stepId, name: node.name, reason: String(reason).trim() });
  const following = nextNodeId(stepId);
  next.step = following || 'S1.9';
  next.updatedAt = meta.at || next.updatedAt;
  return next;
}

/** 找出所有未完成的必填步骤 */
export function missingRequired(state) {
  return NODES.filter((node) => node.required && !isStepDone(state, node.id));
}

// ---------------------------------------------------------------------------
// 分步提交（v0.2，报告 2.8-B）
//
// 断点那次失败是"一次塞了 11 条中文长句"的深嵌套参数在流式拼装时变成非法 JSON。
// 参数长度和嵌套深度是唯一可复现的必要条件，所以插件这边的对策很直接：
// 让每次 interview_advance 都只带一小批字段，并且每一步都能落盘、随时可续。
// ---------------------------------------------------------------------------

/** 估算一个字段提交进工具参数大约占多少字符：只用于分批，不必精确 */
function estimateFieldChars(field) {
  if (field.type === 'array') return Math.max(140, (field.minItems || 1) * 140);
  if (field.type === 'object') return 200;
  return Math.max(60, (field.minChars || 4) * 4);
}

/**
 * 量一次提交的体积：字段数、参数字符数、数组条目数。
 * 超限不拒收（答案照常落盘，绝不丢），只用来提醒下一次拆开交。
 */
export function measureSubmission(values) {
  const entries = Object.entries(values || {});
  const chars = JSON.stringify(values ?? {}).length;
  const arrayItems = entries.reduce((sum, [, value]) => sum + (Array.isArray(value) ? value.length : 0), 0);
  const reasons = [];
  if (entries.length > SUBMIT_LIMITS.maxFields) reasons.push(`一次交了 ${entries.length} 个字段（上限 ${SUBMIT_LIMITS.maxFields} 个）`);
  if (chars > SUBMIT_LIMITS.maxChars) reasons.push(`参数 ${chars} 字符（上限 ${SUBMIT_LIMITS.maxChars} 字符）`);
  if (arrayItems > SUBMIT_LIMITS.maxItems) reasons.push(`数组条目 ${arrayItems} 条（上限 ${SUBMIT_LIMITS.maxItems} 条）`);
  return { fields: entries.length, chars, arrayItems, oversized: reasons.length > 0, reasons };
}

/** 这一步还差哪些字段（按节点顺序）：没填的 + 校验报错的；可选字段不计入 */
export function outstandingFields(node, merged, issues = []) {
  const keys = new Set();
  for (const field of node.fields) {
    if (field.optional === true) continue;
    const value = merged?.[field.key];
    const empty = value === undefined || value === null || value === ''
      || (Array.isArray(value) && value.length === 0);
    if (empty) keys.add(field.key);
  }
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    const key = String(issue.field || '').split('.')[0];
    if (key && node.fields.some((field) => field.key === key && field.optional !== true)) keys.add(key);
  }
  return node.fields.filter((field) => keys.has(field.key)).map((field) => field.key);
}

/**
 * 分步提交计划：把还没交的字段切成小批，每批 ≤ 3 个字段、估算 ≤ 1200 字符。
 * 模型照着这个计划一批一批交，工具参数就一直是"小且结构简单"的。
 */
export function planSubmission(node, outstanding) {
  const keys = (Array.isArray(outstanding) ? outstanding : []).filter((key) => node.fields.some((field) => field.key === key));
  const batches = [];
  let current = { fields: [], estimateChars: 0 };
  for (const key of keys) {
    const field = node.fields.find((item) => item.key === key);
    const estimate = estimateFieldChars(field);
    const full = current.fields.length >= SUBMIT_LIMITS.maxFields
      || current.estimateChars + estimate > SUBMIT_LIMITS.maxChars;
    if (current.fields.length && full) {
      batches.push(current);
      current = { fields: [], estimateChars: 0 };
    }
    current.fields.push(key);
    current.estimateChars += estimate;
  }
  if (current.fields.length) batches.push(current);
  return {
    limits: { ...SUBMIT_LIMITS },
    batches: batches.map((batch, index) => ({ call: index + 1, fields: batch.fields, estimateChars: batch.estimateChars })),
    tip: '每次 interview_advance 只交一批（≤ 3 个字段、≤ 1200 字符），数组字段一次交 1-3 条；每交一批都已落盘，中途断了也不会丢。'
  };
}

/** 出口门自检：逐条返回检查项与结论 */
export function exitGateChecks(state) {
  const answers = state.answers;
  const prdText = renderPrd(state);
  const specText = renderSpec(state);
  const allow = englishAllowlist(state);
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok, detail });

  add('ledger-steps', '账本：S1 各必经步骤为 ✅、跳过的可选步骤有留痕', missingRequired(state).length === 0,
    missingRequired(state).length ? `未完成：${missingRequired(state).map((n) => n.id).join('、')}` : '全部必经步骤已完成');
  add('prd-meta', 'prd.md：文档元信息（文档状态 / 版本 / 产品名称）已填写', Boolean(state.projectName) && Boolean(prdText),
    state.projectName ? `产品名称：${state.projectName}` : '产品名称缺失');
  add('prd-position', 'prd.md：核心定位是一句完整的话（≥10 字）', String(answers['S1.0']?.oneLiner || '').length >= 10,
    `当前 ${String(answers['S1.0']?.oneLiner || '').length} 字`);
  add('prd-notdoing', 'prd.md：明确不做 ≥ 1 条', Array.isArray(answers['S1.6']?.notDoing) && answers['S1.6'].notDoing.length >= 1,
    `当前 ${answers['S1.6']?.notDoing?.length || 0} 条`);
  add('prd-form', 'prd.md：形态与资源约束里「它活在哪」已选定', Boolean(answers['S1.3']?.form),
    answers['S1.3']?.form ? FORM_LABELS[answers['S1.3'].form] : '未选定');
  const acceptIssues = checkAcceptance(answers['S1.7']?.acceptance || []);
  add('prd-acceptance', 'prd.md：验收标准 ≥ 1 条且具体可验证', (answers['S1.7']?.acceptance || []).length >= 1 && !acceptIssues.some((i) => i.severity === 'error'),
    acceptIssues.length ? acceptIssues.map((i) => i.message).join('；') : '通过');
  add('prd-mvp', 'prd.md：MVP 完成定义 ≥ 1 条', (answers['S1.7']?.mvp || []).length >= 1, `当前 ${answers['S1.7']?.mvp?.length || 0} 条`);
  add('spec-baseline', '项目说明书：需求基准描述覆盖场景/目标/约束/验收四要素',
    Boolean(answers['S1.4']?.scene && answers['S1.4']?.goal && answers['S1.4']?.constraints && (answers['S1.7']?.acceptance || []).length),
    '缺一不可');
  add('no-placeholder', '全文无占位符 / TODO / TBD / ___ 残留（URL、路由、行内代码里的尖括号除外）',
    !scanPlaceholders(prdText) && !scanPlaceholders(specText),
    scanPlaceholders(prdText) || scanPlaceholders(specText) || '扫描 prd.md 与项目说明书.md');
  add('no-english', '全文无英文正文（术语、代码、URL、品牌名除外）',
    !scanEnglish(prdText, { allow }) && !scanEnglish(specText, { allow }),
    [scanEnglish(prdText, { allow }), scanEnglish(specText, { allow })].filter(Boolean).join('；') || '未发现英文正文');
  add('no-secret', '无密钥、密码、token 等敏感信息',
    !SECRET_PATTERNS.some((pattern) => pattern.test(prdText) || pattern.test(specText)), '扫描密钥特征');

  return checks;
}

/**
 * 英文自检的白名单：项目名 + 术语表（报告 P6）。
 * 产品名常常就是几个英文词（"Land of Knowledge"），不该被判成英文正文。
 */
export function englishAllowlist(state) {
  const terms = Array.isArray(state?.terms) ? state.terms : [];
  return [state?.projectName, ...terms].filter((term) => typeof term === 'string' && term.trim());
}

/** 去掉行内代码（`…`）：代码里的尖括号、花括号都是正当写法 */
function stripInlineCode(line) {
  return String(line).replace(/`[^`]*`/g, ' ');
}

/** URL / 路由 / 路径写法：<id>、<标签> 在这类上下文里是技术记法，不是没填的槽位（报告 P6） */
function isRouteOrUrlLine(line) {
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(line)) return true;
  return /(^|[^\w])\/[\w<{]/.test(line);
}

/**
 * 占位符自检：返回第一处命中的说明，没有则 null。
 *
 * v0.2 按报告 P6 收窄了误伤面（v0.1 用的是一刀切的正则，把 `/posts/<id>/` 这种
 * 正当的技术写法也判成了占位符）：
 * - 行内代码里的内容不看；
 * - 花括号里带引号、或"纯 ASCII + 冒号/等号"的，当成 JSON / 代码片段，不算占位；
 * - 尖括号只在"不像 URL / 路由的行"里才算占位。
 */
export function scanPlaceholders(text) {
  for (const raw of String(text).split('\n')) {
    const line = stripInlineCode(raw.trim()).trim();
    if (!line) continue;
    const mustache = line.match(/\{\{[^}\n]{1,40}\}\}/);
    if (mustache) return `模板占位符 ${mustache[0]}`;
    if (/\bTODO\b/i.test(line) || /\bTBD\b/i.test(line)) return '残留 TODO/TBD';
    if (/_{3,}/.test(line)) return '下划线占位';
    const brace = line.match(/\{([^}\n]{1,40})\}/);
    if (brace) {
      const inner = brace[1];
      const codeish = /["']/.test(inner) || (!CJK.test(inner) && /[:=]/.test(inner));
      if (!codeish) return `花括号占位 ${brace[0]}`;
    }
    if (isRouteOrUrlLine(line)) continue;
    const angle = line.match(/<[^>\n]{1,30}>/);
    if (angle) return `尖括号占位 ${angle[0]}`;
  }
  return null;
}

/**
 * 扫描英文正文：返回第一处可疑片段的说明，没有则 null。
 *
 * v0.2 按报告 P6 收窄：只在"整行基本都是英文"时才算英文正文——
 * 围栏代码块、行内代码、URL、含中文的行、以及去掉空白不足 40 字的短行都跳过
 * （三段式英文品牌名 `Land of Knowledge` 因此不再误伤文档标题）。
 * options.allow 里的项目名 / 品牌名 / 术语先剔掉再判定。
 */
export function scanEnglish(text, options = {}) {
  const allow = (Array.isArray(options.allow) ? options.allow : [])
    .filter((term) => typeof term === 'string' && term.trim())
    .map((term) => term.trim());
  let fenced = false;
  for (const raw of String(text).split('\n')) {
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    let line = stripInlineCode(trimmed).trim();
    if (!line) continue;
    for (const term of allow) line = line.split(term).join(' ');
    line = line.trim();
    if (!line || isRouteOrUrlLine(line)) continue;
    if (CJK.test(line)) continue;
    if (line.replace(/\s+/g, '').length < 40) continue;
    const match = line.match(ENGLISH_RUN);
    if (match) return `出现连续英文：${match[0].slice(0, 40)}`;
  }
  return null;
}

/** 列表渲染：{gap, handling} 走两段式，其余按文本渲染 */
function bullet(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) return `- ${emptyText}`;
  return items
    .map((item) => (item && typeof item === 'object' && !Array.isArray(item) && item.gap !== undefined
      ? `- ${pairText(item, ['gap', 'handling']).join(' → ')}`
      : `- ${itemText(item)}`))
    .join('\n');
}

function table(items, emptyText, mapper) {
  if (!Array.isArray(items) || items.length === 0) return `| — | ${emptyText} |`;
  return items.map(mapper).join('\n');
}

/** 需求基准描述：场景 + 目标 + 约束 + 验收，合成 100-200 字 */
export function baselineDescription(state) {
  const a = state.answers;
  const scene = a['S1.4']?.scene || '（场景待补）';
  const goal = a['S1.4']?.goal || '（目标待补）';
  const constraints = a['S1.4']?.constraints || '（约束待补）';
  const acceptance = (a['S1.7']?.acceptance || []).map(itemText).join('；') || '（验收待补）';
  return `场景：${scene}。目标：${goal}。约束：${constraints}。验收：${acceptance}。`;
}

/** 渲染 docs/prd.md（结构固定：元信息、产品结论、用户场景形态、信息架构、边界、验收、MVP、以后再说） */
export function renderPrd(state) {
  const a = state.answers;
  const name = state.projectName || '未命名产品';
  const form = a['S1.3']?.form ? FORM_LABELS[a['S1.3'].form] : '（未选定）';
  const resources = a['S1.2']?.resources || {};
  const acceptance = a['S1.7']?.acceptance || [];
  const mvp = a['S1.7']?.mvp || [];
  const deferred = a['S1.4']?.deferred || [];
  const infoArch = a['S1.5']?.infoArch || [];
  const compliance = a['S1.6']?.compliance || {};
  // 两段式条目的统一读法：不管交上来的是对象还是"入口 → 去向"的一行字，文档都一样渲染
  const pair = (item, keys) => pairText(item, keys).join(' → ');

  return `# ${name} PRD

## 0. 文档元信息

- 文档状态：草稿
- 版本：v0.1
- 最后更新：${state.updatedAt || ''}
- 产品名称：${name}
- 负责人：${a['S1.0']?.audience || '（待定）'}
- 目标读者：产品 / 设计 / 前端 / 测试 / 你自己
- 文档边界：这是 PRD，不是开发任务文档；但要清楚到 AI 或开发能照着实现

---

## 1. 产品结论

### 1.1 核心定位（一句锁死）

\`\`\`text
${a['S1.0']?.oneLiner || '（待补：这个产品为谁、解决什么、靠什么）'}
\`\`\`

### 1.2 明确不做 / 不是什么

${bullet(a['S1.6']?.notDoing, '（待补：至少 1 条边界）')}

### 1.3 核心目标与成功标志

| 目标 | 说明 | 成功标志（可验证） |
|------|------|------------------|
| ${a['S1.4']?.goal || '（待补）'} | 访谈 S1.4 确认的主目标 | ${acceptance.length ? itemText(acceptance[0]) : '（待补）'} |

---

## 2. 用户、场景与形态

### 2.1 目标用户

| 用户类型 | 关注点 | 产品要回答的问题 |
|---------|-------|----------------|
| ${a['S1.0']?.audience || '（待补）'} | ${a['S1.4']?.goal || '（待补）'} | ${a['S1.0']?.oneLiner || '（待补）'} |

### 2.2 关键用户任务

1. ${a['S1.4']?.scene || '（待补：用户进来先干嘛）'}
2. ${infoArch.length ? pair(infoArch[0], ['entry', 'destination']) : '（待补：再干嘛）'}

### 2.3 ★ 形态与资源约束（最关键，别省）

| 项 | 决定 |
|----|------|
| 它活在哪 | ${form} |
| 已有可复用资源 | ${[resources.services, resources.machine].filter(Boolean).join('；') || '（待补）'} |
| 数据存哪、留不留得住 | ${resources.data || '（待补：不存 / 本地文件 / 文件型数据库 / 正经数据库）'} |
| 谁来长期维护 | ${resources.skill || '（待补）'} |
| 预算与按量成本 | ${resources.budget || '（待补）'} |

${a['S1.3']?.formReason ? `> 形态理由：${a['S1.3'].formReason}` : ''}

---

## 3. 信息架构（UI 类产品填）

### 3.1 导航 / 入口

| 入口 | 路由 | 说明 |
|------|------|------|
${table(infoArch, '（无界面或待补）', (item) => `| ${pairText(item, ['entry', 'destination'])[0]} | ${pairText(item, ['entry', 'destination'])[1]} | 访谈 S1.5 确认 |`)}

### 3.2 路由兜底规则

| 输入 | 处理 |
|------|------|
| 空 / 未知路由 | 进入首页 |

### 3.3 页面结构总览

${infoArch.length ? infoArch.map((item) => `- ${pair(item, ['entry', 'destination'])}`).join('\n') : '- （无界面，本节不适用）'}

---

## 5. 链路闭合（无死胡同）

| 入口 | 点击后 |
|------|-------|
${table(infoArch, '（无界面或待补）', (item) => `| ${pairText(item, ['entry', 'destination'])[0]} | ${pairText(item, ['entry', 'destination'])[1]} |`)}

---

## 7. 边界情况与容错

| 情况 | 希望它怎么办 |
|------|------------|
${table(a['S1.4']?.dataJourney, '（待补）', (item) => `| ${pairText(item, ['gap', 'handling'])[0]} | ${pairText(item, ['gap', 'handling'])[1]} |`)}

---

## 8. 内容与合规（如适用）

### 8.1 必须表达

${compliance.must || '（无特别要求）'}

### 8.2 禁止表达

${compliance.forbidden || '（无特别要求；不承诺固定结果、不公开价格等按需补）'}

---

## 9. 验收标准

| 编号 | 验收项 | 通过标准 |
|------|-------|---------|
${acceptance.length ? acceptance.map((item, index) => `| A${index + 1} | ${itemText(item)} | 手动执行后结果与描述一致 |`).join('\n') : '| — | （待补） | — |'}

---

## 10. MVP 完成定义

${mvp.length ? mvp.map((item, index) => `${index + 1}. ${itemText(item)}`).join('\n') : '1. （待补）'}

---

## 11. 以后再说（可扩展项）

| 方向 | 说明 |
|------|------|
${table(deferred, '（暂无）', (item) => `| ${itemText(item)} | 访谈中记录，本期不做 |`)}
`;
}

/** 渲染 docs/项目说明书.md（含四要素需求基准描述与两个保留章节入口） */
export function renderSpec(state) {
  const a = state.answers;
  const name = state.projectName || '未命名产品';
  const tech = [a['S1.8']?.techChoice, a['S1.8']?.techReason].filter(Boolean).join('。');
  const deferred = a['S1.4']?.deferred || [];
  const toLines = (items, mapper) => (Array.isArray(items) && items.length ? items.map(mapper).join('\n') : '');

  return `# ${name} 项目说明书

> 跟着项目一起维护。每次开新对话，先把整份贴给 AI，直接解决"AI 聊久了就忘事"的问题。

---

## 一句话

${a['S1.0']?.oneLiner || '（待补）'}

## 需求基准描述

${baselineDescription(state)}

## 产品思考模块（预留）

后续对齐后再展开。先预留入口，不替代 PRD，不作为开发出口门。

## 选定技术栈

${tech || '（待补：S1.8 技术栈雏形）'}

## 目录结构

（进入开发后补：项目目录树，每个目录一句话说明职责）

## 开发规范要点

（进入正式开发后补：分支策略、日志格式、错误处理、代码风格）

## 安全清单

（进入正式开发后逐条确认：8 条安全基线哪些已做、哪些不适用）

## 部署步骤

（进入上线准备后补：装依赖 → 放文件 → 配置 → 启动 → 看日志 → 更新版本）

## 验收清单

${toLines(a['S1.7']?.acceptance, (item) => `- [ ] ${itemText(item)}`) || '- [ ] （待补）'}

## "以后再说"清单

${toLines(deferred, (item) => `- ${itemText(item)}`) || '- （暂无）'}

## 决策复盘 / 案例库

（遇到矛盾、缺决策、做不出来或方案偏离预期时，解决后按下述格式记录）
- 日期：
- 问题：
- 当时卡在哪里：
- 可选方案：
- 最终决定：
- 代价：
- 下次复用规则：

## 当前进度 / 还剩什么没做

S1 需求对齐：${missingRequired(state).length === 0 ? '必经步骤已完成' : `未完成 ${missingRequired(state).map((n) => n.id).join('、')}`}

## 能用版备份在哪

（有了第一个"确认能正常用"的版本后填写：存在哪个文件夹或哪个提交）

## 我的技术词汇表

（遇到不懂的词，让 AI 一句话解释，记在这里）
`;
}

/**
 * 渲染 docs/开发文档.md（可选）。
 * 访谈阶段只能填到"概述、架构取向、流程、数据、测试计划"这几节，
 * 其余小节留成待补骨架，进入正式开发时再补。
 */
export function renderDevDoc(state) {
  const a = state.answers;
  const name = state.projectName || '未命名产品';
  const toLines = (items, mapper, empty) => (Array.isArray(items) && items.length ? items.map(mapper).join('\n') : empty);
  return `# ${name} 开发文档

## 0. 文档元信息

- 文档状态：草稿
- 版本：v0.1
- 最后更新：${state.updatedAt || ''}
- 产品名称：${name}

## 1. 概述

本期范围：

${toLines(a['S1.7']?.mvp, (item) => `- ${itemText(item)}`, '- （待补）')}

本期不做：

${toLines(a['S1.6']?.notDoing, (item) => `- ${itemText(item)}`, '- （待补）')}

## 2. 总体架构

形态：${a['S1.3']?.form ? FORM_LABELS[a['S1.3'].form] : '（待补）'}

技术取向：${[a['S1.8']?.techChoice, a['S1.8']?.techReason].filter(Boolean).join('。') || '（待补）'}

## 3. 端到端流程

${a['S1.4']?.scene || '（待补）'}

## 4. 模块清单

（进入开发前按功能补齐）

## 5. 目录结构

（进入开发前补齐）

## 6. 数据结构与存储

${a['S1.2']?.resources?.data || '（待补）'}

## 7. 接口约定

（按实际接口补齐）

## 8. 核心算法 / 业务规则

（按实际规则补齐）

## 12. 分阶段里程碑

（按实际排期补齐）

## 13. 开发任务总表

（按实际任务拆分补齐）

## 14. 测试计划

${toLines(a['S1.7']?.acceptance, (item) => `- [ ] ${item}`, '- （待补）')}

## 16. 反馈回路

遇到矛盾、缺决策、做不出来或方案偏离时，先暂停处理；解决后把案例写进项目说明书的「决策复盘 / 案例库」。
`;
}

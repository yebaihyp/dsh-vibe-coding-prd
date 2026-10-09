/**
 * dsh-vibe-coding-prd —— DSH 插件入口（Host 半边）
 *
 * 把"一问一答理需求"做成可执行的流程工具：
 * 模型负责"像产品顾问一样问话"，插件负责"按门推进、账本留痕、把答案落盘成 PRD"。
 *
 * 注册七个面向模型的工具：
 *   interview_start    开场/续接：读账本恢复进度，没有就照模板创建
 *   interview_next     取当前这一问：节点、提问稿、给用户的选项、退出条件
 *   interview_advance  记答案并过门：校验不通过就停在本步并返回缺口清单
 *   interview_skip     跳过可选步骤（必经步骤一律拒绝），理由写进账本
 *   interview_finalize 过出口门自检并落盘 prd.md / 项目说明书.md
 *   interview_status   只读进度查询
 *   interview_ask      把当前这一问直接弹给用户并等待回答
 *
 * 零依赖是刻意的：宿主从安装位置解析 @deepseek-ai/*，工作区里的插件解析不到，
 * 所以这里不导入 defineTool，直接按注册表契约写原生 JSON Schema 的工具定义。
 *
 * 设计取舍见 README.md。
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NODES,
  LIGHT_GROUPS,
  FORM_OPTIONS,
  applyAnswer,
  baselineDescription,
  canSkip,
  checkAcceptance,
  createState,
  exitGateChecks,
  missingRequired,
  nodeById,
  parseLedger,
  renderDevDoc,
  renderLedger,
  renderPrd,
  renderSpec,
  scanEnglish,
  skipStep,
  stepStatus
} from './engine.js';

/** 插件名，用作账本里的路径提示 */
const name = 'vibe-coding-prd';

/** 需要 Host 提供的服务：工具注册表 + 向用户提问的能力 + 技能目录 */
const inject = ['tools', 'userQuestions', 'skills'];

/** 技能内容文件；注册失败不影响工具可用，所以读取是"尽力而为" */
const SKILL_FILE = 'skills/vibe-coding-interview.md';

const LEDGER_PATH = 'docs/进度账本.md';

/**
 * 状态旁挂文件：账本给人看，这份给机器读。
 * 账本只记"走到哪一步"，访谈收集到的答案量太大，塞进 Markdown 表格会毁掉可读性，
 * 所以答案单独存一份 JSON。账本丢了还能重建流程，答案丢了就得重问——这是取舍。
 */
const STATE_PATH = 'docs/.vibe-coding-prd-state.json';

const MODE_LABELS = { light: '轻', heavy: '重' };

/** 本地日期，形如 2026-02-14 */
function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 解析工作目录：显式传入优先，否则用宿主进程的当前目录 */
function workspaceDir(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return resolve(explicit.trim());
  return resolve(process.cwd());
}

function ledgerFile(dir) {
  return join(dir, 'docs', '进度账本.md');
}

function stateFile(dir) {
  return join(dir, 'docs', '.vibe-coding-prd-state.json');
}

/** 读账本：不存在返回 null */
async function readLedger(dir) {
  try {
    return await readFile(ledgerFile(dir), 'utf8');
  } catch {
    return null;
  }
}

/** 读状态旁挂文件：不存在或损坏都返回 null，由账本兜底 */
async function readStateFile(dir) {
  try {
    const raw = await readFile(stateFile(dir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.steps || !parsed.answers) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写文本文件，保证目录存在、LF 行尾、UTF-8 无 BOM */
async function writeTextFile(path, content) {
  await mkdir(join(path, '..'), { recursive: true });
  const normalized = String(content).replace(/\r\n/g, '\n');
  await writeFile(path, normalized, { encoding: 'utf8' });
  return path;
}

/** 从账本 + 状态旁挂文件恢复；两者都没有时返回全新状态 */
async function loadState(dir, projectName) {
  const saved = await readStateFile(dir);
  if (saved) {
    if (projectName && !saved.projectName) saved.projectName = projectName;
    if (!saved.updatedAt) saved.updatedAt = today();
    return saved;
  }
  // 旁挂文件缺失（例如用户手动清过 docs/）：退回只认账本里的流程进度
  const text = await readLedger(dir);
  const parsed = text ? parseLedger(text) : null;
  const state = parsed || createState(projectName);
  if (projectName && !state.projectName) state.projectName = projectName;
  if (!state.updatedAt) state.updatedAt = today();
  return state;
}

/** 写回账本与状态旁挂文件 */
async function saveState(dir, state) {
  state.updatedAt = today();
  await writeTextFile(stateFile(dir), `${JSON.stringify(state, null, 2)}\n`);
  const path = await writeTextFile(ledgerFile(dir), renderLedger(state));
  return path;
}

/** 当前步骤的进度摘要 */
function progressOf(state) {
  const done = NODES.filter((node) => stepStatus(state, node.id) === '✅').length;
  const skipped = state.skipped.length;
  return { done, skipped, total: NODES.length };
}

/** 轻模式下的合并分组：返回当前步骤所在组的步骤 id 列表 */
function groupOf(mode, stepId) {
  if (mode !== 'light') return [stepId];
  const group = LIGHT_GROUPS.find((ids) => ids.includes(stepId));
  return group ? [...group] : [stepId];
}

/** 把节点整理成给模型看的提问简报 */
function brief(state, node) {
  const record = state.steps[node.id] || {};
  const collect = (key) => {
    const fromAnswers = state.answers[node.id]?.[key];
    if (fromAnswers !== undefined) return fromAnswers;
    if (node.id === 'S1.4' && key === 'deferred') return state.answers.deferred;
    return undefined;
  };
  const collected = {};
  for (const field of node.fields) {
    const value = collect(field.key);
    if (value !== undefined) collected[field.key] = value;
  }
  const group = groupOf(state.mode, node.id);
  return {
    stage: 'S1 需求对齐',
    step: node.id,
    stepName: node.name,
    required: node.required,
    mode: state.mode ? MODE_LABELS[state.mode] : '待判定',
    status: record.status || '⬜',
    canSkip: canSkip(node),
    header: node.header,
    ask: node.ask,
    guidance: node.guidance,
    fields: node.fields.map((field) => ({
      key: field.key,
      label: field.label,
      hint: field.hint,
      required: field.required !== false && field.optional !== true,
      ...(field.enum ? { allowed: field.enum } : {}),
      ...(field.itemShape ? { itemShape: field.itemShape } : {}),
      ...(field.minChars ? { minChars: field.minChars } : {}),
      ...(field.minItems ? { minItems: field.minItems } : {})
    })),
    ...(node.options ? { options: node.options } : {}),
    exitCondition: node.exit,
    alreadyCollected: collected,
    ...(state.mode === 'light' && group.length > 1
      ? {
          lightGroup: {
            note: '轻模式：这一组可以几步一起问、一次报门；组内每步的退出条件仍要各自满足',
            steps: group.map((id) => `${id} ${nodeById(id).name}`)
          }
        }
      : {}),
    rules: [
      '一次只问一件事（或轻模式下这一组的事），像聊天，别像问卷。',
      '岔路口给建议：给 2-3 个选项 + 推荐一个最简可行的 + 一句话讲清代价，等用户拍板，别把选择甩回去。',
      '能推断的别问：从用户已说的话或常识能推出来的，直接作为推荐默认值让他确认。',
      '先问问题再谈方案；先定约束再定形态，最后才碰技术。',
      '用户说完一段，用三五句话复述"我目前理解到的"，让他随时纠正。',
      '拿到答案后调用 interview_advance 记录；退出条件不满足时它会告诉你还缺什么。'
    ],
    nextAction:
      node.id === 'S1.9'
        ? '先调用 interview_advance 记下产品名称，再调用 interview_finalize 落盘两份文档。'
        : '把上面这一问发给用户（可以用 ask_user_question 让他点选），拿到答案后调用 interview_advance。'
  };
}

/**
 * 把参数说明编译成注册表要的原生 JSON Schema。
 * 宿主自己会做参数校验，所以这里只写结构，不做默认值填充。
 * 注意：对象节点必须显式写 additionalProperties，DSH 的校验器要求它是布尔值。
 */
function objectSchema(properties, required = []) {
  const props = {};
  const req = [...required];
  for (const [key, spec] of Object.entries(properties)) {
    const { required: isRequired, ...rest } = spec;
    props[key] = rest;
    if (isRequired) req.push(key);
  }
  return { type: 'object', additionalProperties: false, properties: props, ...(req.length ? { required: req } : {}) };
}

/**
 * 工具定义：模型看到 JSON 结果，用户看到一行摘要。
 * 摘要只用于展示，可能在"回放"时拿到结构不完整的旧值，所以必须永不抛错。
 * output.schema 留空对象 = 接受任意 JSON 值（DSH 的 DSL 里叫 type:'json'，
 * 但注册表校验的是标准 JSON Schema，不能出现 'json' 这个类型名）。
 */
function tool(definition) {
  const { parameters, required = [], summarize, execute } = definition;
  return {
    name: definition.name,
    description: definition.description,
    parameters: objectSchema(parameters, required),
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: safeSummary(summarize, value) }]
    },
    execute
  };
}

/** 摘要渲染的兜底：任何异常都降级成一行通用文本，绝不把槽位打崩 */
function safeSummary(summarize, value) {
  try {
    const text = summarize(value);
    return typeof text === 'string' && text ? text : '已完成。';
  } catch {
    return '已完成，详情见工具结果。';
  }
}

/** 校验并合并一次答案；返回 { advanced, issues, state, node, next } */
function commitAnswer(state, node, values) {
  const merged = { ...(state.answers[node.id] || {}), ...values };
  if (node.id === 'S1.4' && Array.isArray(merged.deferred)) {
    merged.deferred = [...new Set([...state.answers.deferred || [], ...merged.deferred])];
  }
  const probe = { ...state, answers: { ...state.answers, [node.id]: merged } };
  const issues = [...validate(node, merged)];
  if (node.id === 'S1.8') {
    const joined = `${merged.techChoice || ''} ${merged.techReason || ''}`;
    if (!/(选定|选它|选择)/.test(joined)) {
      issues.push({ field: 'techChoice', severity: 'error', message: 'S1.8 出口门要求写明"选定"了什么方案' });
    }
    if (!/(否决|排除|放弃|不选)/.test(joined)) {
      issues.push({ field: 'techReason', severity: 'error', message: 'S1.8 出口门要求写明"否决"了哪些方案及理由' });
    }
  }
  const blocking = issues.filter((issue) => issue.severity === 'error');
  if (blocking.length) {
    return { advanced: false, issues, state: probe, merged, node };
  }
  const advancedState = applyAnswer(state, node.id, merged, { at: today() });
  return { advanced: true, issues, state: advancedState, merged, node };
}

/** 复用引擎的字段校验：把合并后的答案交给引擎判断 */
function validate(node, merged) {
  const issues = [];
  for (const field of node.fields) {
    const value = merged[field.key];
    issues.push(...validateOne(node, field, value));
  }
  if (node.id === 'S1.7' && Array.isArray(merged.acceptance)) {
    issues.push(...checkAcceptance(merged.acceptance));
  }
  return issues;
}

/** 单字段校验（与 engine.validateAnswer 同规则，这里按合并后的值判断） */
function validateOne(node, field, value) {
  const issues = [];
  const optional = field.optional === true;
  if (value === undefined || value === null || value === '') {
    if (!optional) issues.push({ field: field.key, severity: 'error', message: `${field.label}：还没填（${field.hint}）` });
    return issues;
  }
  if (field.type === 'array') {
    if (!Array.isArray(value) || value.length === 0) {
      if (!optional) issues.push({ field: field.key, severity: 'error', message: `${field.label}：至少要 1 条（${field.hint}）` });
      return issues;
    }
    if (field.minItems && value.length < field.minItems) {
      issues.push({ field: field.key, severity: 'error', message: `${field.label}：至少要 ${field.minItems} 条` });
    }
    value.forEach((item, index) => {
      const text = typeof item === 'string' ? item : JSON.stringify(item);
      if (!text || text.length < 2) {
        issues.push({ field: field.key, severity: 'error', message: `${field.label} 第 ${index + 1} 条太短` });
      }
      if (field.itemShape?.length === 2 && item && typeof item === 'object') {
        const [a, b] = field.itemShape;
        for (const key of [a, b]) {
          if (!item[key] || String(item[key]).length < 2) {
            issues.push({ field: field.key, severity: 'error', message: `${field.label} 第 ${index + 1} 条缺少「${key}」${field.itemHint ? `：${field.itemHint}` : ''}` });
          }
        }
      }
    });
    return issues;
  }
  if (field.type === 'object') {
    if (typeof value !== 'object') {
      issues.push({ field: field.key, severity: 'error', message: `${field.label}：要写成对象（${field.hint}）` });
      return issues;
    }
    for (const key of field.requiredKeys || []) {
      const cell = value[key];
      const text = typeof cell === 'string' ? cell : JSON.stringify(cell ?? '');
      if (!text || text.length < 2) {
        issues.push({
          field: `${field.key}.${key}`,
          severity: 'error',
          message: `${field.label}：缺「${field.properties?.[key]?.label || key}」（${field.properties?.[key]?.hint || ''}）`
        });
      }
    }
    return issues;
  }
  const text = String(value).trim();
  if (field.enum && !field.enum.includes(text)) {
    issues.push({ field: field.key, severity: 'error', message: `${field.label}：只能取 ${field.enum.join(' / ')}` });
  }
  if (field.minChars && text.length < field.minChars) {
    issues.push({ field: field.key, severity: 'error', message: `${field.label}：至少 ${field.minChars} 个字，现在 ${text.length} 个` });
  }
  return issues;
}

/** 向用户直接提问（有答案器时才用；回答会变成一条用户消息） */
async function askUser(ctx, exec, questions) {
  const answer = await ctx.userQuestions.ask({
    questions: questions.map((question) => ({
      id: question.id,
      question: question.question,
      ...(question.header !== undefined ? { header: question.header } : {}),
      ...(question.options !== undefined ? { options: question.options } : {}),
      ...(question.multiSelect !== undefined ? { multiSelect: question.multiSelect } : {})
    })),
    ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
    signal: exec.signal
  });
  return answer.answers.map((item) => ({
    id: item.id,
    selected: [...item.selected],
    ...(item.custom !== undefined ? { custom: item.custom } : {})
  }));
}

/** 技能内容：模块加载时同步读一次；读不到就跳过注册，插件其余功能不受影响 */
function readSkillContent() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, SKILL_FILE), 'utf8');
  } catch {
    return null;
  }
}

const apply = (ctx) => {
  // ---- 0. 把访谈行为规范注册成 Skill，让任何会话都能发现它 ----
  const skillContent = readSkillContent();
  if (skillContent) {
    ctx.skills.register({
      name: 'vibe-coding-interview',
      description:
        '访谈式需求梳理：一次只问一件事、岔路口给建议，把一个说不清需求的人带到一份 AI 能直接照着开工的 PRD。' +
        '用户说"我想做个 XX 但不知道怎么跟 AI 说""帮我理需求""帮我写个 PRD""我有个想法，帮我想清楚再开工"时用它。',
      whenToUse:
        '准备开新项目、却还没把要做什么定清楚时；或需要把模糊想法整理成 docs/prd.md 与 docs/项目说明书.md 时。配合 interview_* 工具使用。',
      content: skillContent,
      invocation: { modelInvocable: true, userInvocable: true }
    });
  }

  // ---- 1. 开场 / 续接 ----
  ctx.tools.register(
    tool({
      name: 'interview_start',
      description:
        '开始或续接一次 vibe-coding-prd 需求访谈。它读 docs/进度账本.md 恢复进度（不存在就照模板创建），并把"当前走到哪一步、下一步做什么"报给你。' +
        '当用户说"我想做个 XX 但不知道怎么跟 AI 说""帮我理需求""帮我写个 PRD""我有个想法，帮我想清楚再开工"，或在准备开新项目却还没定清楚要做什么时，先调用它。',
      parameters: {
        projectName: { type: 'string', description: '产品名称；还不确定就留空，S1.9 落盘时再定' },
        workspace: { type: 'string', description: '项目目录的绝对路径；留空则用当前工作目录' },
        reset: { type: 'boolean', description: 'true 时丢弃已有账本，从头开始一次访谈（默认 false）' }
      },
      summarize: (value) =>
        `访谈已就位：当前 ${value.step} ${value.stepName}（模式 ${value.mode}，进度 ${value.progress.done}/${value.progress.total}）。${value.summary}`,
      async execute(args) {
        const dir = workspaceDir(args.workspace);
        const existing = await readLedger(dir);
        const resumed = Boolean(existing) && args.reset !== true;
        const state = resumed ? await loadState(dir, args.projectName) : createState(args.projectName);
        await saveState(dir, state);
        const node = nodeById(state.step) || NODES[0];
        const missing = missingRequired(state);
        return {
          resumed,
          workspace: dir,
          ledger: `${dir}/${LEDGER_PATH}`.replace(/\\/g, '/'),
          step: state.step,
          stepName: node.name,
          mode: state.mode ? MODE_LABELS[state.mode] : '待判定',
          progress: progressOf(state),
          missingRequired: missing.map((item) => `${item.id} ${item.name}`),
          summary: resumed
            ? `从账本续接，正在进行 ${node.id} ${node.name}。`
            : '账本已初始化到 S1.0，这是第一轮访谈。',
          nextAction: '调用 interview_next 取当前这一问。'
        };
      }
    })
  );

  // ---- 2. 取当前这一问 ----
  ctx.tools.register(
    tool({
      name: 'interview_next',
      description:
        '取出当前这一步的提问稿：要问什么、为什么这么问、给用户哪些选项、退出条件是什么、还缺哪些信息。' +
        '拿到后按 ask 字段把问题发给用户（可以用 interview_ask 直接弹给用户点选），拿到答案再调用 interview_advance 记录。',
      parameters: {
        workspace: { type: 'string', description: '项目目录的绝对路径；留空则用当前工作目录' }
      },
      summarize: (value) => `S1 当前：${value.step} ${value.stepName}｜要问：${value.header}｜退出条件：${value.exitCondition}`,
      async execute(args) {
        const dir = workspaceDir(args.workspace);
        const state = await loadState(dir);
        const node = nodeById(state.step);
        if (!node) {
          return { finished: true, message: '十步访谈已全部走完。调用 interview_finalize 落盘并过出口门。' };
        }
        return { finished: false, ...brief(state, node) };
      }
    })
  );

  // ---- 3. 记答案并过门 ----
  ctx.tools.register(
    tool({
      name: 'interview_advance',
      description:
        '把刚问到的答案记进当前步骤，并判断退出条件是否满足。' +
        'values 是"字段名 → 内容"的对象，字段名取 interview_next 返回的 fields[].key；用户只答了一部分也可以提交，未满足的退出条件会以 gaps 返回——此时流程停在本步，绝不跳步。' +
        '敏感信息（密钥、密码、token）不要写进这里，账本和文档都会被落盘。',
      parameters: {
        values: { type: 'object', additionalProperties: true, required: true, description: '本步的答案对象，例如 {"oneLiner":"给不会写代码的人做竞品调研的小工具","audience":"我自己"}' },
        note: { type: 'string', description: '可选：给账本备注或用户原话摘要' },
        workspace: { type: 'string', description: '项目目录的绝对路径；留空则用当前工作目录' }
      },
      summarize: (value) =>
        value.advanced
          ? `已过门：${value.step} ${value.stepName} ✅，下一步 ${value.next?.step || '访谈结束'}。`
          : `未过门：${value.step} 还缺 ${value.gaps.length} 项，流程停在本步。`,
      async execute(args) {
        const dir = workspaceDir(args.workspace);
        const state = await loadState(dir);
        const node = nodeById(state.step);
        if (!node) return { advanced: false, message: '十步已走完，请改用 interview_finalize。' };
        if (!args.values || typeof args.values !== 'object') {
          return { advanced: false, step: node.id, gaps: [{ message: 'values 必须是一个对象，字段名取 interview_next 的 fields[].key' }] };
        }
        if (node.id === 'S1.9' && args.values.projectName) state.projectName = String(args.values.projectName).trim();

        const result = commitAnswer(state, node, args.values);
        const nextState = result.state;
        if (args.note) nextState.notes = String(args.note).slice(0, 200);
        await saveState(dir, nextState);

        const nextNode = nodeById(nextState.step);
        const payload = {
          advanced: result.advanced,
          step: node.id,
          stepName: node.name,
          recorded: Object.keys(result.merged),
          issues: result.issues,
          gaps: result.issues.filter((issue) => issue.severity === 'error'),
          warnings: result.issues.filter((issue) => issue.severity === 'warning'),
          ledger: `${dir}/${LEDGER_PATH}`.replace(/\\/g, '/'),
          progress: progressOf(nextState),
          next: nextNode ? { step: nextNode.id, stepName: nextNode.name } : null
        };
        if (result.advanced) {
          payload.message =
            node.id === 'S1.9'
              ? 'S1 十步已全部过门。调用 interview_finalize 落盘两份文档并过出口门。'
              : `已过门。下一步：调用 interview_next 取 ${nextNode.id} ${nextNode.name} 的提问稿。`;
        } else {
          payload.message = `退出条件未满足，停在本步。补问这些缺口后再次调用 interview_advance：${payload.gaps.map((g) => g.message).join('；')}`;
        }
        return payload;
      }
    })
  );

  // ---- 4. 跳过可选步骤 ----
  ctx.tools.register(
    tool({
      name: 'interview_skip',
      description:
        '跳过当前这个可选步骤，并把理由写进账本"跳步留痕"。' +
        '只有 required=false 的步骤可以跳（S1.5 信息架构、S1.8 技术栈雏形），必经步骤一律拒绝；理由必须具体，例如"纯脚本，无界面"。',
      parameters: {
        reason: { type: 'string', required: true, description: '跳步理由，至少 4 个字，会原样写进账本' },
        workspace: { type: 'string', description: '项目目录的绝对路径；留空则用当前工作目录' }
      },
      summarize: (value) => (value.skipped ? `已跳过 ${value.step} ${value.stepName}：${value.reason}` : `不能跳过：${value.message}`),
      async execute(args) {
        const dir = workspaceDir(args.workspace);
        const state = await loadState(dir);
        const node = nodeById(state.step);
        if (!node) return { skipped: false, message: '十步已走完，请改用 interview_finalize。' };
        if (!canSkip(node)) {
          return {
            skipped: false,
            step: node.id,
            stepName: node.name,
            message: `${node.id} ${node.name} 是必经步骤（required=true），不允许跳过。必须问出答案：${node.exit}`
          };
        }
        const nextState = skipStep(state, node.id, args.reason, { at: today() });
        await saveState(dir, nextState);
        const nextNode = nodeById(nextState.step);
        return {
          skipped: true,
          step: node.id,
          stepName: node.name,
          reason: args.reason,
          next: nextNode ? { step: nextNode.id, stepName: nextNode.name } : null,
          message: `已跳过并在账本留痕。下一步：调用 interview_next 取 ${nextNode?.id} ${nextNode?.name}。`
        };
      }
    })
  );

  // ---- 5. 出口门自检 + 落盘 ----
  ctx.tools.register(
    tool({
      name: 'interview_finalize',
      description:
        '执行 S1 出口门自检并落盘 docs/prd.md 与 docs/项目说明书.md（可选 docs/开发文档.md）。' +
        '自检逐项返回 pass/fail：必经步骤是否全过、元信息与版本、核心定位、明确不做、形态、可验证验收、无占位符、无英文正文、无敏感信息。' +
        '只要还有 error 级未通过，就不会写文件——先把缺口补上再来。落盘成功后提示用户可以进入 S2 架构选型，或提议生成 HTML 原型。',
      parameters: {
        projectName: { type: 'string', description: '产品名称；已在 S1.9 记过就不用再传' },
        includeDevDoc: { type: 'boolean', description: '是否同时产出 docs/开发文档.md（进入正式开发时用，默认 false）' },
        workspace: { type: 'string', description: '项目目录的绝对路径；留空则用当前工作目录' }
      },
      summarize: (value) =>
        value.written
          ? `出口门通过，已落盘：${value.files.map((file) => file.split('/').pop()).join('、')}`
          : `出口门未通过，未写任何文件。待补：${value.blocking.map((item) => item.label).join('；')}`,
      async execute(args) {
        const dir = workspaceDir(args.workspace);
        const state = await loadState(dir, args.projectName);
        if (args.projectName) state.projectName = String(args.projectName).trim();

        const checks = exitGateChecks(state);
        const blocking = checks.filter((item) => !item.ok);
        if (blocking.length) {
          return {
            written: false,
            workspace: dir,
            checks,
            blocking,
            message: `出口门未通过，未写任何文件。请补完这些项：${blocking.map((item) => `${item.label}（${item.detail}）`).join('；')}`
          };
        }

        const prdPath = join(dir, 'docs', 'prd.md');
        const specPath = join(dir, 'docs', '项目说明书.md');
        // 出口门已过：账本阶段推进到 S2，下次续接时状态一目了然
        state.stage = 'S2';
        state.stageName = '架构选型';
        state.notes = 'S1 出口门已过，可进入 S2 架构选型';
        const files = [];
        await writeTextFile(prdPath, renderPrd(state));
        files.push(prdPath.replace(/\\/g, '/'));
        await writeTextFile(specPath, renderSpec(state));
        files.push(specPath.replace(/\\/g, '/'));
        if (args.includeDevDoc === true) {
          const devPath = join(dir, 'docs', '开发文档.md');
          await writeTextFile(devPath, renderDevDoc(state));
          files.push(devPath.replace(/\\/g, '/'));
        }
        await saveState(dir, state);

        const english = scanEnglish(renderPrd(state)) || scanEnglish(renderSpec(state));
        return {
          written: true,
          workspace: dir,
          files,
          checks,
          blocking: [],
          ...(english ? { review: `建议复核疑似英文正文：${english}` } : {}),
          baseline: baselineDescription(state),
          declaration:
            '✅ S1 出口门通过：prd.md / 项目说明书.md 已写、账本 S1 已标完成、无占位符、格式合规。',
          nextAction:
            '向用户报出口门结论，并主动提议下一步："要不要我先生成一个能点的 HTML 原型？你点一遍，往往能发现一堆现在没想到的需求。"'
        };
      }
    })
  );

  // ---- 6. 只读进度查询（供 UI 与快速回顾共用） ----
  ctx.tools.register(
    tool({
      name: 'interview_status',
      description:
        '只读查看当前访谈进度：模式、每一步的状态、跳步留痕、阻塞项、还缺什么。' +
        '不改任何文件。用户问"我们走到哪了""还剩什么"时用它回答。',
      parameters: {
        workspace: { type: 'string', description: '项目目录的绝对路径；留空则用当前工作目录' }
      },
      summarize: (value) => `访谈进度：${value.step} ${value.stepName}（${value.progress.done}/${value.progress.total} 完成）`,
      async execute(args) {
        const dir = workspaceDir(args.workspace);
        const state = await loadState(dir);
        const node = nodeById(state.step);
        return {
          workspace: dir,
          projectName: state.projectName || null,
          mode: state.mode ? MODE_LABELS[state.mode] : '待判定',
          step: state.step,
          stepName: node ? node.name : '已完成',
          progress: progressOf(state),
          steps: NODES.map((item) => ({
            step: item.id,
            name: item.name,
            required: item.required,
            status: stepStatus(state, item.id),
            ...(state.steps[item.id]?.reason ? { reason: state.steps[item.id].reason } : {})
          })),
          skipped: state.skipped.map((item) => `${item.step}：${item.reason}`),
          blocks: state.blocks,
          missingRequired: missingRequired(state).map((item) => `${item.id} ${item.name}`),
          collectable: {
            deferred: state.answers.deferred || [],
            forms: FORM_OPTIONS
          }
        };
      }
    })
  );

  // ---- 7. 可选的用户交互：把这一问直接弹给用户 ----
  ctx.tools.register(
    tool({
      name: 'interview_ask',
      description:
        '把当前这一步的问题直接弹给用户并等待他回答（走 Harness 的提问通道，答案会作为用户消息回到对话里）。' +
        '比让模型自己复述问题更省事：选项会渲染成可点按钮。用户回答后再调用 interview_advance 记录。' +
        '一次只弹一个问题；只有确实需要用户点选或填空时才用。',
      parameters: {
        question: { type: 'string', required: true, description: '要问用户的问题，用大白话，别用内部术语' },
        header: { type: 'string', description: '可选短标题，例如"它活在哪"' },
        options: {
          type: 'array',
          description: '可选选项；推荐项放第一个并在标签后加"（推荐）"',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string', description: '选项短标签' },
              description: { type: 'string', description: '一句话说明代价或影响' }
            },
            required: ['label']
          }
        },
        multiSelect: { type: 'boolean', description: '是否允许多选，默认单选' }
      },
      summarize: (value) => `用户回答：${JSON.stringify(value.answer)}`,
      async execute(args, exec) {
        const answers = await askUser(ctx, exec, [
          {
            id: 'q1',
            question: args.question,
            ...(args.header !== undefined ? { header: args.header } : {}),
            ...(Array.isArray(args.options) ? { options: args.options.map((option) => ({ ...option })) } : {}),
            ...(args.multiSelect !== undefined ? { multiSelect: args.multiSelect } : {})
          }
        ]);
        const answer = answers[0] || { selected: [] };
        return {
          question: args.question,
          answer,
          hint: '拿到答案后调用 interview_advance，把答案填进当前步骤对应字段。'
        };
      }
    })
  );
};

export { apply, inject, name };

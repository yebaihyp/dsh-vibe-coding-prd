/**
 * 工具层集成测试（不装进 profile，也不需要活着的 Agent）
 *
 * 用一个假 ctx 收集插件注册的工具，然后照真实调用顺序点一遍：
 *   interview_start → interview_next → interview_advance → … → interview_finalize
 *
 * 重点验证三条只有真跑才看得见的约束：
 * 1. 退出条件不满足时，流程必须停在本步（advanced=false，不能跳步）。
 * 2. 必填步骤不能跳过；可选步骤跳了必须留痕。
 * 3. 出口门没过时，一个文件都不许写；过了才落盘，且产物无占位符。
 *
 * 运行：node test/tools.test.mjs
 *
 * 插件本体零依赖（不导入 @deepseek-ai/*），所以裸 Node 就能直接加载。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

let passed = 0;
const failures = [];

async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${label}`);
  } catch (error) {
    failures.push(`${label} → ${error.message}`);
    console.log(`  ❌ ${label}\n     ${error.message}`);
  }
}

/** 假 ctx：只实现插件 inject 需要的三个服务 */
function fakeContext() {
  const registry = new Map();
  const asked = [];
  const skills = [];
  const ctx = {
    tools: {
      register(definition) {
        registry.set(definition.name, definition);
        return () => registry.delete(definition.name);
      }
    },
    userQuestions: {
      async ask(request) {
        asked.push(request);
        return { answers: request.questions.map((question) => ({ id: question.id, selected: [], custom: '用一个能跑通的最简方案' })) };
      }
    },
    skills: {
      register(skill) {
        skills.push(skill);
        return () => {};
      }
    }
  };
  return { ctx, registry, asked, skills };
}

/** 按定义调用一个工具（模拟工具分发：校验做最小化，重活交给 execute） */
async function call(registry, toolName, args, exec = { agent: { id: 'session-test' }, callId: 'call-1', signal: undefined }) {
  const definition = registry.get(toolName);
  assert.ok(definition, `工具未注册：${toolName}`);
  return definition.execute(args, exec);
}

const GOOD = {
  'S1.0': { oneLiner: '给不写代码的人做竞品调研，把公开信息抓成一份对比报告', audience: '我自己' },
  'S1.1': { mode: 'light' },
  'S1.2': {
    resources: {
      machine: '只有自己的电脑，不长期开机',
      skill: '不会写代码，全靠 AI，愿意长期维护',
      services: '有一个 AI 接口 key',
      budget: '每月不超过 20 元',
      data: '只出报告文件，不涉及别人的个人信息'
    }
  },
  'S1.3': { form: 'local-script', formReason: '没有常开服务器，本地双击运行最省心' },
  'S1.4': {
    scene: '每进一个新方向手动跑一次，一次 5 个竞品',
    goal: '拿到含定价、功能、动态、评价四列的对比表',
    constraints: '不写代码、本地能跑、控成本、只抓公开信息',
    dataJourney: [{ gap: '某竞品抓不到内容', handling: '跳过并在报告里标注未获取' }],
    deferred: ['把历史报告存下来做变化对比']
  },
  'S1.6': { notDoing: ['本期不做登录和多协作'] },
  'S1.7': {
    acceptance: ['当我填入 5 个竞品链接并点击生成，则在 60 秒内出现一份含四列的对比表'],
    mvp: ['能对 5 个竞品跑通一次并导出报告']
  },
  'S1.8': {
    techChoice: '选定一个本地 Python 脚本',
    techReason: '选它因为 AI 写通概率高；否决了常开服务器方案，因为我养不起'
  },
  'S1.9': { projectName: '竞品调研助手' }
};

const workspace = await mkdtemp(join(tmpdir(), 'vibe-prd-test-'));
console.log(`临时工作目录：${workspace}\n`);

const { ctx, registry, asked, skills } = fakeContext();
apply(ctx);

console.log('[1] 注册与开场');
await check('插件注册了 7 个访谈工具', () => {
  const names = [...registry.keys()].sort();
  assert.deepEqual(names, [
    'interview_advance',
    'interview_ask',
    'interview_finalize',
    'interview_next',
    'interview_skip',
    'interview_start',
    'interview_status'
  ]);
});
await check('同时注册了一个可被发现的访谈技能', () => {
  assert.equal(skills.length, 1);
  const skill = skills[0];
  assert.equal(skill.name, 'vibe-coding-interview');
  assert.match(skill.description, /PRD/);
  assert.match(skill.content, /七条行为铁律/);
  assert.match(skill.content, /S1\.0 → S1\.9/);
  assert.equal(skill.invocation.modelInvocable, true);
});
await check('每个工具定义都符合宿主注册表的 schema 契约', () => {
  // 宿主 register() 会对 parameters 与 output.schema 跑 assertSupportedJsonSchema：
  // 只认标准 JSON Schema 类型名，且对象节点必须显式声明 additionalProperties。
  const allowed = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
  const walk = (node, path) => {
    if (node === undefined || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== 'object') return;
    if ('type' in node) assert.ok(allowed.has(node.type), `${path}.type 非法：${JSON.stringify(node.type)}`);
    if (node.type === 'object') {
      assert.ok(typeof node.additionalProperties === 'boolean', `${path} 是 object，必须显式写 additionalProperties`);
    }
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  for (const [toolName, definition] of registry) {
    assert.equal(definition.parameters?.type, 'object', `${toolName}.parameters 必须是 object`);
    walk(definition.parameters, `${toolName}.parameters`);
    assert.ok(definition.output && 'schema' in definition.output, `${toolName} 缺少 output.schema`);
    walk(definition.output.schema, `${toolName}.output.schema`);
    assert.equal(typeof definition.output.render, 'function', `${toolName} 缺少 output.render`);
    // 任意字段都能取到字符串，用来确认摘要渲染不会因为字段缺失而抛错
    const probe = new Proxy({}, { get: () => 'X' });
    let summary;
    try {
      summary = definition.output.render({}, probe);
    } catch (error) {
      throw new Error(`${toolName} 的摘要渲染抛错了：${error.message}`);
    }
    assert.ok(Array.isArray(summary) && typeof summary[0]?.text === 'string', `${toolName} 的摘要渲染不是文本块`);
  }
});
await check('interview_start 会在工作目录建出账本', async () => {
  const result = await call(registry, 'interview_start', { workspace });
  assert.equal(result.resumed, false);
  assert.equal(result.step, 'S1.0');
  assert.equal(result.progress.done, 0);
  const ledger = await readFile(join(workspace, 'docs', '进度账本.md'), 'utf8');
  assert.match(ledger, /当前步骤：S1\.0/);
  assert.match(ledger, /S1\.0 破冰 \| 必经 \| ⬜/);
});
await check('再次 interview_start 会从账本续接', async () => {
  const result = await call(registry, 'interview_start', { workspace });
  assert.equal(result.resumed, true);
  assert.match(result.summary, /从账本续接/);
});

console.log('\n[2] 门控：退出条件不满足就停在本步');
await check('答案缺字段时 advanced=false 且列出缺口', async () => {
  await call(registry, 'interview_next', { workspace });
  const result = await call(registry, 'interview_advance', { workspace, values: { oneLiner: GOOD['S1.0'].oneLiner } });
  assert.equal(result.advanced, false);
  assert.ok(result.gaps.length >= 1);
  assert.match(result.gaps.map((gap) => gap.message).join('|'), /谁会用它/);
});
await check('补齐后放行，并推进到 S1.1', async () => {
  const result = await call(registry, 'interview_advance', { workspace, values: GOOD['S1.0'] });
  assert.equal(result.advanced, true);
  assert.equal(result.next.step, 'S1.1');
});
await check('answer 会被合并保存，重进工作目录仍能续上', async () => {
  const status = await call(registry, 'interview_status', { workspace });
  assert.equal(status.step, 'S1.1');
  assert.equal(status.steps[0].status, '✅');
});
await check('必经步骤 S1.1 不允许跳过', async () => {
  const result = await call(registry, 'interview_skip', { workspace, reason: '不想问这个' });
  assert.equal(result.skipped, false);
  assert.match(result.message, /必经步骤/);
});
await check('空话验收标准会被拦下（停在 S1.7）', async () => {
  for (const step of ['S1.1', 'S1.2', 'S1.3', 'S1.4']) {
    const result = await call(registry, 'interview_advance', { workspace, values: GOOD[step] });
    assert.equal(result.advanced, true, `${step} 应当放行：${JSON.stringify(result.gaps)}`);
  }
  const skipped = await call(registry, 'interview_skip', { workspace, reason: '纯脚本，无界面' });
  assert.equal(skipped.skipped, true);
  const boundary = await call(registry, 'interview_advance', { workspace, values: GOOD['S1.6'] });
  assert.equal(boundary.advanced, true);
  const vague = await call(registry, 'interview_advance', { workspace, values: { acceptance: ['系统正常运行'], mvp: ['能跑'] } });
  assert.equal(vague.advanced, false);
  assert.match(vague.gaps.map((gap) => gap.message).join('|'), /空话/);
});

console.log('\n[3] 出口门：没全过就不许写文件');
await check('缺验收标准时 interview_finalize 不写任何文件', async () => {
  const result = await call(registry, 'interview_finalize', { workspace });
  assert.equal(result.written, false);
  assert.ok(result.blocking.length >= 1);
  assert.equal(existsSync(join(workspace, 'docs', 'prd.md')), false);
  assert.equal(existsSync(join(workspace, 'docs', '项目说明书.md')), false);
});
await check('补完验收与 MVP 后，S1.8 的"选定/否决"要求生效', async () => {
  const ok = await call(registry, 'interview_advance', { workspace, values: GOOD['S1.7'] });
  assert.equal(ok.advanced, true);
  const bad = await call(registry, 'interview_advance', {
    workspace,
    values: { techChoice: '本地 Python 脚本', techReason: 'AI 写得好' }
  });
  assert.equal(bad.advanced, false);
  assert.match(bad.gaps.map((gap) => gap.message).join('|'), /选定|否决/);
  const good = await call(registry, 'interview_advance', { workspace, values: GOOD['S1.8'] });
  assert.equal(good.advanced, true);
});
await check('补上产品名称后出口门全过并落盘', async () => {
  const advanced = await call(registry, 'interview_advance', { workspace, values: GOOD['S1.9'] });
  assert.equal(advanced.advanced, true);
  const result = await call(registry, 'interview_finalize', { workspace });
  assert.equal(result.written, true, JSON.stringify(result.blocking));
  assert.equal(result.files.length, 2);
  assert.equal(result.blocking.length, 0);
  assert.match(result.declaration, /S1 出口门通过/);
});
await check('产出的 prd.md 含必备章节且无占位符', async () => {
  const prd = await readFile(join(workspace, 'docs', 'prd.md'), 'utf8');
  for (const heading of ['## 0. 文档元信息', '## 1. 产品结论', '## 2. 用户、场景与形态', '## 9. 验收标准', '## 10. MVP 完成定义', '## 11. 以后再说']) {
    assert.ok(prd.includes(heading), `缺 ${heading}`);
  }
  assert.doesNotMatch(prd, /\{[^}\n]{1,40}\}/);
  assert.doesNotMatch(prd, /\bTODO\b|\bTBD\b|_{3,}/);
  assert.match(prd, /- 产品名称：竞品调研助手/);
});
await check('项目说明书含四要素需求基准描述与两个保留章节', async () => {
  const spec = await readFile(join(workspace, 'docs', '项目说明书.md'), 'utf8');
  assert.match(spec, /场景：.+目标：.+约束：.+验收：/s);
  assert.match(spec, /## 产品思考模块（预留）/);
  assert.match(spec, /## 决策复盘 \/ 案例库/);
});
await check('账本被同步为"已完成、出口门已过"', async () => {
  const ledger = await readFile(join(workspace, 'docs', '进度账本.md'), 'utf8');
  assert.match(ledger, /S1 需求对齐 \| 已完成 \| ✓ 已过/);
  assert.match(ledger, /S1\.5 信息架构 \| 可选 \| ⏭️/);
  assert.match(ledger, /- S1\.5 信息架构：跳过。理由：纯脚本，无界面/);
});
await check('includeDevDoc 打开时额外产出开发文档', async () => {
  const result = await call(registry, 'interview_finalize', { workspace, includeDevDoc: true });
  assert.equal(result.written, true);
  assert.equal(result.files.length, 3);
  const dev = await readFile(join(workspace, 'docs', '开发文档.md'), 'utf8');
  assert.ok(dev.includes('## 0. 文档元信息'));
});

console.log('\n[4] 面向用户的提问通道');
await check('interview_ask 把问题交给 userQuestions 并回传答案', async () => {
  const result = await call(registry, 'interview_ask', {
    question: '它活在哪？',
    header: '形态',
    options: [{ label: '纯前端网页（推荐）', description: '最省心' }, { label: '常开服务器', description: '维护成本高' }]
  });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].questions[0].question, '它活在哪？');
  assert.equal(result.answer.custom, '用一个能跑通的最简方案');
});
await check('多选标记会透传到提问请求', async () => {
  await call(registry, 'interview_ask', { question: '哪些情况下要重试？', multiSelect: true });
  assert.equal(asked[1].questions[0].multiSelect, true);
});

console.log('\n[5] v0.2：工作目录守卫');
const guardRoot = await mkdtemp(join(tmpdir(), 'vibe-prd-guard-'));

await check('拿不到可信项目目录时拒绝执行（不回落到宿主进程当前目录）', async () => {
  const result = await call(registry, 'interview_start', {});
  assert.equal(result.refused, true);
  assert.equal(result.reason, 'needs-workspace');
  assert.equal(result.workspaceSource, 'none');
  assert.match(result.message, /workspace/);
  assert.match(result.message, /不会回落到宿主进程的当前目录/);
});
await check('有会话工作目录时不必显式传 workspace', async () => {
  const sessionDir = join(guardRoot, 'session-project');
  await mkdir(sessionDir, { recursive: true });
  const exec = { agent: { id: 'session-test', session: { header: { cwd: sessionDir } } }, callId: 'call-2' };
  const result = await call(registry, 'interview_start', {}, exec);
  assert.equal(result.resumed, false);
  assert.equal(result.workspaceSource, 'session');
  assert.equal(result.workspace, sessionDir.replace(/\\/g, '/'));
  assert.ok(existsSync(join(sessionDir, 'docs', '进度账本.md')));
});
await check('账本记的工作目录与本次不一致时拒绝续接', async () => {
  const dir = join(guardRoot, 'moved-project');
  await mkdir(join(dir, 'docs'), { recursive: true });
  // 造一份"从别处搬过来"的状态：账本里记的是旧路径
  const moved = {
    version: 2,
    projectName: '搬家前的项目',
    workspace: 'D:\\old-place\\demo',
    stage: 'S1',
    stageName: '需求对齐',
    step: 'S1.3',
    mode: 'light',
    updatedAt: '2026-10-15',
    nextNumber: 4,
    steps: { 'S1.0': { status: '✅', exitOk: true } },
    answers: { 'S1.0': { oneLiner: '给不写代码的人做竞品调研', audience: '我自己' } },
    skipped: [],
    blocks: [],
    terms: [],
    notes: ''
  };
  await writeFile(join(dir, 'docs', '.vibe-coding-prd-state.json'), `${JSON.stringify(moved, null, 2)}\n`, 'utf8');
  const refused = await call(registry, 'interview_start', { workspace: dir });
  assert.equal(refused.refused, true);
  assert.equal(refused.reason, 'workspace-mismatch');
  assert.equal(refused.ledgerWorkspace, 'D:\\old-place\\demo');
  assert.match(refused.message, /另一个工作目录/);

  const adopt = await call(registry, 'interview_start', { workspace: dir, adoptWorkspace: true });
  assert.equal(adopt.resumed, true);
  assert.equal(adopt.workspaceAdopted, true);
  assert.match(adopt.confirm, /搬家前的项目/);
  const status = await call(registry, 'interview_status', { workspace: dir });
  assert.equal(status.workspaceMismatch, undefined);
});

console.log('\n[6] v0.2：分步提交（报告 2.8-B）');
await check('interview_next 给出分批计划', async () => {
  const dir = join(guardRoot, 'stepwise');
  await call(registry, 'interview_start', { workspace: dir, projectName: '分步提交项目' });
  for (const step of ['S1.0', 'S1.1', 'S1.2', 'S1.3']) {
    const result = await call(registry, 'interview_advance', { workspace: dir, values: GOOD[step] });
    assert.equal(result.advanced, true, `${step} 应当放行：${JSON.stringify(result.gaps)}`);
  }
  const brief = await call(registry, 'interview_next', { workspace: dir });
  assert.equal(brief.step, 'S1.4');
  assert.ok(brief.submissionPlan.batches.length >= 2, 'S1.4 的字段应当被切成多批');
  assert.ok(brief.submissionPlan.batches[0].fields.length <= 3);
  assert.deepEqual(brief.stillMissing, ['scene', 'goal', 'constraints', 'dataJourney']);
  assert.match(brief.submissionRule, /分步提交/);
});
await check('只交一个字段也能落盘，并指出下一批交什么', async () => {
  const dir = join(guardRoot, 'stepwise');
  const first = await call(registry, 'interview_advance', { workspace: dir, values: { scene: GOOD['S1.4'].scene } });
  assert.equal(first.advanced, false);
  assert.equal(first.saved, true);
  assert.deepEqual(first.submitted, ['scene']);
  assert.ok(first.stillMissing.includes('goal'));
  assert.ok(first.submissionPlan.batches[0].fields.length <= 3);
  assert.match(first.message, /下一次只交这批/);

  const second = await call(registry, 'interview_advance', {
    workspace: dir,
    values: { goal: GOOD['S1.4'].goal, constraints: GOOD['S1.4'].constraints }
  });
  assert.equal(second.advanced, false);
  assert.deepEqual(second.stillMissing, ['dataJourney']);

  // 中间态确实落了盘：重新取这一步时，前面交的字段还在
  const again = await call(registry, 'interview_next', { workspace: dir });
  assert.equal(again.alreadyCollected.scene, GOOD['S1.4'].scene);
  assert.equal(again.alreadyCollected.goal, GOOD['S1.4'].goal);

  const third = await call(registry, 'interview_advance', {
    workspace: dir,
    values: { dataJourney: GOOD['S1.4'].dataJourney, deferred: GOOD['S1.4'].deferred }
  });
  assert.equal(third.advanced, true, JSON.stringify(third.gaps));
  assert.equal(third.next.step, 'S1.5');
});
await check('一次交太多字段：答案照收，但会给分步提交的提醒', async () => {
  const dir = join(guardRoot, 'oversized');
  await call(registry, 'interview_start', { workspace: dir });
  const result = await call(registry, 'interview_advance', {
    workspace: dir,
    values: { oneLiner: GOOD['S1.0'].oneLiner, audience: GOOD['S1.0'].audience, extraA: 'x', extraB: 'y' }
  });
  assert.equal(result.advanced, true);
  assert.equal(result.oversized.fields, 4);
  assert.match(result.warnings.map((item) => item.message).join('|'), /偏大/);
  assert.match(result.message, /分步提交/);
});

console.log('\n[7] v0.2：形状与自检不再误伤');

/** 在指定目录里把十步跑完（可覆盖某一步的答案），返回落盘结果 */
async function runFullInterview(dir, overrides = {}) {
  const values = { ...GOOD, ...overrides };
  await call(registry, 'interview_start', { workspace: dir, projectName: values['S1.9'].projectName });
  for (const step of ['S1.0', 'S1.1', 'S1.2', 'S1.3', 'S1.4']) {
    const result = await call(registry, 'interview_advance', { workspace: dir, values: values[step] });
    assert.equal(result.advanced, true, `${step} 应当放行：${JSON.stringify(result.gaps)}`);
  }
  await call(registry, 'interview_skip', { workspace: dir, reason: '纯脚本，无界面' });
  const boundary = await call(registry, 'interview_advance', { workspace: dir, values: values['S1.6'] });
  assert.equal(boundary.advanced, true, `S1.6 应当放行：${JSON.stringify(boundary.gaps)}`);
  const accept = await call(registry, 'interview_advance', { workspace: dir, values: values['S1.7'] });
  assert.equal(accept.advanced, true, `S1.7 应当放行：${JSON.stringify(accept.gaps)}`);
  await call(registry, 'interview_skip', { workspace: dir, reason: '本地脚本，不需要额外技术栈' });
  const named = await call(registry, 'interview_advance', { workspace: dir, values: values['S1.9'] });
  assert.equal(named.advanced, true, `S1.9 应当放行：${JSON.stringify(named.gaps)}`);
  return call(registry, 'interview_finalize', { workspace: dir });
}

const shapeDir = join(guardRoot, 'shape');
await check('{item:"…"} 形状的答案能过门，文档里不出现 [object Object]', async () => {
  const result = await runFullInterview(shapeDir, {
    'S1.6': { notDoing: [{ item: '本期不做登录和多人协作' }] },
    'S1.7': {
      acceptance: [{ item: GOOD['S1.7'].acceptance[0] }],
      mvp: [{ item: GOOD['S1.7'].mvp[0] }]
    }
  });
  assert.equal(result.written, true, JSON.stringify(result.blocking));
  const prd = await readFile(join(shapeDir, 'docs', 'prd.md'), 'utf8');
  assert.doesNotMatch(prd, /\[object Object\]|\{"item"/);
  assert.match(prd, /- 本期不做登录和多人协作/);
  assert.match(prd, /\| A1 \| 当我填入 5 个竞品链接并点击生成/);
});
await check('账本里记下了工作目录', async () => {
  const ledger = await readFile(join(shapeDir, 'docs', '进度账本.md'), 'utf8');
  assert.match(ledger, new RegExp(`- 工作目录：${shapeDir.replace(/\\/g, '\\\\')}`));
});

const brandDir = join(guardRoot, 'brand');
await check('三段式英文品牌名不再让出口门误判', async () => {
  const overrides = {
    'S1.7': { acceptance: GOOD['S1.7'].acceptance, mvp: ['Knowledge Graph Platform for Everyone Who Learns'] },
    'S1.9': { projectName: 'Land of Knowledge' }
  };
  const blocked = await runFullInterview(brandDir, overrides);
  assert.equal(blocked.written, false);
  assert.ok(blocked.blocking.some((item) => item.id === 'no-english'));
  assert.match(blocked.message, /terms/);
  // 标题行与正文里的项目名本来就不再误伤；这条不含项目名的长句交给 terms 白名单
  const passed = await call(registry, 'interview_finalize', {
    workspace: brandDir,
    terms: ['Knowledge Graph Platform for Everyone Who Learns']
  });
  assert.equal(passed.written, true, JSON.stringify(passed.blocking));
  assert.ok(passed.terms.includes('Land of Knowledge'));
  assert.ok(passed.terms.includes('Knowledge Graph Platform for Everyone Who Learns'));
});

await rm(guardRoot, { recursive: true, force: true });
await rm(workspace, { recursive: true, force: true });
console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  console.log(failures.map((item) => ` - ${item}`).join('\n'));
  process.exit(1);
}

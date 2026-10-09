/**
 * 引擎端到端自测（脱离 DSH 运行时，直接用 Node 跑）
 *
 * 覆盖四件事：
 * 1. 门控：必填步骤没答完不放行；只有 required=false 能跳，且必须留痕。
 * 2. 校验门：空话验收、太短字段、越权跳步都要被拦下。
 * 3. 账本：渲染 → 解析往返后状态一致（跨会话恢复的依据）。
 * 4. 出口门：三份文档齐备时全过；抽掉关键项时必须报错且不写文件。
 *
 * 运行：node test/engine.test.mjs
 */
import assert from 'node:assert/strict';
import {
  NODES,
  checkAcceptance,
  createState,
  exitGateChecks,
  missingRequired,
  parseLedger,
  renderLedger,
  renderPrd,
  renderSpec,
  skipStep,
  applyAnswer,
  validateAnswer,
  nodeById
} from '../engine.js';

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${label}`);
  } catch (error) {
    const where = String(error.stack || '').split('\n').slice(1, 3).map((line) => line.trim()).join(' ← ');
    failures.push(`${label} → ${error.message}${where ? `\n     调用栈：${where}` : ''}`);
    console.log(`  ❌ ${label}\n     ${error.message}\n     调用栈：${where}`);
  }
}

/** 一份"合格"的访谈答案，用作基准 */
const GOOD = {
  'S1.0': { oneLiner: '给不写代码的产品经理做竞品调研，把公开信息抓成一份对比报告', audience: '我自己，偶尔给同事用' },
  'S1.1': { mode: 'light' },
  'S1.2': {
    resources: {
      machine: '只有自己的 Windows 电脑，不长期开机',
      skill: '不会写代码，全靠 AI，愿意自己长期维护',
      services: '有一个 AI 接口 key，没有服务器和域名',
      budget: '每月不超过 20 元，对按量计费敏感',
      data: '只出报告文件，不长期保存，不涉及别人的个人信息'
    }
  },
  'S1.3': { form: 'local-script', formReason: '没有常开服务器也不想买，本地双击运行最省心' },
  'S1.4': {
    scene: '我每进一个新方向就手动跑一次，一次调研 5 个竞品',
    goal: '拿到一份包含定价、核心功能、最近动态、用户评价要点的对比表',
    constraints: '不写代码、本地能跑、按量成本要可控、只抓公开信息',
    dataJourney: [
      { gap: '某竞品官网抓不到内容', handling: '跳过该竞品并在报告里标注未获取，不中断整轮' },
      { gap: 'AI 总结把价格说错了', handling: '报告里保留原文链接，价格字段旁标注来源' }
    ],
    deferred: ['把历史报告存下来做变化对比']
  },
  'S1.6': {
    notDoing: ['本期不做登录和多人协作', '本期不做定时自动监控'],
    compliance: { must: '报告里标注数据来源与抓取时间', forbidden: '不承诺数据 100% 准确' }
  },
  'S1.7': {
    acceptance: [
      '当我填入 5 个竞品链接并点击生成，则在 60 秒内出现一份含定价、功能、动态、评价四列的对比表',
      '当某个链接抓取失败时，则报告里出现该竞品一行并标注"未获取"'
    ],
    mvp: ['能对 5 个竞品跑通一次并导出 Markdown 报告', '失败的链接不会让整轮中断']
  },
  'S1.8': {
    techChoice: '选定一个本地 Python 脚本 + 文件型数据库按需保存',
    techReason: '选它因为 AI 一次写通概率高、报错能整段复制；否决了常开服务器方案（我养不起）和零代码平台（有订阅费且逻辑一复杂就难维护）'
  },
  'S1.9': { projectName: '竞品调研助手' },
  // 可选步骤在基准场景里按"跳过"处理（覆盖成 null 即跳过）
  'S1.5': null,
  'S1.8': null
};

/** 按顺序把答案灌进状态；某步给 null 表示这一步没答（可选步骤即视为跳出） */
function runInterview(overrides = {}) {
  let state = createState('');
  for (const node of NODES) {
    const values = overrides[node.id] === undefined ? GOOD[node.id] : overrides[node.id];
    if (values === null) continue;
    state = applyAnswer(state, node.id, values, { at: '2026-02-14' });
  }
  state.updatedAt = '2026-02-14';
  return state;
}

console.log('\n[1] 门控：必填步骤不放行、可选步骤可跳且必须留痕');
check('全新状态下 8 个必经步骤都待办', () => {
  const state = createState('');
  assert.equal(missingRequired(state).length, 8);
  assert.equal(NODES.length, 10);
});
check('跳过必经步骤被拒绝', () => {
  const state = createState('');
  assert.throws(() => skipStep(state, 'S1.3', '不想问', {}), /必经步骤/);
});
check('跳过可选步骤但没写理由被拒绝', () => {
  const state = createState('');
  assert.throws(() => skipStep(state, 'S1.5', '', {}), /理由/);
});
check('跳过可选步骤会写进留痕', () => {
  const state = skipStep(createState(''), 'S1.5', '纯脚本，无界面', { at: '2026-02-14' });
  assert.equal(state.steps['S1.5'].status, '⏭️');
  assert.equal(state.skipped[0].step, 'S1.5');
  assert.equal(state.skipped[0].reason, '纯脚本，无界面');
});

console.log('\n[2] 校验门：空话与残缺答案要被拦下');
check('"系统正常"这类空话验收标准被拒绝', () => {
  const issues = checkAcceptance(['系统正常运行']);
  assert.ok(issues.some((issue) => issue.severity === 'error'), '应当报错');
});
check('EARS 格式的验收标准通过', () => {
  const issues = checkAcceptance(['当我填入 5 个竞品链接并点击生成，则在 60 秒内出现一份含四列的对比表']);
  assert.equal(issues.filter((issue) => issue.severity === 'error').length, 0);
});
check('验收标准里掺一句空话也会被抓出来', () => {
  const issues = checkAcceptance([
    '当我填入链接并点击生成，则在 60 秒内出现对比表',
    '页面体验良好'
  ]);
  assert.ok(issues.some((issue) => /空话/.test(issue.message)));
});
check('数据旅程缺口缺少"怎么办"时报错', () => {
  let state = createState('');
  state = applyAnswer(state, 'S1.0', GOOD['S1.0'], {});
  state = applyAnswer(state, 'S1.1', GOOD['S1.1'], {});
  state = applyAnswer(state, 'S1.2', GOOD['S1.2'], {});
  state = applyAnswer(state, 'S1.3', GOOD['S1.3'], {});
  const bad = { ...GOOD['S1.4'], dataJourney: [{ gap: '抓不到网页' }] };
  state = applyAnswer(state, 'S1.4', bad, {});
  // applyAnswer 不做校验（校验在插件层），这里直接验证引擎的校验函数
  const issues = validateAnswer(state, nodeById('S1.4'), bad);
  assert.ok(issues.some((issue) => /缺少「handling」|handling/.test(issue.message)), issues.map((i) => i.message).join('|'));
});
check('产品名称太短会被标记', () => {
  const issues = validateAnswer(createState(''), nodeById('S1.9'), { projectName: 'A' });
  assert.ok(issues.some((issue) => issue.severity === 'error'));
});

console.log('\n[3] 账本：渲染 → 解析往返一致');
check('账本渲染包含模式与全部步骤行', () => {
  const state = runInterview({ 'S1.5': null, 'S1.8': null });
  const text = renderLedger(state);
  assert.match(text, /- 模式：轻/);
  assert.match(text, /S1\.5 信息架构 \| 可选 \| ⬜/);
  assert.match(text, /S1\.0 破冰 \| 必经 \| ✅/);
});
check('用 skipStep 跳过可选步骤后，账本出现留痕行', () => {
  const state = skipStep(runInterview({ 'S1.5': null, 'S1.8': null, 'S1.9': null }), 'S1.5', '纯脚本，无界面', { at: '2026-02-14' });
  const text = renderLedger(state);
  assert.match(text, /S1\.5 信息架构 \| 可选 \| ⏭️/);
  assert.match(text, /- S1\.5 信息架构：跳过。理由：纯脚本，无界面/);
});
check('账本解析回来仍是同一套状态', () => {
  const state = runInterview();
  const restored = parseLedger(renderLedger(state));
  assert.equal(restored.projectName, state.projectName);
  assert.equal(restored.mode, 'light');
  assert.equal(restored.step, state.step);
  assert.equal(restored.steps['S1.7'].status, '✅');
  assert.equal(missingRequired(restored).length, 0);
});
check('已完成的必经步骤再跳一次会被拒绝', () => {
  const state = runInterview();
  assert.equal(state.steps['S1.9'].status, '✅');
  assert.throws(() => skipStep(state, 'S1.9', '已经写完了', {}), /必经步骤/);
});
check('空账本解析返回 null 而不是抛错', () => {
  assert.equal(parseLedger(''), null);
  assert.equal(parseLedger('# 随便一段文字'), null);
});

console.log('\n[4] 出口门：齐备时全过，缺项必须拦住');
check('十步走完时出口门全过', () => {
  const state = runInterview({ 'S1.5': null, 'S1.8': null });
  const checks = exitGateChecks(state);
  const failed = checks.filter((item) => !item.ok);
  assert.equal(failed.length, 0, `未通过：${failed.map((item) => `${item.label}（${item.detail}）`).join('；')}`);
});
check('抽掉"明确不做"后出口门报错', () => {
  const state = runInterview({ 'S1.6': { notDoing: [] } });
  const checks = exitGateChecks(state);
  assert.ok(checks.some((item) => item.id === 'prd-notdoing' && !item.ok));
});
check('验收标准写成空话时出口门报错', () => {
  const state = runInterview({ 'S1.7': { acceptance: ['系统正常'], mvp: ['能跑'] } });
  const checks = exitGateChecks(state);
  assert.ok(checks.some((item) => item.id === 'prd-acceptance' && !item.ok));
});
check('产物里没有占位符残留', () => {
  const state = runInterview({ 'S1.5': null, 'S1.8': null });
  for (const text of [renderPrd(state), renderSpec(state)]) {
    assert.doesNotMatch(text, /\{[^}\n]{1,40}\}/, '出现花括号占位符');
    assert.doesNotMatch(text, /\bTODO\b|\bTBD\b|_{3,}/, '出现 TODO/TBD/下划线占位');
  }
});
check('产物正文是简体中文（未被判为英文正文）', () => {
  const state = runInterview({ 'S1.5': null, 'S1.8': null });
  const checks = exitGateChecks(state);
  const english = checks.find((item) => item.id === 'no-english');
  assert.equal(english.ok, true, english.detail);
});
check('prd.md 结构与 PRD 模板一致（含必备章节）', () => {
  const state = runInterview();
  const prd = renderPrd(state);
  for (const heading of ['## 0. 文档元信息', '## 1. 产品结论', '## 2. 用户、场景与形态', '## 9. 验收标准', '## 10. MVP 完成定义', '## 11. 以后再说']) {
    assert.ok(prd.includes(heading), `缺少章节 ${heading}`);
  }
  assert.match(prd, /- 版本：v0\.1/);
  assert.match(prd, /- 文档状态：草稿/);
  assert.match(prd, /它活在哪 \| 可直接运行的单文件\/脚本/);
});
check('项目说明书含四要素齐全的需求基准描述', () => {
  const state = runInterview();
  const spec = renderSpec(state);
  assert.match(spec, /^## 一句话$/m);
  assert.match(spec, /^## 需求基准描述$/m);
  assert.match(spec, /场景：.+目标：.+约束：.+验收：/s);
  assert.match(spec, /^## 产品思考模块（预留）$/m);
  assert.match(spec, /^## 决策复盘 \/ 案例库$/m);
});
check('无敏感信息（密钥特征）', () => {
  const state = runInterview();
  const checks = exitGateChecks(state);
  assert.equal(checks.find((item) => item.id === 'no-secret').ok, true);
});

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  console.log(failures.map((item) => ` - ${item}`).join('\n'));
  process.exit(1);
}

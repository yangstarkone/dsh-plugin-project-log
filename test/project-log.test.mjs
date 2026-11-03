import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { apply, archiveProjectLog, checkProjectLog, initProjectLog } from '../index.js';

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'dsh-project-log-'));
}

function entry(day, title, extra = '- 结论：测试条目') {
  return [`### ${day} ${title}`, '', extra, ''].join('\n');
}

function buildLog(entries) {
  return [
    '# PROJECT_LOG',
    '',
    '> 测试项目',
    '',
    '## 当前状态',
    '',
    '- 目标：测试',
    '- 最后更新：2026-10-29',
    '',
    '## 待确认问题',
    '',
    '- 无',
    '',
    '---',
    '',
    '## 日志（新→旧，≤10 条）',
    '',
    ...entries,
    '---',
    '',
    '## 归档',
    '',
  ].join('\n');
}

function dates(count) {
  return Array.from({ length: count }, (_, index) => {
    const day = String(28 - (index % 27)).padStart(2, '0');
    return `2026-09-${day}`;
  });
}

test('check accepts a log at the cap and reports entries', () => {
  const root = sandbox();
  try {
    const entries = dates(10).map((day, index) => entry(day, `标题 ${index}`));
    writeFileSync(join(root, 'PROJECT_LOG.md'), buildLog(entries), 'utf8');
    const result = checkProjectLog(root);
    assert.equal(result.ok, true);
    assert.equal(result.entries, 10);
    assert.match(result.report, /entries: 10\/10/);
    assert.match(result.report, /result: OK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check fails an oversized log and a leaked credential', () => {
  const root = sandbox();
  try {
    const entries = dates(11).map((day, index) => entry(day, `标题 ${index}`));
    writeFileSync(join(root, 'PROJECT_LOG.md'), buildLog(entries), 'utf8');
    const result = checkProjectLog(root);
    assert.equal(result.ok, false);
    assert.match(result.report, /log entries = 11, cap = 10/);
    assert.match(result.report, /result: FAIL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const second = sandbox();
  try {
    writeFileSync(join(second, 'PROJECT_LOG.md'), buildLog([entry('2026-09-01', '带密钥', '- 结论：sk-abcdefghijklmnopqrstuvwxyz123456')]), 'utf8');
    const result = checkProjectLog(second);
    assert.equal(result.ok, false);
    assert.match(result.report, /possible OpenAI-style API key/);
  } finally {
    rmSync(second, { recursive: true, force: true });
  }
});

test('archive keeps the newest entries, moves the rest verbatim and indexes topics', () => {
  const root = sandbox();
  try {
    const entries = dates(12).map((day, index) => entry(day, `标题 ${index}`));
    writeFileSync(join(root, 'PROJECT_LOG.md'), buildLog(entries), 'utf8');
    const oldestTwo = entries.slice(10);
    const result = archiveProjectLog(root, { topics: { '标题 10': '部署运维', '标题 11': '数据库' } });
    assert.equal(result.ok, true);
    assert.equal(result.archived, 2);

    const after = readFileSync(join(root, 'PROJECT_LOG.md'), 'utf8');
    assert.match(after, /## 归档/);
    assert.equal((after.match(/^### /gm) ?? []).length, 10);

    const deploy = readFileSync(join(root, 'Project_docs_md', '部署运维', '2026-09.md'), 'utf8');
    const database = readFileSync(join(root, 'Project_docs_md', '数据库', '2026-09.md'), 'utf8');
    assert.ok(deploy.includes(oldestTwo[0].trim()));
    assert.ok(database.includes(oldestTwo[1].trim()));
    assert.match(deploy, /^# 部署运维 · 2026-09/);

    const index = readFileSync(join(root, 'Project_docs_md', 'INDEX.md'), 'utf8');
    assert.ok(index.includes('`部署运维/`'));
    assert.ok(index.includes('`数据库/`'));
    assert.ok(result.backupPath !== undefined && existsSync(result.backupPath));
    assert.equal(checkProjectLog(root).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('archive sends unmapped entries to 杂项 and refuses unsafe topics', () => {
  const root = sandbox();
  try {
    const entries = dates(11).map((day, index) => entry(day, `标题 ${index}`));
    writeFileSync(join(root, 'PROJECT_LOG.md'), buildLog(entries), 'utf8');
    archiveProjectLog(root);
    const misc = readFileSync(join(root, 'Project_docs_md', '杂项', '2026-09.md'), 'utf8');
    assert.ok(misc.includes(entries[10].trim()));

    const unsafe = sandbox();
    try {
      writeFileSync(join(unsafe, 'PROJECT_LOG.md'), buildLog(entries), 'utf8');
      assert.throws(() => archiveProjectLog(unsafe, { topics: { 10: '../evil' } }), /invalid topic/);
      assert.equal(existsSync(join(unsafe, 'PROJECT_LOG.md.tmp')), false);
    } finally {
      rmSync(unsafe, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('archive is a no-op at or below the cap', () => {
  const root = sandbox();
  try {
    const entries = dates(3).map((day, index) => entry(day, `标题 ${index}`));
    writeFileSync(join(root, 'PROJECT_LOG.md'), buildLog(entries), 'utf8');
    const result = archiveProjectLog(root);
    assert.equal(result.archived, 0);
    assert.match(result.report, /nothing to archive/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('init writes the skeleton once and never overwrites', () => {
  const root = sandbox();
  try {
    const first = initProjectLog(root);
    assert.equal(first.ok, true);
    const text = readFileSync(join(root, 'PROJECT_LOG.md'), 'utf8');
    assert.match(text, /## 当前状态/);
    assert.match(text, /## 日志（新→旧，≤10 条）/);
    assert.doesNotMatch(text, /最后更新：<YYYY-MM-DD>/);

    const second = initProjectLog(root);
    assert.equal(second.ok, false);
    assert.match(second.report, /already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auto injection defers to an AGENTS.md that already documents PROJECT_LOG', () => {
  const home = sandbox();
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const noRules = [];
    apply({ systemPrompt: { section: (section) => noRules.push(section) }, tools: { register: () => {} } }, {});
    assert.equal(noRules.length, 1, 'injects when AGENTS.md is absent');

    writeFileSync(join(home, 'AGENTS.md'), '## 项目记忆（PROJECT_LOG.md）\n', 'utf8');
    const withRules = [];
    apply({ systemPrompt: { section: (section) => withRules.push(section) }, tools: { register: () => {} } }, {});
    assert.equal(withRules.length, 0, 'skips when AGENTS.md already mentions PROJECT_LOG');
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});

test('apply registers one tool and, unless disabled, the rules section', () => {
  const sections = [];
  const tools = [];
  const ctx = {
    systemPrompt: { section: (section) => sections.push(section) },
    tools: { register: (tool) => tools.push(tool) },
  };

  apply(ctx, { injectRules: true });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'project-log');
  assert.match(sections[0].text, /PROJECT_LOG\.md/);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'project_log');
  assert.deepEqual(tools[0].parameters.required, ['action']);
  assert.equal(typeof tools[0].execute, 'function');

  const sections2 = [];
  const tools2 = [];
  apply({ systemPrompt: { section: (section) => sections2.push(section) }, tools: { register: (tool) => tools2.push(tool) } }, { injectRules: false });
  assert.equal(sections2.length, 0);
  assert.equal(tools2.length, 1);
});

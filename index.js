#!/usr/bin/env node
/**
 * dsh-plugin-project-log — the PROJECT_LOG.md convention, packaged as a plugin.
 *
 * Why a plugin: the convention itself is just Markdown plus discipline, so it
 * normally travels as an AGENTS.md paragraph copied by hand onto every machine.
 * A plugin can ship that paragraph as a system-prompt section and the three
 * mechanical operations (check / archive / init) as one model tool, so a new
 * machine needs one install and nothing else.
 *
 * Design choices:
 * - No build step and no runtime dependency: plain ESM, Node builtins only.
 *   The same file also works as a profile-local plugin dropped into
 *   `$DSH_HOME/profiles/<profile>/plugins/`, which is useful on the Electron
 *   desktop profile where `dsh plugin` refuses to manage the profile.
 * - The rules section is skipped automatically when `$DSH_HOME/AGENTS.md`
 *   already mentions PROJECT_LOG, so installing this next to an existing
 *   hand-written convention does not duplicate the instructions.
 * - `archive` moves entry blocks verbatim (formatting-only trimming), keeps a
 *   timestamped backup, and never invents content: an unclassified entry lands
 *   in `杂项` instead of failing the whole operation.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const name = 'project-log';
export const inject = ['systemPrompt', 'tools'];

const ARCHIVE_DIR = 'Project_docs_md';
const DEFAULT_KEEP = 10;
const MAX_KEEP = 50;
const MAX_STATUS_LINES = 20;
const MAX_STATUS_LINES_HARD = 25;
const SECTION_ORDER = 8000;
const UNCLASSIFIED_TOPIC = '杂项';

/** Installed as a global prompt section only when the rules are not in AGENTS.md already. */
const RULES = [
  '## 项目记忆（PROJECT_LOG.md）',
  '',
  '项目根有 `PROJECT_LOG.md` 时：接手先读「当前状态」「待确认问题」+ 最近 2~3 条（`read` 带 limit≈120 行，不要通读）；每轮收尾只有出现结论、决策、踩坑或未验证项才更新，用 `edit` 定点改。',
  '',
  '- 新条目录入「## 日志」区最上面，标题 `### YYYY-MM-DD 标题`；「当前状态」覆盖式更新（≤20 条，只写此刻）；「待确认问题」解决后删掉，结论挪进当日日志。',
  '- 日志区最多 10 条。超出时调 `project_log` 工具、`action: "archive"`：最旧的整条原样移到 `Project_docs_md/<主题>/<YYYY-MM>.md`（月份取条目自身日期；主题 2~6 字，拿不准用「杂项」），并更新 `Project_docs_md/INDEX.md`。',
  '- 新项目用 `project_log`、`action: "init"` 建骨架，不自创版式；更新完用 `action: "check"` 自检，`result: OK` 才算过。',
  '- 只写确认过的事实：没跑过测试写“未执行”，没验证写“未验证”，跑不通写“跑不通”；不写密钥、token、凭证，用环境变量名占位。',
].join('\n');

/** Skeleton used by `init`; matches $DSH_HOME/templates/PROJECT_LOG.md. */
const TEMPLATE = [
  '# PROJECT_LOG',
  '',
  '> 本文件是项目的跨会话记忆，供人和 AI agent 共用。',
  '> **读法**：只读「当前状态」「待确认问题」+ 最近 2~3 条日志；用 `read` 带 limit（约前 120 行），不要通读全文。',
  '> **写法**：日志区新条目加在**最上面**（新→旧）；「当前状态」整体**覆盖式更新**（≤20 行，只写“此刻”）；「待确认问题」解决后**删掉并挪进当日日志**。',
  '> **不膨胀**：日志区最多 **10 条**；超出的最旧条目按主题移到 `Project_docs_md/<主题>/<YYYY-MM>.md`（见文末「归档」）。',
  '> **禁止**写入密钥、token、凭证；需要时用环境变量名占位（如 `$DB_PASSWORD`）。',
  '> 未验证的事必须写“未验证”，跑不通必须写“跑不通”，不许留空当作已完成；「最后更新」早于 git 最近一次提交时，当前状态视为过期。',
  '',
  '<!--',
  '以下是骨架。首次为新项目创建本文件时：',
  '1. 删除本注释块和所有占位符；',
  '2. 从下方「条目格式」复制一条，填入本次实际内容；',
  '3. 「当前状态」区只写已经确认过的事实 —— 从 package.json / git log /',
  '   README 里读到的东西要标明来源，没真正跑过测试就写“未执行”。',
  '-->',
  '',
  '## 当前状态',
  '',
  '<!-- 唯一的“活”区，覆盖式更新，≤20 行，永远只描述“此刻” -->',
  '',
  '- 目标：<这个项目要解决什么，一句话>',
  '- 分支/版本：<main @ v0.0.0>',
  '- 能跑通：<`pnpm test` 等；真跑过才写在这里>',
  '- 不能跑通：<以及原因，例如“缺本地 Chrome，环境问题”>',
  '- 未验证：<做了但没验证的，必须写>',
  '- 已知问题：<当前已知缺陷；没有就写“无”>',
  '- 下一步：<下一个会话该干什么，1~3 条>',
  '- 最后验证：<命令 + 结果 + 时间>',
  '- 最后更新：<YYYY-MM-DD>',
  '',
  '## 待确认问题',
  '',
  '<!-- 悬而未决的，附“已问谁/待答复”。有结论后删掉，结论挪进当日日志 -->',
  '',
  '- <问题描述>？（已问 <谁>，待答复）',
  '',
  '---',
  '',
  '## 条目格式',
  '',
  '<!-- 写日志时复制这一段，删掉注释 -->',
  '',
  '### YYYY-MM-DD 一句话标题（动宾短语）',
  '',
  '- 目标：<这次要解决什么>',
  '- 结论：<最终选了什么方案，为什么 —— 只记结论，不记讨论过程>',
  '- 改：<`文件:行` 列表，精确到行>',
  '- 坑：<症状 → 根因 → 绕法。三段齐全才有价值，缺根因等于没写>',
  '- 弯路：<试过什么、为什么失败 —— 最高价值字段，防止下次重走>',
  '- 遗留：<未验证 / 未完成 / 已知缺陷；没有就写“无”>',
  '',
  '---',
  '',
  '## 日志（新→旧，≤10 条）',
  '',
  '---',
  '',
  '## 归档',
  '',
  '<!-- 首次超过 10 条时启用；归档时整条 `### …` 块原样搬运，不改写。 -->',
  '',
  '- 位置：`Project_docs_md/<主题>/<YYYY-MM>.md`（项目根下；`<YYYY-MM>` 按**条目自身日期**归月）。',
  '- 文件：首行 `# <主题> · <YYYY-MM>`，其下条目按**新→旧**排列。',
  '- 主题：2~6 字，按内容归类，如 `部署运维` / `数据库` / `紫鸟接入` / `调研选型` / `杂项`；拿不准用「杂项」。',
  '- 索引：`Project_docs_md/INDEX.md`，一行一个主题，写清目录名 + 一句话范围。',
  '- 时机：更新后日志 >10 条时，从**最旧**一条开始移，直到 ≤10；归档后本文件只留最近 10 条。',
  '- 自检：`node "$DSH_HOME/tools/check-project-log.mjs"`（0 = 通过，1 = 有违规）。',
  '',
].join('\n');

/* ------------------------------------------------------------------ *
 * Shared parsing
 * ------------------------------------------------------------------ */

function analyse(text) {
  const lines = text.split(/\r?\n/);

  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (match) sections.push({ name: match[1], line: i });
  }

  const logIndex = sections.findIndex((section) => section.name.startsWith('日志'));
  if (logIndex < 0) return { lines, sections, logIndex, start: -1, end: -1, blocks: [] };

  const start = sections[logIndex].line;
  const end = logIndex + 1 < sections.length ? sections[logIndex + 1].line : lines.length;

  const raw = [];
  let current = null;
  for (let i = start + 1; i < end; i += 1) {
    if (/^###\s+/.test(lines[i])) {
      if (current !== null) raw.push(current);
      current = [lines[i]];
    } else if (current !== null) {
      current.push(lines[i]);
    }
  }
  if (current !== null) raw.push(current);

  const blocks = raw.map((blockLines) => {
    const body = blockLines.slice();
    // The final `---` before "## 归档" belongs to the document, not the entry.
    while (body.length > 0 && (body[body.length - 1].trim() === '' || body[body.length - 1].trim() === '---')) body.pop();
    const heading = body[0].replace(/^###\s+/, '').trim();
    const date = /^(\d{4}-\d{2})-\d{2}(\s|$)/.exec(heading);
    return {
      heading,
      month: date === null ? '' : date[1],
      text: body.join('\n'),
    };
  });

  return { lines, sections, logIndex, start, end, blocks };
}

function localDate() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stampNow() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function topicIsSafe(topic) {
  return /^[^\\/:*?"<>|\s]{2,12}$/u.test(topic);
}

function backupPathFor(logPath) {
  const base = `${logPath}.bak-archive-${stampNow()}`;
  if (!existsSync(base)) return base;
  for (let index = 1; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot find a free backup path next to ${logPath}`);
}

/* ------------------------------------------------------------------ *
 * check
 * ------------------------------------------------------------------ */

const SECRET_PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key block' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/, label: 'OpenAI-style API key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, label: 'GitHub token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  {
    re: /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*([^\s$<][\x21-\x7e]{15,})/i,
    label: 'inline credential',
  },
];

export function checkProjectLog(root) {
  const logPath = join(root, 'PROJECT_LOG.md');
  if (!existsSync(logPath)) {
    return { ok: true, skipped: true, problems: [], warnings: [], report: `skip: no PROJECT_LOG.md under ${root}` };
  }

  const text = readFileSync(logPath, 'utf8');
  const { lines, sections, logIndex, start, end, blocks } = analyse(text);
  const problems = [];
  const warnings = [];

  if (logIndex < 0) warnings.push('no "## 日志" section found');

  for (const [index, block] of blocks.entries()) {
    if (block.month === '') warnings.push(`entry ${index + 1} does not start with "### YYYY-MM-DD": ${block.heading.slice(0, 60)}`);
  }

  if (blocks.length > DEFAULT_KEEP) {
    problems.push(
      `log entries = ${blocks.length}, cap = ${DEFAULT_KEEP}; archive the oldest blocks into ${ARCHIVE_DIR}/<topic>/<YYYY-MM>.md`,
    );
    if (!existsSync(join(root, ARCHIVE_DIR))) problems.push(`${ARCHIVE_DIR}/ does not exist, so there is nowhere to archive to`);
  }

  const statusIndex = sections.findIndex((section) => section.name.startsWith('当前状态'));
  const statusLines = [];
  if (statusIndex >= 0) {
    const statusStart = sections[statusIndex].line;
    const statusEnd = statusIndex + 1 < sections.length ? sections[statusIndex + 1].line : lines.length;
    for (let i = statusStart + 1; i < statusEnd; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed === '' || trimmed.startsWith('<!--') || trimmed.startsWith('-->')) continue;
      statusLines.push(lines[i]);
    }
  }
  const statusBullets = statusLines.filter((line) => /^\s*[-*]\s+/.test(line));
  if (statusBullets.length > MAX_STATUS_LINES_HARD) {
    problems.push(`current-state bullets = ${statusBullets.length}, hard cap = ${MAX_STATUS_LINES_HARD}`);
  } else if (statusBullets.length > MAX_STATUS_LINES) {
    warnings.push(`current-state bullets = ${statusBullets.length}, over the soft cap ${MAX_STATUS_LINES}`);
  }

  if (!/最后更新[：:]\s*\d{4}-\d{2}-\d{2}/.test(text)) warnings.push('missing "最后更新：YYYY-MM-DD"');

  for (const [index, line] of lines.entries()) {
    for (const { re, label } of SECRET_PATTERNS) {
      if (re.test(line)) problems.push(`possible ${label} on line ${index + 1}`);
    }
  }

  const report = [
    `PROJECT_LOG check: ${logPath}`,
    `  entries: ${blocks.length}/${DEFAULT_KEEP}`,
    `  current-state: ${statusBullets.length} bullets / ${statusLines.length} lines (soft cap ${MAX_STATUS_LINES} bullets)`,
    ...(warnings.length > 0 ? ['warnings:', ...warnings.map((item) => `  - ${item}`)] : []),
    ...(problems.length > 0 ? ['problems:', ...problems.map((item) => `  - ${item}`)] : []),
    `result: ${problems.length === 0 ? 'OK' : 'FAIL'}`,
  ].join('\n');

  return { ok: problems.length === 0, skipped: false, problems, warnings, report, entries: blocks.length, start, end };
}

/* ------------------------------------------------------------------ *
 * archive
 * ------------------------------------------------------------------ */

function resolveTopic(topics, block, index) {
  const byIndex = topics[String(index)];
  if (typeof byIndex === 'string' && byIndex.trim() !== '') return byIndex.trim();
  const byHeading = topics[block.heading];
  if (typeof byHeading === 'string' && byHeading.trim() !== '') return byHeading.trim();
  // A title without its date (`标题` for `2026-09-01 标题`) is the natural key
  // a model supplies, so accept a unique suffix match before falling back.
  const suffix = Object.entries(topics).filter(
    ([key, value]) => key !== String(index) && typeof value === 'string' && value.trim() !== '' && block.heading.endsWith(key.trim()),
  );
  if (suffix.length === 1) return suffix[0][1].trim();
  return UNCLASSIFIED_TOPIC;
}

function writeTopicFile(projectRoot, topic, month, blocks) {
  const directory = join(projectRoot, ARCHIVE_DIR, topic);
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, `${month}.md`);
  const body = blocks.join('\n\n');
  const header = `# ${topic} · ${month}`;

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    const newline = existing.indexOf('\n');
    const existingHeader = (newline < 0 ? existing : existing.slice(0, newline)).trim();
    const existingBody = newline < 0 ? '' : existing.slice(newline + 1).trim();
    writeFileSync(filePath, `${existingHeader}\n\n${body}${existingBody === '' ? '' : `\n\n${existingBody}`}\n`, 'utf8');
  } else {
    writeFileSync(filePath, `${header}\n\n${body}\n`, 'utf8');
  }
  return filePath;
}

function updateIndex(projectRoot, topics) {
  const indexPath = join(projectRoot, ARCHIVE_DIR, 'INDEX.md');
  const lines = topics.map((topic) => `- \`${topic}/\``);

  if (!existsSync(indexPath)) {
    const header = [
      '# 归档索引（Project_docs_md）',
      '',
      '> 本目录存放 `PROJECT_LOG.md` 中超过 10 条的旧条目，按「主题 / 条目月份」存放；日志本身只留最近 10 条。',
      '',
    ].join('\n');
    writeFileSync(indexPath, `${header}${lines.join('\n')}\n`, 'utf8');
    return { path: indexPath, created: true, added: lines.length };
  }

  const existing = readFileSync(indexPath, 'utf8');
  const missing = lines.filter((line) => !existing.includes(line));
  if (missing.length > 0) writeFileSync(indexPath, `${existing.trimEnd()}\n${missing.join('\n')}\n`, 'utf8');
  return { path: indexPath, created: false, added: missing.length };
}

export function archiveProjectLog(root, options = {}) {
  const keep = Number.isInteger(options.keep) ? options.keep : DEFAULT_KEEP;
  if (keep < 1 || keep > MAX_KEEP) throw new Error(`keep must be an integer between 1 and ${MAX_KEEP}`);

  const topics = options.topics !== null && typeof options.topics === 'object' ? options.topics : {};
  const logPath = join(root, 'PROJECT_LOG.md');
  if (!existsSync(logPath)) throw new Error(`missing ${logPath}`);

  const text = readFileSync(logPath, 'utf8');
  const { lines, sections, logIndex, start, blocks } = analyse(text);
  if (logIndex < 0) throw new Error('no "## 日志" section');

  if (blocks.length <= keep) {
    return {
      ok: true,
      archived: 0,
      report: `nothing to archive: ${blocks.length} entries, keep = ${keep}`,
    };
  }

  const archived = blocks.slice(keep).map((block, offset) => {
    const index = keep + offset;
    const topic = resolveTopic(topics, block, index);
    if (!topicIsSafe(topic)) throw new Error(`invalid topic "${topic}" for entry ${index} (2-12 chars, no path separators or spaces)`);
    const month = block.month === '' ? localDate().slice(0, 7) : block.month;
    return { block, topic, month, index };
  });

  const groups = new Map();
  for (const item of archived) {
    const key = `${item.topic}\u0000${item.month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.block.text);
  }

  const backupPath = backupPathFor(logPath);
  copyFileSync(logPath, backupPath);

  const written = [];
  for (const [key, groupBlocks] of groups) {
    const [topic, month] = key.split('\u0000');
    const filePath = writeTopicFile(root, topic, month, groupBlocks);
    written.push(`${ARCHIVE_DIR}/${topic}/${month}.md (${groupBlocks.length}) → ${filePath}`);
  }

  const usedTopics = [...new Set(archived.map((item) => item.topic))];
  const index = updateIndex(root, usedTopics);
  written.push(`${ARCHIVE_DIR}/INDEX.md${index.created ? ' (new)' : index.added > 0 ? ` (+${index.added})` : ' (unchanged)'}`);

  const preamble = lines.slice(0, start + 1).join('\n');
  const kept = blocks.slice(0, keep).map((block) => block.text);
  const archiveSection = [
    '## 归档',
    '',
    `- 旧日志（超过 ${keep} 条的部分）按主题归档在 \`${ARCHIVE_DIR}/\`，索引见 \`${ARCHIVE_DIR}/INDEX.md\`。`,
    `- 最近一次归档：${localDate()}，${archived.length} 条（主题：${usedTopics.join('、')}）。`,
  ].join('\n');

  const nextText = `${preamble}\n\n${kept.join('\n\n')}\n\n---\n\n${archiveSection}\n`;
  const temporary = `${logPath}.tmp`;
  writeFileSync(temporary, nextText, 'utf8');
  renameSync(temporary, logPath);

  return {
    ok: true,
    archived: archived.length,
    backupPath,
    report: [
      `archived ${archived.length} entries, kept ${kept.length}/${keep}`,
      `backup: ${backupPath}`,
      ...written.map((line) => `wrote: ${line}`),
    ].join('\n'),
  };
}

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */

export function initProjectLog(root) {
  const logPath = join(root, 'PROJECT_LOG.md');
  if (existsSync(logPath)) return { ok: false, report: `already exists, not overwritten: ${logPath}` };

  const today = localDate();
  const text = TEMPLATE.replace('最后更新：<YYYY-MM-DD>', `最后更新：${today}`);
  writeFileSync(logPath, text, 'utf8');
  return {
    ok: true,
    report: `created ${logPath}\nnext: replace the placeholders in 「当前状态」, then add the first entry under 「日志」.`,
  };
}

/* ------------------------------------------------------------------ *
 * plugin wiring
 * ------------------------------------------------------------------ */

function shouldInjectRules(mode) {
  if (mode === true) return true;
  if (mode === false) return false;
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  try {
    return !readFileSync(join(home, 'AGENTS.md'), 'utf8').includes('PROJECT_LOG');
  } catch {
    return true;
  }
}

function resolveRoot(input, exec) {
  if (typeof input === 'string' && input.trim() !== '') return resolve(input);
  const cwd = exec?.agent?.session?.header?.cwd;
  return typeof cwd === 'string' && cwd !== '' ? resolve(cwd) : process.cwd();
}

function assertDirectory(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`not a directory: ${root}`);
}

export function apply(ctx, config = {}) {
  const keep = Number.isInteger(config.keep) && config.keep > 0 ? Math.min(config.keep, MAX_KEEP) : DEFAULT_KEEP;

  if (shouldInjectRules(config.injectRules)) {
    const text = typeof config.rules === 'string' && config.rules.trim() !== '' ? config.rules : RULES;
    ctx.systemPrompt.section({ name: 'project-log', order: SECTION_ORDER, text });
  }

  ctx.tools.register({
    name: 'project_log',
    description:
      'Maintain the project PROJECT_LOG.md cross-session memory. action=check validates entry count (cap 10), current-state size, dates and likely secrets; action=archive moves the oldest entries beyond the cap verbatim into Project_docs_md/<topic>/<YYYY-MM>.md, updates Project_docs_md/INDEX.md and keeps a timestamped backup; action=init creates the skeleton for a new project. Use it when updating or auditing PROJECT_LOG.md.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'archive', 'init'],
          description: 'check = validate; archive = move oldest entries beyond the cap; init = create skeleton.',
        },
        root: {
          type: 'string',
          description: 'Project root. Defaults to the session working directory.',
        },
        keep: {
          type: 'integer',
          description: `Entries to keep when archiving (default ${DEFAULT_KEEP}).`,
        },
        topics: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional map from entry index (0 = newest) or exact entry title to a 2-12 character topic. Unmapped entries go to 杂项.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const root = resolveRoot(args.root, exec);
      try {
        if (args.action === 'init') {
          assertDirectory(root);
          return initProjectLog(root).report;
        }
        if (args.action === 'archive') {
          assertDirectory(root);
          if (args.keep !== undefined && (!Number.isInteger(args.keep) || args.keep < 1 || args.keep > MAX_KEEP)) {
            throw new Error(`keep must be an integer between 1 and ${MAX_KEEP}`);
          }
          return archiveProjectLog(root, { keep: args.keep ?? keep, topics: args.topics }).report;
        }
        assertDirectory(root);
        return checkProjectLog(root).report;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}

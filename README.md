# dsh-plugin-project-log

The `PROJECT_LOG.md` project-memory convention for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), packaged as a plugin: **inject the rules once, then check / archive / scaffold logs with one tool.**

Zero dependencies, no build step, MIT.

## Why a plugin

`PROJECT_LOG.md` is just Markdown plus discipline. Without a plugin, every new machine needs three manual copies: the rules paragraph in the global `AGENTS.md`, the log template, and the checker script. This package ships all three:

- the rules arrive as a system-prompt section (skipped automatically when `$DSH_HOME/AGENTS.md` already mentions `PROJECT_LOG`, so nothing is duplicated);
- the template is built in, so `init` produces the canonical skeleton;
- archiving is a deterministic file operation, not something the model has to improvise.

It is not a memory index: there is no database, no embeddings, no background scanning. The output is one human-readable Markdown file you can read, diff, and commit.

## Install

npm / GitHub (CLI profiles):

```bash
dsh plugin --profile web add github:yangstarkone/dsh-plugin-project-log
```

Local checkout:

```bash
dsh plugin --profile web add ./dsh-plugin-project-log
```

`dsh --profile web --dump-config` should show a `# == dsh-plugin-project-log` layer; after restarting a session the system prompt contains the rules and the tool list contains `project_log`.

> **Desktop (Electron)**: `dsh plugin` does not manage the `desktop` profile. Install the same package from the in-app plugin manager, or use the local-plugin route: drop `index.js` at `~/.dsh/profiles/desktop/plugins/project-log.mjs` and add `- insert: [{ id: project-log, name: ./plugins/project-log.mjs }]` to `cordis.patch.yml` (relative to that file).

## What gets injected

Active only when the project root has `PROJECT_LOG.md`:

- read 「当前状态」「待确认问题」 and the newest 2–3 entries first (`read` with `limit` ≈ 120 lines);
- newest entry goes at the top of `## 日志`; current state is rewritten in place (≤20 bullets);
- at most 10 entries — archive the oldest with `project_log` `action: "archive"`;
- run `project_log` `action: "check"` before finishing;
- record only verified facts; never write secrets or tokens.

`injectRules: false` disables the section entirely.

## Tool: `project_log`

| Parameter | Meaning |
|---|---|
| `action` | `check` / `archive` / `init` (required) |
| `root` | project root; defaults to the session working directory |
| `keep` | entries to keep when archiving (default 10) |
| `topics` | optional `{ entry index or title: topic }`; unmapped entries go to `杂项` |

### `check`

Read-only report: entry count (cap 10), current-state bullets (soft 20 / hard 25), entry date format, likely secrets, presence of `最后更新`. Passes only on `result: OK`.

### `archive`

- keeps the newest `keep` entries and moves the rest **verbatim** into `Project_docs_md/<topic>/<YYYY-MM>.md` (month from the entry's own date);
- when appending to an existing month file, newer entries go first;
- updates `Project_docs_md/INDEX.md`, adding only missing topics;
- writes `PROJECT_LOG.md.bak-archive-<YYYYMMDD-HHmmss>` before touching the log;
- topics are 2–12 characters without path separators; unmapped entries become `杂项` instead of failing the run.

### `init`

Writes the built-in skeleton (`当前状态` / `待确认问题` / `条目格式` / `日志` / `归档`) with today's `最后更新`. **Never overwrites an existing log.**

## Configuration

Override the row by id in the profile's `cordis.patch.yml`:

```yaml
- id: project-log
  config:
    injectRules: auto   # auto | true | false
    keep: 10
    # rules: |          # replace the built-in rules text entirely
    #   ...
```

- `auto` (default): inject unless `$DSH_HOME/AGENTS.md` already contains `PROJECT_LOG`;
- `true`: always inject; `false`: never inject.

## Develop

```bash
npm test          # node --test: 7 cases covering check / archive / init / registration
```

`index.js` is both the bundle entry and the local-plugin file; tests import `checkProjectLog`, `archiveProjectLog`, `initProjectLog` directly.

## Non-goals

- does not rewrite entry contents or decide what belongs in the archive — it only moves blocks;
- does not write `$DSH_HOME` or modify `AGENTS.md`;
- does not do semantic retrieval; that is the job of memory-index plugins.

## License

MIT

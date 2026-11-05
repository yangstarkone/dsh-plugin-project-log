# dsh-plugin-project-log

把 `PROJECT_LOG.md` 项目记忆约定做成 DeepSeek Harness（dsh）插件：**自动注入规则 + 一个 `project_log` 工具**，换电脑只装一次，不用再手抄 `AGENTS.md` 段落。

零依赖、无构建步骤、MIT 许可。

## 为什么做成插件

`PROJECT_LOG.md` 本身只是 Markdown + 纪律，原本每台机器都要手动复制三样东西：全局 `AGENTS.md` 里的规则、日志模板、自检脚本。插件把这三样收进一个包：

- 规则以系统提示词段注入（`$DSH_HOME/AGENTS.md` 里已经写了 `PROJECT_LOG` 时自动跳过，不会重复）；
- 模板与校验逻辑内置，`init` 直接生成骨架；
- 归档是确定性的文件操作，不依赖模型即兴发挥。

它和 `dsh-project-memory` 这类记忆插件不是一类东西：这里没有索引库、向量或后台扫描，只有一个**人可以直接读、可以 diff、可以提交进 git** 的 Markdown 文件。

## 安装

npm / GitHub（推荐，CLI profile）：

```bash
dsh plugin --profile web add github:yangstarkone/dsh-plugin-project-log
```

本地 checkout（开发或离线）：

```bash
dsh plugin --profile web add ./dsh-plugin-project-log
```

装完 `dsh --profile web --dump-config` 应能看到 `# == dsh-plugin-project-log` 层，重启会话后系统提示词里出现「项目记忆（PROJECT_LOG.md）」，工具列表里出现 `project_log`。

> **桌面端（Electron）**：`dsh plugin` 不会管理 `desktop` profile，请用应用内的插件管理器安装同一个包；或者按本机已有本地插件的方式，把 `index.js` 放到 `~/.dsh/profiles/desktop/plugins/project-log.mjs`，并在 `cordis.patch.yml` 里插一行 `- insert: [{ id: project-log, name: ./plugins/project-log.mjs }]`（相对路径按该 patch 文件解析）。

## 它注入的规则

只在项目根存在 `PROJECT_LOG.md` 时生效：

- 接手先读「当前状态」「待确认问题」+ 最近 2~3 条，`read` 带 limit ≈ 120 行；
- 新条目录入「## 日志」最上面；「当前状态」覆盖式更新（≤20 条）；
- 日志区最多 10 条，超出用 `project_log` 的 `archive` 归档；
- 收尾用 `project_log` 的 `check` 自检；
- 只写确认过的事实，不写密钥、token、凭证。

`injectRules: false` 可完全关闭注入（例如已有一份自己维护的 `AGENTS.md` 规则）。

## 工具：`project_log`

| 参数 | 说明 |
|---|---|
| `action` | `check` / `archive` / `init`，必填 |
| `root` | 项目根；默认取会话工作目录 |
| `keep` | 归档时保留条数，默认 10 |
| `topics` | 可选，`{ 条目序号或标题: 主题 }`；没映射的进「杂项」 |

### `check`

只读校验并返回报告：日志条数（上限 10）、当前状态条目数（软上限 20 / 硬上限 25）、条目日期格式、疑似密钥、`最后更新` 是否存在。`result: OK` 才算通过。

### `archive`

- 保留最新 `keep` 条，其余**整条原样**搬到 `Project_docs_md/<主题>/<YYYY-MM>.md`（月份取条目自身日期）；
- 同主题同月份追加时，新条目排在最前（新→旧）；
- 更新 `Project_docs_md/INDEX.md`（缺哪个主题补哪行）；
- 改写前先备份为 `PROJECT_LOG.md.bak-archive-<YYYYMMDD-HHmmss>`；
- 主题名限 2~12 字，不能含路径分隔符；未指定主题的条目落到「杂项」，不会因为漏映射而整体失败。

### `init`

按内置模板生成 `PROJECT_LOG.md`（含「当前状态」「待确认问题」「条目格式」「日志」「归档」），`最后更新` 填当天；**已存在则绝不覆盖**。

## 配置

在 profile 的 `cordis.patch.yml` 里按 `id: project-log` 覆盖：

```yaml
- id: project-log
  config:
    injectRules: auto   # auto | true | false
    keep: 10
    # rules: |          # 完全替换内置规则文本
    #   ...
```

- `auto`（默认）：`$DSH_HOME/AGENTS.md` 含 `PROJECT_LOG` 就不注入，否则注入；
- `true`：总是注入；`false`：不注入。

## 开发

```bash
npm test          # node --test，7 个用例：校验/归档/初始化/注册
```

`index.js` 同时是 bundle 入口和本地插件文件；测试直接 import 导出的 `checkProjectLog` / `archiveProjectLog` / `initProjectLog`。

## 不做什么

- 不自动改写日志内容，也不替模型判断哪条该归档——只做机械搬运；
- 不写 `$DSH_HOME`、不碰 `AGENTS.md`；
- 不做语义检索；那是记忆索引插件的职责。

## License

MIT

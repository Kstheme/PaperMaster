# PaperMaster 交付快照

在「主题方法表」中选中要交付的方法行，按需勾选各行的迁移设想，预览并确认。从生成的快照可下载 Markdown 笔记与 JSON。两种文件来自同一次确认，方法表之后的修改通过新快照交付。

## JSON 格式第 1 版

读取端先检查文件顶层的 `schemaVersion`，再取出 `rows`。用 `id` 和 `confirmedAt` 标记本次研究所用的输入。PaperMaster 在本地生成文件，由研究者决定何时交给下游。

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 数据格式版本，当前为 `1` |
| `id`、`confirmedAt` | 快照 UUID 与 ISO 8601 确认时间 |
| `tableId`、`topic` | 来源方法表 UUID 与主题名称 |
| `rows` | 用户确认交付的方法行 |
| `rows[].id`、`relatedId` | 方法行 UUID，以及仅在本快照中也包含关联行时提供的版本关联 |
| `rows[].paper` | 论文标题 `title`、版本名称 `version`、`paperId`、`versionId`，以及可用时的公开论文链接 `url` |
| `rows[].fields` | `name`、`problem`、`pipeline`、`conditions` |
| `rows[].fields.*` | `text` 为内容，`state` 为信息状态，`evidence` 为出处数组 |
| `rows[].idea` | 用户明确选中交付的迁移设想 |
| `rows[].metaMethod` | 带元方法的记录才有。`structuralProblem`、`mechanism`、`conditions` 各含 `text`、`state`、`evidence` |
| `rows[].practice` | 该论文的具体做法。`evidence` 是可回查的出处 |
| `rows[].experiment` | 原论文报告了效果时才有。`metric`、`comparison`、`data`、`result` 的结构与字段相同，结果出处在 `result.evidence`。`outcome` 为 `effective`（有效）、`no_improvement`（无明显改善）或 `failure`（失败） |
| `rows[].effectCheck` | 原文只解释机制、没有效果验证时为「原论文未验证效果」。此时没有 `experiment` |

没有 `metaMethod` 的旧快照仍只含上面的方法字段，Markdown 也保持确认时的原内容。新快照里的 Markdown 与 JSON 使用同一次确认写入的记录。快照提供评估迁移所需的做法、元方法、前提、结果和出处；目标任务、结果预测和实验设计由下游完成，不写进快照。

状态 `known` 表示已记录，`pending` 表示待核实，`unreported` 表示论文未说明，`not_applicable` 表示不适用。待核实的字段可能有暂存的文字。迁移设想由读者提供，可作为选题线索。

证据的 `kind` 为 `paper` 或 `code`。论文证据带论文与版本标识，可带页码 `page`、来源标识 `label` 及版本化公开链接。只有本地副本时，可在 PaperMaster 中用论文与版本标识找回对应材料。代码证据带仓库 `repo`、提交 `commit`、文件 `file`、起止行号 `from` 和 `to`，以及指向固定提交的链接。

## 独立读取示例

把已确认的 JSON 文件传给这个最小读取器即可提取研究主题和方法流程。

~~~js
import { readFile } from 'node:fs/promises';

const snapshot = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.rows)) {
  throw new Error('Unsupported PaperMaster export');
}

console.log(snapshot.topic, snapshot.id, snapshot.confirmedAt);
for (const row of snapshot.rows) {
  console.log(row.fields.name.text, row.fields.pipeline.text);
}
~~~

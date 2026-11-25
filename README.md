# PaperMaster

**Follow a research idea from paper to implementation.**

[简体中文](README.zh-CN.md) · [Install](#install) · [Workflow](#workflow) · [Releases](https://github.com/Kstheme/PaperMaster/releases) · [npm](https://www.npmjs.com/package/papermaster-reader)

PaperMaster is a local workspace for reading research papers. Import a PDF or an arXiv link, explore a method inside the article, and connect what you learn to the original paper, a pinned repository commit, and your own notes.

![PaperMaster showing the Draw2Think repository walkthrough, with a geometry demo, implementation steps, and source links](docs/images/repository-workbench.webp)

*Draw2Think repository reading. A teaching sample connects the paper's state and observation model to the code that returns an angle.*

## Install

Requires **Node.js 22.16 or later**. Install **Git** to associate a public GitHub repository. The package ships with the built interface.

```sh
npm install -g papermaster-reader@latest
papermaster
```

To install a specific GitHub release, download its `papermaster-reader-<version>.tgz` from [Releases](https://github.com/Kstheme/PaperMaster/releases), then run `npm install -g ./papermaster-reader-<version>.tgz`. On Windows, use `npm.cmd` and `papermaster.cmd` if PowerShell blocks the script shims.

PaperMaster opens a browser and prints its local address. Use `papermaster --help` for the port and data-directory options.

## Workflow

1. **Connect a model.** Open **模型连接** (Model connections). For Codex, install the Codex CLI and sign in with `codex login`. You can also configure an API provider.
2. **Bring in a paper.** Use **导入论文** (Import paper) with an arXiv URL or a PDF that has extractable text.
3. **Choose how to read.** Start with **泛读** (Skim), use **完整精读** (Deep reading) for methods and experiments, or use **关联仓库精读** (Repository reading) to follow the implementation at a specific commit.
4. **Keep what matters.** Ask a follow-up from a passage or implementation step, save part of the answer to the main note, or export the reading to Markdown.

## Inside the workspace

| Workspace | What you can do |
| --- | --- |
| Interactive reading | Step through the paper's architecture, vary formula inputs, and compare reported results or ablations. Open the original figures and tables where available. |
| Repository reading | Follow a representative sample, inspect inputs and outputs, compare paper concepts with source lines, and try a prediction exercise where the evidence supports one. Teaching simulations are labeled. |
| Follow-ups and main notes | Continue a question from its reading context, check the supporting evidence, and save selected excerpts to a Markdown note. |
| Topic method tables | Review methods against a research topic, keep edits when adding papers, and confirm a snapshot for Markdown and Auto Research JSON export. See the [export format](docs/auto-research-export.md). |

**Coming soon in the reading launcher:** Guided reading, multi-paper comparison, and standalone questions. In-context follow-ups are available from a reading.

## Models and local data

PaperMaster supports Codex, OpenAI-compatible endpoints, and native OpenAI, Claude, and Gemini APIs. Configure API credentials through an environment variable or the Windows/macOS credential store.

The library, reading history, and notes are stored locally. Generation sends relevant paper excerpts and, for repository reading, selected source excerpts to the configured provider. Figure and table crops are optional. Use the workspace's **备份** (Backup) action to export a copy of your library.

## Develop from source

```sh
git clone https://github.com/Kstheme/PaperMaster.git
cd PaperMaster
npm ci
npm test
npm run build
npm start
```

[Interactive reading design](docs/interactive-reading-design.md) · [Platform design](docs/platform-design.md) · [Report an issue](https://github.com/Kstheme/PaperMaster/issues)

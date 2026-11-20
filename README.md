# PaperMaster

**Read research papers by exploring their methods, testing their equations, and comparing their results.**

[简体中文](README.zh-CN.md) · [Install](#install) · [Quick start](#quick-start) · [Releases](https://github.com/Kstheme/PaperMaster/releases)

PaperMaster is a local reading workspace for research papers. Import a PDF or an arXiv link, then follow a method from its architecture diagram to an interactive equation and the experiments that test it. Save your findings as Markdown.

## Install

**Requires Node.js 22.16 or later.** Install the prebuilt package directly from GitHub Releases with npm:

```sh
npm install -g https://github.com/Kstheme/PaperMaster/releases/download/v0.2.0/papermaster-reader-0.2.0.tgz
papermaster
```

PaperMaster opens your browser and prints its local URL. In Windows PowerShell, use `npm.cmd` and `papermaster.cmd` if script execution policy blocks the shims.

## Quick start

1. Open **模型连接** (Model connections) and add a provider. For a **Codex subscription**, install the Codex CLI and run `codex login` with your ChatGPT account. You can select a model from the CLI's list.
2. Click **导入论文** (Import paper), then upload a text-based PDF or paste an arXiv URL.
3. Choose **完整精读** (Deep reading). Select a node to trace its inputs and outputs, change values in the formula lab, then open **实验对照** (Experiment comparison) to compare results under the reported conditions.
4. Save an observation to the main note or export the reading as Markdown. On a previous text-only reading, **生成交互版** creates a new interactive record from the same paper version.

![PaperMaster showing the Transformer architecture and an interactive attention demonstration](docs/images/interactive-reading.png)

## What you can do

| Feature | Workflow |
| --- | --- |
| Architecture explorer | Select a module and follow data through connected stages. |
| Formula lab | Drag points or vectors, edit inputs, and see intermediate values and outputs update in real time. |
| Experiment comparison | Filter reported results and ablations, compare rows, and open the original figures or tables. |
| Guided reading | Work through questions with feedback and resume where you left off. |
| Repository reading | Connect a public GitHub repository and read the implementation at a recorded commit. Requires Git. |
| Markdown notes | Save experiment comparisons or a specific formula run, and export results for later use. |

## Model providers and data

Connect a Codex subscription, an OpenAI-compatible endpoint, or a native OpenAI, Claude, or Gemini API. API connections use an environment variable or the Windows/macOS system credential store.

The paper library, reading history, and notes stay on your machine. Generation sends the needed paper excerpts to your selected model provider. The reading form lets you choose whether to include figure and table crops. Import currently requires a PDF with extractable text. Interactive coverage depends on the material available in the paper.

## Development

```sh
git clone https://github.com/Kstheme/PaperMaster.git
cd PaperMaster
npm ci
npm test
npm run build
npm start
```

Use `papermaster --help` for local server options. See the [interactive reading design](docs/interactive-reading-design.md) and [platform design](docs/platform-design.md) for implementation details. Report reproducible bugs at [GitHub Issues](https://github.com/Kstheme/PaperMaster/issues).

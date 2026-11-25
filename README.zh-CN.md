# PaperMaster

**从论文的方法，读到仓库里的实现。**

[English](README.md) · [安装](#安装) · [阅读流程](#阅读流程) · [版本发布](https://github.com/Kstheme/PaperMaster/releases) · [npm](https://www.npmjs.com/package/papermaster-reader)

PaperMaster 是一个本地论文阅读工作台。导入 PDF 或 arXiv 链接，在正文里追踪方法、试算公式、核对实验。每条值得保留的发现，都可以连回原论文、固定提交的源码和你的笔记。

![PaperMaster 的 Draw2Think 仓库精读界面，展示几何演示、实现步骤和源码链接](docs/images/repository-workbench.webp)

*Draw2Think 仓库精读。用一个教学样本串起论文里的状态与观测，以及实际返回角度的代码。*

## 安装

需要 **Node.js 22.16 或更新版本**。关联公开 GitHub 仓库还需要 **Git**。安装包已包含构建好的界面。

```sh
npm install -g papermaster-reader@latest
papermaster
```

也可以在 [GitHub Releases](https://github.com/Kstheme/PaperMaster/releases) 下载指定版本的 `papermaster-reader-<版本>.tgz`，再运行 `npm install -g ./papermaster-reader-<版本>.tgz`。如果 Windows PowerShell 拦截命令脚本，可使用 `npm.cmd` 和 `papermaster.cmd`。

启动后会打开浏览器，并在终端显示本地地址。运行 `papermaster --help` 可查看端口和数据目录选项。

## 阅读流程

1. **连接模型。** 打开「模型连接」。使用 Codex 时先安装 Codex CLI，运行 `codex login` 登录，也可以配置 API 服务。
2. **导入论文。** 点「导入论文」，粘贴 arXiv 链接或选择可提取正文的 PDF。
3. **选择读法。** 用「泛读」了解全貌，用「完整精读」看方法和实验，或用「关联仓库精读」沿固定提交查看真实实现。
4. **留下发现。** 从段落或实现步骤发起追问，将有用的回答片段加入主笔记，或把阅读成果导出为 Markdown。

## 工作台功能

| 工作区 | 可以做什么 |
| --- | --- |
| 交互阅读 | 单步浏览论文架构，调整公式输入，比较论文报告的主结果与消融。可打开已有的原图表核对。 |
| 关联仓库精读 | 沿代表性样本查看输入和输出，将论文概念与固定提交的源码对照。证据足够时可先做预测题，教学模拟有明确标注。 |
| 追问与主笔记 | 围绕原阅读位置继续提问，核对依据，把选中的回答片段加入 Markdown 笔记。 |
| 主题方法表 | 围绕研究主题核对方法，追加论文时保留人工编辑。确认后可将同一份快照导出为 Markdown 和 Auto Research JSON。参见[交付快照格式](docs/auto-research-export.md)。 |

阅读入口中的「引导精读」「多篇比较」「专项解惑」敬请期待。阅读中的「就此追问」可以正常使用。

## 模型与本地数据

支持 Codex、OpenAI 兼容端点，以及 OpenAI、Claude、Gemini 原生 API。API 凭证可通过环境变量或 Windows/macOS 系统凭证库提供。

论文库、阅读记录和笔记保存在本机。生成时会向所选模型服务发送相关论文片段，关联仓库精读也会发送选定的源码片段。是否发送图表裁片可在阅读表单中选择。可从顶部「备份」导出论文库副本。

## 从源码运行

```sh
git clone https://github.com/Kstheme/PaperMaster.git
cd PaperMaster
npm ci
npm test
npm run build
npm start
```

[交互阅读设计](docs/interactive-reading-design.md) · [平台设计](docs/platform-design.md) · [问题反馈](https://github.com/Kstheme/PaperMaster/issues)

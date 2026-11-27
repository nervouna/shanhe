# Shanhe 山河

[English](README.md) | 简体中文

[![CI](https://github.com/nervouna/shanhe/actions/workflows/ci.yml/badge.svg)](https://github.com/nervouna/shanhe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Browser: WebGPU](https://img.shields.io/badge/browser-WebGPU-lightgrey)

一款在浏览器里运行的回合制 4X 策略游戏，地图是东亚、西伯利亚和东南亚的真实地貌。五十个架空国家沿真实的省级边界划分，各自带有当地特色。单位是摆在沙盘上的象棋式棋子。

## 现状

- **成熟度**：设计已完成，还没有可玩的版本。开发进度见 [issues](https://github.com/nervouna/shanhe/issues)。
- **适合谁**：想看看语言模型独立能做出什么的人。整个游戏从设计到代码都由 Claude（Anthropic 的 Fable 模型）完成，人类所有者只做产品决策。
- **运行条件**：支持 WebGPU 的桌面或平板浏览器，不支持时回退到 WebGL。不需要安装。
- **语言**：界面有中文和英文。
- **发布**：暂无。

参见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。

## 特点

- **所有画面都由代码生成。** 没有模型文件，没有贴图文件。地形来自公开的高程和边界数据，材质来自着色器。
- **省界始终有意义。** 开局边界固定，国家在省内自由发展，向外扩张只能靠战争或外交。
- **两小时左右一局**：150 回合，六个时代，从上古到现代。
- **三种胜利方式**：征服、科技、经济。

## 开发方式

设计文档在 [docs/design](docs/design/00-overview.md)（英文），是游戏设计的唯一依据。工作以 GitHub issue 规划，由 Claude 子代理以 pull request 交付；一个负责编排的 Claude 会话写规格、评审并合并。[CLAUDE.md](CLAUDE.md) 记录这些代理遵守的项目规则。

## 许可证

[MIT](LICENSE)。作为输入的地理数据集各有自己的许可证，数据管线建好后会随之列出。

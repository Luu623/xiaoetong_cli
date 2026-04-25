# 安装与使用准备

本文档用于帮助用户安装并运行 `xiaoetong-cli`。安装完成后，可以通过 `xe` 命令登录小鹅通、查看课程、下载视频课时，并可选使用本地语音转文字功能。

## 作为 Codex Skill 安装

本仓库根目录就是 skill 目录，必需文件为 `SKILL.md`。安装成 skill 后，用户的 agent 可以按 `SKILL.md` 自动检查 Node/npm/Git/ffmpeg/tar/bzip2 等工具，并完成 CLI 构建与验证。

### 从 GitHub 安装

让 agent 使用 `$skill-installer` 从本仓库安装，例如：

```text
Use $skill-installer to install the xiaoetong-cli skill from <owner>/<repo>.
```

如果仓库内 skill 不在根目录，请同时提供对应 path。安装完成后重启 Codex 以加载新 skill。

### 从本地目录安装

如果 agent 已在本仓库目录中，可复制仓库到 Codex skills 目录：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
rsync -a --exclude='.git/' --exclude='node_modules/' --exclude='dist/' ./ "${CODEX_HOME:-$HOME/.codex}/skills/xiaoetong-cli/"
```

本地安装不需要预先复制 `node_modules/` 或 `dist/`；加载 skill 后，agent 会在 skill 目录中执行依赖安装和构建检查。

### Skill 安装后的运行环境检查

必需工具：

```bash
node -v
npm -v
git --version
```

建议 Node.js 20 或 22 LTS。语音转文字和部分视频转换还需要：

```bash
ffmpeg -version
tar --version
bzip2 --version
```

CLI 验证命令：

```bash
npm ci
npm run build
npm link
xe --version
xe --help
```

如果不能使用全局 `npm link`，可用本地入口验证：

```bash
node dist/index.js --version
node dist/index.js --help
```

## 需要准备的工具

### 必需工具

- **Node.js**：建议安装 Node.js 20 或 22 LTS。
- **npm**：随 Node.js 一起安装，用于安装项目依赖。
- **Git**：用于拉取项目源码。
- **微信**：登录小鹅通时需要扫码确认。

检查本机是否已安装：

```bash
node -v
npm -v
git --version
```

### 可选但推荐工具

- **ffmpeg**：用于将 HLS/TS 视频转为 MP4，也用于语音转文字前的音频格式转换。
- **tar / bzip2**：用于解压语音识别模型。macOS 和大多数 Linux 发行版通常已内置。

检查方式：

```bash
ffmpeg -version
tar --version
bzip2 --version
```

## 安装 Node.js

### macOS

如果已安装 Homebrew：

```bash
brew install node git ffmpeg
```

也可以使用 nvm 管理 Node.js 版本：

```bash
brew install nvm
nvm install 22
nvm use 22
```

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y git nodejs npm ffmpeg tar bzip2
```

如果系统仓库中的 Node.js 版本过旧，建议改用 nvm 安装 Node.js 20 或 22 LTS。

### Windows

建议安装：

- Node.js LTS：https://nodejs.org/
- Git for Windows：https://git-scm.com/download/win
- ffmpeg：https://ffmpeg.org/download.html

安装后请确认 `node`、`npm`、`git`、`ffmpeg` 已加入系统 `PATH`。

## 安装 CLI

拉取源码并进入项目目录：

```bash
git clone <repo-url>
cd xiaoetong_cli
```

安装依赖并构建：

```bash
npm install
npm run build
```

将 `xe` 命令链接到全局：

```bash
npm link
```

验证安装：

```bash
xe --version
xe --help
```

## 首次使用

### 1. 登录

```bash
xe login
```

命令会打开微信扫码登录流程。登录信息会保存到用户配置目录：

- 默认：`~/.config/xiaoetong-cli/`
- 如果设置了 `XDG_CONFIG_HOME`：`$XDG_CONFIG_HOME/xiaoetong-cli/`

查看登录状态：

```bash
xe whoami
```

退出登录：

```bash
xe logout
```

### 2. 查看课程

```bash
xe courses
xe courses -p 2
xe course <resource_id>
```

`xe course <resource_id>` 会显示课程目录树，用于找到后续下载需要的 `course_id` 和 `lesson_id`。

### 3. 下载视频

```bash
xe download <course_id> <lesson_id>
xe download <course_id> <lesson_id> -q 1080p
```

下载结果会按命令输出的路径保存。遇到 HLS/DRM 或直播回放内容时，建议提前安装 `ffmpeg`，这样工具可以自动将 `.ts` 文件转换为 `.mp4`。

### 4. 语音转文字

```bash
xe stt <course_id> <lesson_id>
xe stt <course_id> <lesson_id> --lang zh
```

语音转文字依赖：

- 必须安装 `ffmpeg`。
- 首次运行会自动下载 Qwen3-ASR 模型，约 1.8GB。
- 模型默认保存到 `~/.config/xiaoetong-cli/models/qwen3-asr-0.6b/`。

## 常见问题

### `xe: command not found`

请确认已经执行：

```bash
npm run build
npm link
```

如果仍无法识别，检查 npm 全局 bin 目录是否在 `PATH` 中：

```bash
npm prefix -g
```

通常需要把输出目录下的 `bin` 子目录加入 `PATH`，例如 `/usr/local/bin` 或 `~/.npm-global/bin`。

### 提示未检测到 `ffmpeg`

安装 `ffmpeg` 后重新运行命令：

```bash
brew install ffmpeg
```

或在 Ubuntu / Debian 上：

```bash
sudo apt install -y ffmpeg
```

### 语音模型下载失败

请检查网络连接后重新运行 `xe stt ...`。工具会按内置镜像源顺序重试下载模型。

### 登录过期或无法验证登录状态

重新登录：

```bash
xe logout
xe login
```

## 开发者命令

如果需要在本地开发或调试：

```bash
npm run dev
npm run build
npm run lint
npm run lint:fix
```

当前项目暂未配置测试套件。

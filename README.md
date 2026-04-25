# xiaoetong-cli

小鹅通学习平台命令行工具，支持课程浏览、视频下载、语音转录等功能。

## 安装与准备

安装 Codex skill、检查运行环境、安装 CLI 和首次使用准备，请查看 [download.md](./download.md)。

## 使用

### 登录

```bash
xe login       # 微信扫码登录
xe whoami      # 查看当前登录状态
xe logout      # 退出登录
```

### 课程

```bash
xe courses              # 列出已购买课程
xe courses -p 2         # 指定页码
xe course <resource_id> # 查看课程目录树
```

### 下载

```bash
xe download <course_id> <lesson_id>           # 下载视频课时
xe download <course_id> <lesson_id> -q 1080p  # 指定清晰度
```

### 语音转文字

```bash
xe stt <course_id> <lesson_id>       # 转录课时音频
xe stt <course_id> <lesson_id> --lang zh  # 指定语言
```

使用 sherpa-onnx + Qwen3-ASR-0.6B 进行本地语音识别，无需联网。

## 开发

```bash
npm run dev       # 开发模式运行
npm run build     # 构建到 dist/
npm run lint      # 代码检查
npm run lint:fix  # 自动修复
```

## 技术栈

- TypeScript + ES Modules
- [Commander](https://github.com/tj/commander.js) — CLI 框架
- [Axios](https://github.com/axios/axios) — HTTP 请求
- [Chalk](https://github.com/chalk/chalk) + [Ora](https://github.com/sindresorhus/ora) — 终端输出
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — 本地语音识别

## License

MIT

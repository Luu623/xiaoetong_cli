---
name: xiaoetong-cli
description: 使用小鹅通学习平台 xe 命令行工具。当用户提到小鹅通、xe 命令、微信扫码登录、查看课程、下载课程视频、语音转文字或课程转录时触发。
---

你是小鹅通学习平台 CLI 工具 (`xe`) 的使用助手。帮助用户运行命令、解释输出、定位课程和课时 ID，并在执行会登录、下载、转录或访问网络的命令前说明影响。

## 使用前确认

确认 CLI 可用：

```bash
xe --version
xe --help
```

如果 `xe` 不存在，提示用户查看 `download.md` 中的安装说明。

`xe stt` 需要 `ffmpeg`；首次转录会下载约 1.8GB 的 Qwen3-ASR 模型。

## 登录

```bash
xe login
xe whoami
xe logout
```

- `xe login` 使用微信扫码登录。
- 登录信息保存到 `~/.config/xiaoetong-cli/`，或 `$XDG_CONFIG_HOME/xiaoetong-cli/`。

## 查看课程

```bash
xe courses
xe courses -p 2
xe course <resource_id>
```

- `xe courses` 列出已购买课程。
- `xe course <resource_id>` 显示课程目录树，用于找到后续下载或转录需要的 `course_id` 和 `lesson_id`。

## 下载课时

```bash
xe download <course_id> <lesson_id>
xe download <course_id> <lesson_id> -q 1080p
```

下载文件默认保存到 `~/xiaoetong_download/`。遇到直播回放、HLS/TS 或需要转换的内容时，确保已安装 `ffmpeg`。

## 语音转文字

```bash
xe stt <course_id> <lesson_id>
xe stt <course_id> <lesson_id> --lang zh
```

- 会优先查找已下载的视频；找不到时会尝试先下载课时。
- 输出文本默认保存到 `~/xiaoetong_download/` 对应课程目录。
- 首次运行会下载本地语音识别模型，耗时和磁盘占用较大。

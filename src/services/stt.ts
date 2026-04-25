import { existsSync, mkdirSync, readdirSync, writeFileSync, createWriteStream, renameSync, unlinkSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';
import { getH5AuthContext } from './course.js';
import { getVideoDetail, getAliveBaseInfo } from '../api/course.js';
import { createH5ApiClient } from '../api/client.js';
import { downloadVideo } from './download.js';

// ── Helpers ──────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim();
}

function hasFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getDownloadDir(): string {
  return join(homedir(), 'xiaoetong_download');
}

function getModelDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const configDir = xdg ? join(xdg, 'xiaoetong-cli') : join(homedir(), '.config', 'xiaoetong-cli');
  return join(configDir, 'models', 'qwen3-asr-0.6b');
}

// ── Model management ─────────────────────────────────────────────────

const MODEL_MIRRORS = [
  'https://ghfast.top/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
  'https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
];
const MODEL_DIR_NAME = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25';

function isModelReady(): boolean {
  const dir = getModelDir();
  return (
    existsSync(join(dir, 'conv_frontend.onnx')) &&
    existsSync(join(dir, 'encoder.int8.onnx')) &&
    existsSync(join(dir, 'decoder.int8.onnx')) &&
    existsSync(join(dir, 'tokenizer'))
  );
}

async function downloadModel(spinner: ora.Ora): Promise<void> {
  const modelDir = getModelDir();
  if (isModelReady()) return;

  mkdirSync(modelDir, { recursive: true });

  const tarBz2Path = join(modelDir, 'model.tar.bz2');

  // Download — try mirrors in order
  let response: Awaited<ReturnType<typeof axios.get>> | undefined;
  for (const url of MODEL_MIRRORS) {
    try {
      spinner.text = `正在下载 Qwen3-ASR 模型 (~1.8GB)...`;
      response = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000, // connection timeout
      });
      break; // success
    } catch {
      spinner.text = '镜像源连接失败，尝试下一个...';
      continue;
    }
  }

  if (!response) {
    throw new Error('所有镜像源均连接失败，请检查网络');
  }

  const totalLength = parseInt(response.headers['content-length'] || '0', 10);
  let downloaded = 0;
  let lastTime = Date.now();
  let lastDownloaded = 0;

  const writeStream = createWriteStream(tarBz2Path);

  response.data.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed >= 2) {
      const speed = (downloaded - lastDownloaded) / elapsed;
      const mb = (downloaded / 1024 / 1024).toFixed(1);
      const totalMb = totalLength > 0 ? ` / ${(totalLength / 1024 / 1024).toFixed(1)}` : '';
      const speedMb = (speed / 1024 / 1024).toFixed(1);
      spinner.text = `下载模型 ${mb}${totalMb} MB (${speedMb} MB/s)...`;
      lastTime = now;
      lastDownloaded = downloaded;
    }
  });

  response.data.pipe(writeStream);

  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    response.data.on('error', reject);
  });

  // Extract
  spinner.text = '正在解压模型...';
  try {
    execSync(`tar xjf "${tarBz2Path}" -C "${modelDir}"`, { stdio: 'ignore' });
  } catch {
    throw new Error('模型解压失败，请确保系统已安装 tar 和 bzip2');
  }

  // Move files from subdirectory to model dir
  const extractedDir = join(modelDir, MODEL_DIR_NAME);
  if (existsSync(extractedDir)) {
    const files = readdirSync(extractedDir);
    for (const file of files) {
      renameSync(join(extractedDir, file), join(modelDir, file));
    }
    try { rmSync(extractedDir, { recursive: true }); } catch { /* ignore cleanup failure */ }
  }

  // Cleanup tarball
  try { unlinkSync(tarBz2Path); } catch { /* ignore */ }

  if (!isModelReady()) {
    throw new Error('模型下载不完整，请重新运行');
  }
}

// ── Find existing media ──────────────────────────────────────────────

function findExistingMedia(courseTitle: string, lessonTitle: string): string | null {
  const dir = join(getDownloadDir(), sanitizeFileName(courseTitle));
  if (!existsSync(dir)) return null;

  const sanitized = sanitizeFileName(lessonTitle);
  const extensions = ['.mp4', '.ts', '.mkv', '.avi', '.mov'];

  // Exact match
  for (const ext of extensions) {
    const p = join(dir, `${sanitized}${ext}`);
    if (existsSync(p) && statSync(p).size > 0) return p;
  }

  // Partial match (title may have been truncated)
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(sanitized)) {
        const ext = file.substring(sanitized.length);
        if (extensions.includes(ext)) {
          const p = join(dir, file);
          if (statSync(p).size > 0) return p;
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}

// ── Audio conversion ─────────────────────────────────────────────────

function convertToWav(mediaPath: string): string {
  const wavPath = mediaPath.replace(/\.[^.]+$/, '_16k.wav');
  execSync(
    `ffmpeg -y -i "${mediaPath}" -ar 16000 -ac 1 -f wav "${wavPath}"`,
    { stdio: 'ignore' },
  );
  return wavPath;
}

// ── Transcription ────────────────────────────────────────────────────

// Chunk duration in seconds — Qwen3-ASR max_total_len is 512 tokens,
// ~3.5 audio tokens/sec, so 30s ≈ 105 tokens, well within limits.
const CHUNK_SECONDS = 30;

async function transcribe(wavPath: string, spinner?: ora.Ora): Promise<string> {
  // Dynamic import for sherpa-onnx-node (CJS native addon)
  // ESM import() wraps CJS exports in { default: ... }, so unwrap it
  const mod = await import('sherpa-onnx-node');
  const sherpaOnnx = mod.default || mod;
  const modelDir = getModelDir();

  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      qwen3Asr: {
        convFrontend: join(modelDir, 'conv_frontend.onnx'),
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.int8.onnx'),
        tokenizer: join(modelDir, 'tokenizer'),
        hotwords: '',
      },
      tokens: '',
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  };

  const recognizer = await sherpaOnnx.OfflineRecognizer.createAsync(config);
  const wave = sherpaOnnx.readWave(wavPath);

  const sampleRate = wave.sampleRate as number;
  const samples = wave.samples as Float32Array;
  const totalSamples = samples.length;
  const chunkSamples = CHUNK_SECONDS * sampleRate;
  const totalChunks = Math.ceil(totalSamples / chunkSamples);

  if (totalChunks <= 1) {
    // Short audio — process in one shot
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples });
    const result = await recognizer.decodeAsync(stream);
    return result.text || '';
  }

  // Long audio — chunked processing
  const parts: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSamples;
    const end = Math.min(start + chunkSamples, totalSamples);
    const chunk = samples.slice(start, end);

    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples: chunk });
    const result = await recognizer.decodeAsync(stream);
    if (result.text) parts.push(result.text);

    if (spinner) {
      spinner.text = `正在转录语音... (${i + 1}/${totalChunks})`;
    }
  }

  return parts.join('\n');
}

// ── Main entry ───────────────────────────────────────────────────────

export interface SttOptions {
  lang?: string;
}

export async function transcribeLesson(
  courseId: string,
  lessonId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: SttOptions = {},
): Promise<void> {
  const spinner = ora('正在准备语音转文字...').start();

  // 1. Validate ffmpeg
  if (!hasFfmpeg()) {
    spinner.fail(chalk.red(
      '未检测到 ffmpeg，请先安装:\n' +
      '  macOS: brew install ffmpeg\n' +
      '  Ubuntu: sudo apt install ffmpeg',
    ));
    process.exit(1);
  }

  // 2. Get auth context and lesson metadata
  spinner.text = '正在获取课时信息...';
  const { course, h5Client, koToken } = await getH5AuthContext(courseId);

  let lessonTitle: string;

  if (lessonId.startsWith('l_')) {
    // Live replay
    const aliveBaseUrl = h5Client.defaults.baseURL?.replace('xiaoeknow.com', 'xiaoecloud.com')
      || h5Client.defaults.baseURL;
    const aliveClient = aliveBaseUrl !== h5Client.defaults.baseURL
      ? createH5ApiClient(aliveBaseUrl!)
      : h5Client;

    const baseResult = await getAliveBaseInfo(aliveClient, koToken, {
      resourceId: lessonId,
      productId: courseId,
    });

    if (baseResult.code !== 0) {
      throw new Error(`获取直播信息失败: ${baseResult.msg}`);
    }
    lessonTitle = baseResult.data.alive_info.title || lessonId;
  } else {
    // Video lesson
    const videoResult = await getVideoDetail(h5Client, koToken, {
      resourceId: lessonId,
      productId: courseId,
    });

    if (videoResult.code !== 0) {
      throw new Error(`获取视频详情失败: ${videoResult.msg}`);
    }
    lessonTitle = videoResult.data.video_info?.file_name?.replace(/\.mp4$/i, '') || lessonId;
  }

  const courseTitle = course.title || courseId;
  const courseDir = join(getDownloadDir(), sanitizeFileName(courseTitle));

  spinner.succeed(chalk.green(`课时: ${lessonTitle}`));
  console.log(chalk.gray(`课程: ${courseTitle}`));
  console.log();

  // 3. Find or download media
  let mediaPath = findExistingMedia(courseTitle, lessonTitle);

  if (mediaPath) {
    const size = statSync(mediaPath).size;
    console.log(chalk.green(`找到已下载文件: ${mediaPath} (${(size / 1024 / 1024).toFixed(1)} MB)`));
  } else {
    console.log(chalk.cyan('未找到已下载文件，正在下载...'));
    await downloadVideo(courseId, lessonId);
    mediaPath = findExistingMedia(courseTitle, lessonTitle);
    if (!mediaPath) {
      throw new Error('下载完成但未找到文件，请检查下载目录');
    }
    console.log(chalk.green(`下载完成: ${mediaPath}`));
  }

  console.log();

  // 4. Convert to WAV
  const convSpinner = ora('正在转换音频格式...').start();
  let wavPath: string;
  try {
    wavPath = convertToWav(mediaPath);
    convSpinner.succeed(chalk.green('音频转换完成'));
  } catch (err) {
    convSpinner.fail(chalk.red('音频转换失败'));
    throw err;
  }

  // 5. Ensure model is ready
  if (!isModelReady()) {
    console.log();
    const modelSpinner = ora('首次运行，需要下载 Qwen3-ASR 模型').start();
    await downloadModel(modelSpinner);
    modelSpinner.succeed(chalk.green('模型下载完成'));
    console.log();
  }

  // 6. Transcribe
  const sttSpinner = ora('正在转录语音...').start();
  let text: string;
  try {
    text = await transcribe(wavPath, sttSpinner);
    sttSpinner.succeed(chalk.green('转录完成'));
  } catch (err) {
    sttSpinner.fail(chalk.red('转录失败'));
    throw err;
  }

  // 7. Save output
  mkdirSync(courseDir, { recursive: true });
  const outputPath = join(courseDir, `${sanitizeFileName(lessonTitle)}.txt`);
  writeFileSync(outputPath, text, 'utf-8');

  // 8. Cleanup temp WAV
  try { unlinkSync(wavPath); } catch { /* ignore */ }

  console.log();
  console.log(chalk.green(`转录结果已保存: ${outputPath}`));
  console.log(chalk.gray(`文本长度: ${text.length} 字符`));

  // Preview first 200 chars
  if (text.length > 0) {
    console.log();
    console.log(chalk.gray('── 预览 ──'));
    const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
    console.log(preview);
  }
}

import { createWriteStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';
import { getVideoDetail, getPlayUrl, getAliveBaseInfo, getLookbackList } from '../api/course.js';
import { getH5AuthContext } from './course.js';
import { createH5ApiClient } from '../api/client.js';

// ── Filename sanitization ──────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim();
}

// ── Video URL decoding ─────────────────────────────────────────────

interface VideoUrlItem {
  definition_name: string;
  definition_p: string;
  url: string;
}

function decodeVideoUrls(encoded: string): VideoUrlItem[] {
  // Strategy 1: direct base64
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* try next */ }

  // Strategy 2: replace known special chars then base64
  try {
    const cleaned = encoded
      .replace(/@/g, 'M')
      .replace(/\$/g, 'c')
      .replace(/#/g, 'g')
      .replace(/%/g, '4');
    const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* try next */ }

  // Strategy 3: URL-safe base64
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded + '='.repeat((4 - padded.length % 4) % 4);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* give up */ }

  return [];
}

// ── File download with progress ────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

async function downloadFile(
  url: string,
  destPath: string,
  spinner: ora.Ora,
): Promise<void> {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 30000,
  });

  const totalLength = parseInt(response.headers['content-length'] || '0', 10);
  let downloaded = 0;
  let lastTime = Date.now();
  let lastDownloaded = 0;

  // Check if it's an m3u8 playlist
  const contentType = response.headers['content-type'] || '';
  if (
    contentType.includes('mpegurl') ||
    contentType.includes('application/vnd.apple.mpegurl') ||
    url.includes('.m3u8')
  ) {
    throw new Error(
      '该视频使用 HLS (m3u8) 流式传输，无法直接下载。\n' +
      '提示: 可安装 ffmpeg 后使用命令下载:\n' +
      chalk.cyan(`  ffmpeg -i "${url}" -c copy "${destPath}"`),
    );
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(destPath);

    response.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;

      if (elapsed >= 0.5) {
        const speed = (downloaded - lastDownloaded) / elapsed;
        lastTime = now;
        lastDownloaded = downloaded;

        if (totalLength > 0) {
          const pct = ((downloaded / totalLength) * 100).toFixed(1);
          spinner.text = `${formatBytes(downloaded)} / ${formatBytes(totalLength)} (${pct}%) ${formatSpeed(speed)}`;
        } else {
          spinner.text = `已下载 ${formatBytes(downloaded)} ${formatSpeed(speed)}`;
        }
      }
    });

    response.data.pipe(stream);

    stream.on('finish', () => {
      spinner.text = `${formatBytes(downloaded)} 下载完成`;
      resolve();
    });

    stream.on('error', reject);
    response.data.on('error', reject);
  });
}

// ── M3U8 parsing ───────────────────────────────────────────────────

interface M3U8Info {
  keyUrl: string;
  ivHex: string;
  segments: string[];
}

function parseM3U8(text: string, m3u8Url: string): M3U8Info {
  const lines = text.split('\n');
  let keyUrl = '';
  let ivHex = '00000000000000000000000000000000';
  const segments: string[] = [];
  const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-KEY')) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);
      if (ivMatch) ivHex = ivMatch[1];
    } else if (line && !line.startsWith('#')) {
      try {
        segments.push(new URL(line, baseUrl).href);
      } catch {
        segments.push(line);
      }
    }
  }

  return { keyUrl, ivHex, segments };
}

// ── AES-128-CBC decryption ─────────────────────────────────────────

function decryptSegment(encrypted: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ── ffmpeg conversion ───────────────────────────────────────────────

function hasFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function convertTsToMp4(tsPath: string): string {
  const mp4Path = tsPath.replace(/\.ts$/, '.mp4');
  execSync(`ffmpeg -y -i "${tsPath}" -c copy "${mp4Path}"`, { stdio: 'ignore' });
  unlinkSync(tsPath);
  return mp4Path;
}

// ── Live replay download ────────────────────────────────────────────

async function downloadLiveReplay(
  h5Client: ReturnType<typeof import('../api/client.js')['createH5ApiClient']>,
  koToken: string,
  appId: string,
  courseId: string,
  lessonId: string,
  outputPath: string,
  spinner: ora.Ora,
): Promise<void> {
  // Phase A: get base info (title, alive_state)
  spinner.text = '正在获取直播回放信息...';
  const baseResult = await getAliveBaseInfo(h5Client, koToken, {
    resourceId: lessonId,
    productId: courseId,
  });

  if (baseResult.code !== 0) {
    throw new Error(`获取直播信息失败: ${baseResult.msg}`);
  }

  const { alive_info, alive_conf } = baseResult.data;

  if (alive_info.alive_state !== 3) {
    throw new Error('该直播尚未结束，无法下载回放');
  }

  if (!alive_conf.is_lookback) {
    throw new Error('该直播不支持回放下载');
  }

  // Phase B: get lookback m3u8 URL
  spinner.text = '正在获取回放播放地址...';
  const lookbackResult = await getLookbackList(h5Client, koToken, {
    appId,
    aliveId: lessonId,
  });

  if (lookbackResult.code !== 0) {
    throw new Error(`获取回放列表失败: ${lookbackResult.msg}`);
  }

  const lines = lookbackResult.data;
  if (!lines || lines.length === 0) {
    throw new Error('未找到回放视频');
  }

  // Pick default line, then first line
  const line = lines.find(l => l.default) || lines[0];
  if (!line.line_sharpness || line.line_sharpness.length === 0) {
    throw new Error('回放列表中无可用清晰度');
  }

  // Pick default sharpness (usually origin)
  const sharpness = line.line_sharpness.find(s => s.default) || line.line_sharpness[0];
  const m3u8Url = sharpness.url;

  // Phase C: download m3u8
  const cdnHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Referer: 'https://study.xiaoe-tech.com/',
  };

  spinner.text = '正在下载播放列表...';
  let m3u8Text: string;
  try {
    const m3u8Resp = await axios.get(m3u8Url, { responseType: 'text', headers: cdnHeaders });
    m3u8Text = m3u8Resp.data as string;
  } catch (err) {
    throw new Error(
      `下载播放列表失败 (${(err as { response?: { status: number } }).response?.status ?? '网络错误'}): ${m3u8Url}`,
    ), { cause: err };
  }
  const m3u8Info = parseM3U8(m3u8Text, m3u8Url);

  if (m3u8Info.segments.length === 0) {
    throw new Error('播放列表中无视频分片');
  }

  // Phase D: optionally fetch AES key
  let aesKey: Buffer | undefined;
  let iv: Buffer | undefined;
  if (m3u8Info.keyUrl) {
    spinner.text = '正在获取解密密钥...';
    const keyResp = await axios.get(m3u8Info.keyUrl, { responseType: 'arraybuffer', headers: cdnHeaders });
    aesKey = Buffer.from(keyResp.data as ArrayBuffer);
    if (aesKey.length !== 16) {
      throw new Error(`无效加密密钥长度: ${aesKey.length} (期望 16 字节)`);
    }
    iv = Buffer.from(m3u8Info.ivHex.padStart(32, '0'), 'hex');
  }

  // Phase E: download segments (decrypt if encrypted)
  const total = m3u8Info.segments.length;
  const writeStream = createWriteStream(outputPath);
  let downloadedBytes = 0;

  try {
    for (let i = 0; i < total; i++) {
      spinner.text = `下载分片 ${i + 1}/${total} (${formatBytes(downloadedBytes)})`;

      const segResp = await axios.get(m3u8Info.segments[i], {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: cdnHeaders,
      });

      let chunk = Buffer.from(segResp.data as ArrayBuffer);
      if (aesKey && iv) {
        chunk = decryptSegment(chunk, aesKey, iv);
      }
      downloadedBytes += segResp.data.byteLength;

      await new Promise<void>((resolve, reject) => {
        writeStream.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  } catch (err) {
    writeStream.destroy();
    try { unlinkSync(outputPath); } catch { /* ignore */ }
    throw err;
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end((err: Error | null | undefined) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── DRM video download ─────────────────────────────────────────────

async function downloadDrmVideo(
  h5Client: ReturnType<typeof import('../api/client.js')['createH5ApiClient']>,
  koToken: string,
  appId: string,
  userId: string,
  playSign: string,
  outputPath: string,
  spinner: ora.Ora,
): Promise<void> {
  // Phase A: get play URL via getPlayUrl API
  const playResult = await getPlayUrl(h5Client, koToken, {
    orgAppId: appId,
    appId,
    userId: userId || '',
    playSign: [playSign],
  });

  if (playResult.code !== 0) {
    throw new Error(`获取 DRM 播放地址失败: ${playResult.msg}`);
  }

  // Response structure: data.<hash>.play_list.<quality>.play_url
  const data = playResult.data as Record<string, unknown>;
  const firstEntry = Object.values(data)[0] as Record<string, unknown> | undefined;
  const playList = firstEntry?.play_list as Record<string, Record<string, unknown>> | undefined;

  if (!playList) {
    throw new Error(
      `getPlayUrl 响应中无 play_list\n` +
      `API code=${playResult.code} data=${JSON.stringify(playResult.data)}`,
    );
  }

  const hlsEntry = playList['720p_hls']
    || Object.entries(playList).find(([k]) => k.endsWith('_hls'))?.[1];

  const m3u8Url = hlsEntry?.play_url as string | undefined;
  if (!m3u8Url) {
    throw new Error('未找到可播放的 HLS 流');
  }

  // Headers to mimic browser behavior (CDN may reject without these)
  const cdnHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Referer: 'https://study.xiaoe-tech.com/',
  };

  // Phase B: download and parse m3u8
  spinner.text = '正在下载播放列表...';
  let m3u8Text: string;
  try {
    const m3u8Resp = await axios.get(m3u8Url, { responseType: 'text', headers: cdnHeaders });
    m3u8Text = m3u8Resp.data as string;
  } catch (err) {
    throw new Error(
      `下载播放列表失败 (${(err as { response?: { status: number } }).response?.status ?? '网络错误'}): ${m3u8Url}`,
    ), { cause: err };
  }
  const m3u8Info = parseM3U8(m3u8Text, m3u8Url);

  if (m3u8Info.segments.length === 0) {
    throw new Error('播放列表中无视频分片');
  }

  if (!m3u8Info.keyUrl) {
    throw new Error('播放列表中未找到加密密钥地址');
  }

  // Phase C: fetch AES key
  spinner.text = '正在获取解密密钥...';
  const keyResp = await axios.get(m3u8Info.keyUrl, { responseType: 'arraybuffer', headers: cdnHeaders });
  const aesKey = Buffer.from(keyResp.data as ArrayBuffer);

  if (aesKey.length !== 16) {
    throw new Error(`无效加密密钥长度: ${aesKey.length} (期望 16 字节)`);
  }

  const iv = Buffer.from(m3u8Info.ivHex.padStart(32, '0'), 'hex');

  // Phase D: download and decrypt segments
  const total = m3u8Info.segments.length;
  const writeStream = createWriteStream(outputPath);
  let downloadedBytes = 0;

  try {
    for (let i = 0; i < total; i++) {
      spinner.text = `下载分片 ${i + 1}/${total} (${formatBytes(downloadedBytes)})`;

      const segResp = await axios.get(m3u8Info.segments[i], {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: cdnHeaders,
      });

      const encrypted = Buffer.from(segResp.data as ArrayBuffer);
      const decrypted = decryptSegment(encrypted, aesKey, iv);
      downloadedBytes += encrypted.length;

      await new Promise<void>((resolve, reject) => {
        writeStream.write(decrypted, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  } catch (err) {
    writeStream.destroy();
    try { unlinkSync(outputPath); } catch { /* ignore */ }
    throw err;
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end((err: Error | null | undefined) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Main download function ─────────────────────────────────────────

export interface DownloadOptions {
  quality?: string;
}

export async function downloadVideo(
  courseId: string,
  lessonId: string,
  options: DownloadOptions = {},
): Promise<void> {
  const spinner = ora('正在获取视频信息...').start();

  try {
    const { course, h5Client, koToken } = await getH5AuthContext(courseId);

    // ── Live replay path (l_ prefix) ────────────────────────────────
    if (lessonId.startsWith('l_')) {
      // _alive APIs require xiaoecloud.com domain (xiaoeknow.com returns 11302)
      const aliveBaseUrl = h5Client.defaults.baseURL?.replace('xiaoeknow.com', 'xiaoecloud.com')
        || h5Client.defaults.baseURL;
      const aliveClient = aliveBaseUrl !== h5Client.defaults.baseURL
        ? createH5ApiClient(aliveBaseUrl!)
        : h5Client;

      spinner.text = '正在获取直播回放信息...';

      const baseResult = await getAliveBaseInfo(aliveClient, koToken, {
        resourceId: lessonId,
        productId: courseId,
      });

      if (baseResult.code !== 0) {
        spinner.fail(chalk.red(`获取直播信息失败: ${baseResult.msg}`));
        return;
      }

      const { alive_info, alive_conf } = baseResult.data;
      const title = alive_info.title || lessonId;

      if (alive_info.alive_state !== 3) {
        spinner.fail(chalk.red('该直播尚未结束，无法下载回放'));
        return;
      }

      if (!alive_conf.is_lookback) {
        spinner.fail(chalk.red('该直播不支持回放'));
        return;
      }

      const courseDir = join('xiaoetong_download', sanitizeFileName(course.title || courseId));
      const videoName = sanitizeFileName(title);
      const outputPath = join(courseDir, `${videoName}.ts`);

      mkdirSync(courseDir, { recursive: true });

      try {
        const stat = statSync(outputPath);
        if (stat.size > 0) {
          spinner.info(chalk.yellow(`文件已存在: ${outputPath} (${formatBytes(stat.size)})`));
          return;
        }
      } catch { /* file doesn't exist, proceed */ }

      spinner.succeed(chalk.green(`${title} (直播回放)`));
      console.log(chalk.gray('使用 HLS 分片下载模式'));
      console.log(chalk.gray(`保存到: ${outputPath}`));
      console.log();

      const downloadSpinner = ora('正在获取回放播放地址...').start();
      await downloadLiveReplay(
        aliveClient,
        koToken,
        course.app_id,
        courseId,
        lessonId,
        outputPath,
        downloadSpinner,
      );

      // Convert .ts to .mp4 with ffmpeg
      let finalPath = outputPath;
      if (hasFfmpeg()) {
        downloadSpinner.text = '正在转换为 mp4...';
        try {
          finalPath = convertTsToMp4(outputPath);
          downloadSpinner.succeed(chalk.green(`下载完成: ${finalPath}`));
        } catch {
          downloadSpinner.succeed(chalk.green(`下载完成: ${outputPath}`));
          console.log(chalk.yellow('提示: ffmpeg 转换失败，已保留 .ts 文件'));
        }
      } else {
        downloadSpinner.succeed(chalk.green(`下载完成: ${outputPath}`));
        console.log(
          chalk.yellow('提示: 未检测到 ffmpeg，文件保存为 .ts 格式') + '\n' +
          chalk.yellow('      安装 ffmpeg 后可自动转为 .mp4:') + '\n' +
          chalk.cyan('      macOS: brew install ffmpeg'),
        );
      }
      return;
    }

    // ── Video path (v_ prefix) ──────────────────────────────────────
    spinner.text = '正在获取视频详情...';

    const videoResult = await getVideoDetail(h5Client, koToken, {
      resourceId: lessonId,
      productId: courseId,
    });

    if (videoResult.code !== 0) {
      spinner.fail(chalk.red(`获取视频详情失败: ${videoResult.msg}`));
      return;
    }

    const { video_info, video_urls } = videoResult.data;

    if (!video_info) {
      spinner.fail(chalk.red('未找到视频信息，请确认课时 ID 是否为视频类型'));
      return;
    }

    if (video_info.is_drm) {
      // DRM path: use getPlayUrl → m3u8 → AES decrypt → merge
      const courseDir = join('xiaoetong_download', sanitizeFileName(course.title || courseId));
      const videoName = sanitizeFileName(
        video_info.file_name
          ? video_info.file_name.replace(/\.mp4$/i, '')
          : lessonId,
      );
      const outputPath = join(courseDir, `${videoName}.ts`);

      mkdirSync(courseDir, { recursive: true });

      try {
        const stat = statSync(outputPath);
        if (stat.size > 0) {
          spinner.info(chalk.yellow(`文件已存在: ${outputPath} (${formatBytes(stat.size)})`));
          return;
        }
      } catch { /* file doesn't exist, proceed */ }

      spinner.succeed(chalk.green(`${video_info.file_name || lessonId} (DRM加密视频)`));
      console.log(chalk.gray('检测到 DRM 加密，使用 HLS 分片下载模式'));
      console.log(chalk.gray(`保存到: ${outputPath}`));
      console.log();

      if (!video_info.play_sign) {
        console.log(chalk.red('错误: 未获取到 play_sign，无法下载 DRM 视频'));
        process.exit(1);
      }

      const downloadSpinner = ora('正在获取 DRM 播放地址...').start();
      await downloadDrmVideo(
        h5Client,
        koToken,
        course.app_id,
        course.user_id,
        video_info.play_sign,
        outputPath,
        downloadSpinner,
      );

      // Try to convert .ts to .mp4 with ffmpeg
      let finalPath = outputPath;
      if (hasFfmpeg()) {
        downloadSpinner.text = '正在转换为 mp4...';
        try {
          finalPath = convertTsToMp4(outputPath);
          downloadSpinner.succeed(chalk.green(`下载完成: ${finalPath}`));
        } catch {
          downloadSpinner.succeed(chalk.green(`下载完成: ${outputPath}`));
          console.log(chalk.yellow('提示: ffmpeg 转换失败，已保留 .ts 文件'));
        }
      } else {
        downloadSpinner.succeed(chalk.green(`下载完成: ${outputPath}`));
        console.log(
          chalk.yellow('提示: 未检测到 ffmpeg，文件保存为 .ts 格式') + '\n' +
          chalk.yellow('      安装 ffmpeg 后可自动转为 .mp4:') + '\n' +
          chalk.cyan('      macOS: brew install ffmpeg') + '\n' +
          chalk.cyan('      Ubuntu: sudo apt install ffmpeg') + '\n' +
          chalk.cyan('      Windows: https://ffmpeg.org/download.html'),
        );
      }
      return;
    }

    // Decode video URLs
    let urlList: VideoUrlItem[] = [];
    if (video_urls) {
      urlList = decodeVideoUrls(video_urls);
    }

    if (urlList.length === 0) {
      spinner.fail(chalk.yellow('无法解析视频播放地址'));
      return;
    }

    // Select quality
    let selected: VideoUrlItem;
    if (options.quality) {
      const match = urlList.find(
        (item) =>
          item.definition_name === options.quality ||
          item.definition_p === options.quality,
      );
      if (!match) {
        spinner.fail(
          chalk.red(
            `未找到清晰度 "${options.quality}"，可用: ${urlList.map((u) => u.definition_name).join(', ')}`,
          ),
        );
        return;
      }
      selected = match;
    } else {
      // Default: highest quality (last in list, typically sorted low→high)
      selected = urlList[urlList.length - 1];
    }

    // Prepare output path
    const courseDir = join('xiaoetong_download', sanitizeFileName(course.title || courseId));
    const videoName = sanitizeFileName(
      video_info.file_name
        ? video_info.file_name.replace(/\.mp4$/i, '')
        : lessonId,
    );
    const ext = selected.url.includes('.m3u8') ? '.ts' : '.mp4';
    const outputPath = join(courseDir, `${videoName}${ext}`);

    // Create directory
    mkdirSync(courseDir, { recursive: true });

    // Check if file already exists and has content
    try {
      const stat = statSync(outputPath);
      if (stat.size > 0) {
        spinner.info(chalk.yellow(`文件已存在: ${outputPath} (${formatBytes(stat.size)})`));
        return;
      }
    } catch { /* file doesn't exist, proceed */ }

    spinner.succeed(
      chalk.green(
        `${video_info.file_name || lessonId} (${selected.definition_name})`,
      ),
    );

    // Show quality options
    console.log(chalk.gray(`清晰度: ${selected.definition_name} (${selected.definition_p})`));
    console.log(chalk.gray(`保存到: ${outputPath}`));
    console.log();

    // Download
    const downloadSpinner = ora('正在下载...').start();
    await downloadFile(selected.url, outputPath, downloadSpinner);
    downloadSpinner.succeed(chalk.green(`下载完成: ${outputPath}`));
  } catch (err) {
    spinner.fail(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

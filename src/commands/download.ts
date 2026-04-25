import { Command } from 'commander';
import chalk from 'chalk';
import { downloadVideo } from '../services/download.js';

export function registerDownloadCommand(program: Command): void {
  program
    .command('download <course_id> <lesson_id>')
    .description('下载视频课时')
    .option('-q, --quality <level>', '指定清晰度 (如 720p, 1080p)')
    .action(async (courseId: string, lessonId: string, opts: { quality?: string }) => {
      try {
        await downloadVideo(courseId, lessonId, { quality: opts.quality });
      } catch (err) {
        console.error(chalk.red(`错误: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

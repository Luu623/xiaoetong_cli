import { Command } from 'commander';
import chalk from 'chalk';
import { transcribeLesson } from '../services/stt.js';

export function registerSttCommand(program: Command): void {
  program
    .command('stt <course_id> <lesson_id>')
    .description('语音转文字转录课时内容')
    .option('--lang <lang>', '语言', 'zh')
    .action(async (courseId: string, lessonId: string, opts: { lang?: string }) => {
      try {
        await transcribeLesson(courseId, lessonId, { lang: opts.lang });
      } catch (err) {
        console.error(chalk.red(`错误: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

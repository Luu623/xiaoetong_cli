import { Command } from 'commander';
import chalk from 'chalk';
import { listCourses, showCourseTree } from '../services/course.js';

export function registerCourseCommand(program: Command): void {
  program
    .command('courses')
    .description('获取已购买的课程列表')
    .option('-p, --page <number>', '页码', '1')
    .action(async (options) => {
      try {
        await listCourses({ page: Number(options.page) });
      } catch (err) {
        console.error(chalk.red(`错误: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  program
    .command('course <resource_id>')
    .description('获取课程目录树')
    .action(async (resourceId: string) => {
      try {
        await showCourseTree(resourceId);
      } catch (err) {
        console.error(chalk.red(`错误: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import { registerLoginCommand } from './commands/login.js';
import { registerCourseCommand } from './commands/course.js';
import { registerDownloadCommand } from './commands/download.js';
import { registerSttCommand } from './commands/stt.js';

const program = new Command();

program
  .name('xe')
  .description('小鹅通学习平台 CLI 工具')
  .version('0.1.0');

registerLoginCommand(program);
registerCourseCommand(program);
registerDownloadCommand(program);
registerSttCommand(program);

program.parse();

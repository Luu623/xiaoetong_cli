import { Command } from 'commander';
import chalk from 'chalk';
import { loginWithQR } from '../services/auth.js';
import { getToken, loadConfig, saveConfig } from '../config/store.js';
import { createApiClient } from '../api/client.js';
import { checkToken } from '../api/auth.js';

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('通过微信扫码登录')
    .action(async () => {
      try {
        await loginWithQR();
      } catch (err) {
        console.error(chalk.red(`错误: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  program
    .command('whoami')
    .description('查看当前登录状态')
    .action(async () => {
      const token = getToken();
      if (!token) {
        console.log(chalk.yellow('未登录。运行 "xe login" 登录。'));
        return;
      }

      try {
        const client = createApiClient();
        const result = await checkToken(client, token);
        if (result.code === 0) {
          const config = loadConfig();
          console.log(chalk.green('已登录'));
          if (config.user) {
            console.log(`  用户: ${config.user.nickname}`);
            console.log(`  ID: ${config.user.user_id}`);
          }
          if (config.login_time) {
            console.log(`  登录时间: ${config.login_time}`);
          }
        } else {
          console.log(chalk.red('登录已过期，请重新登录。'));
        }
      } catch {
        console.log(chalk.red('无法验证登录状态，请重新登录。'));
      }
    });

  program
    .command('logout')
    .description('退出登录')
    .action(() => {
      const config = loadConfig();
      if (!config.p_token) {
        console.log(chalk.yellow('当前未登录。'));
        return;
      }
      saveConfig({});
      console.log(chalk.green('已退出登录。'));
    });
}

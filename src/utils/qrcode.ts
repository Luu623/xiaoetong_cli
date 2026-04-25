import { exec } from 'node:child_process';
import chalk from 'chalk';

export async function displayQrCode(imgUrl: string): Promise<void> {
  console.log(chalk.cyan('\n请在浏览器中打开二维码，使用微信扫描登录:\n'));
  console.log(chalk.blue.underline(imgUrl));
  console.log('');

  // Try to open in default browser
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${imgUrl}"`, (err) => {
    if (!err) {
      console.log(chalk.gray('已在浏览器中打开二维码。'));
    }
  });
}

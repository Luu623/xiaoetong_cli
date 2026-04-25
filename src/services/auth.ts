import chalk from 'chalk';
import ora from 'ora';
import { createApiClient } from '../api/client.js';
import { createScanCode, pollScanStatus } from '../api/auth.js';
import { displayQrCode } from '../utils/qrcode.js';
import { saveConfig, getToken, type UserInfo } from '../config/store.js';
import { checkToken } from '../api/auth.js';

const POLL_INTERVAL = 2000;
const MAX_POLL_ATTEMPTS = 90;

export async function loginWithQR(): Promise<void> {
  // Check if already logged in and token is still valid
  const existing = getToken();
  if (existing) {
    try {
      const client = createApiClient();
      const result = await checkToken(client, existing);
      if (result.code === 0) {
        console.log(chalk.yellow('你已经登录了。'));
        console.log(chalk.gray('运行 "xe logout" 登出，或 "xe whoami" 查看状态。'));
        return;
      }
    } catch {
      // Token validation failed, proceed to re-login
    }
    saveConfig({});
  }

  const client = createApiClient();

  // Step 1: Create scan code
  const spinner = ora('正在生成微信二维码...').start();
  let scanData;
  try {
    scanData = await createScanCode(client);
  } catch (err) {
    spinner.fail('生成二维码失败');
    throw err;
  }
  spinner.stop();

  // Step 2: Display QR code
  await displayQrCode(scanData.img_url);
  console.log(chalk.yellow('等待微信扫码...'));
  console.log(chalk.gray('按 Ctrl+C 取消。\n'));

  // Step 3: Poll for scan status
  const pollSpinner = ora('等待扫码中...').start();

  try {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const result = await pollScanStatus(client, scanData.code);

      switch (result.status) {
        case 10000: {
          pollSpinner.succeed(chalk.green('登录成功!'));

          // Extract p_token
          const pToken = result._pToken;
          if (!pToken) {
            console.error(chalk.red('未能获取登录凭证 (p_token)。'));
            console.log(chalk.gray('Set-Cookie header:'), result._setCookie);
            return;
          }

          // Parse user info
          let userInfo: UserInfo | undefined;
          if (typeof result.user === 'object' && result.user !== null) {
            userInfo = result.user as UserInfo;
          }

          saveConfig({
            p_token: pToken,
            user: userInfo,
            login_time: new Date().toISOString(),
          });

          console.log(
            chalk.green(`欢迎${userInfo?.nickname ? '，' + userInfo.nickname : ''}!`),
          );
          return;
        }

        case 10002:
          pollSpinner.text = `等待扫码中... (${attempt + 1}/${MAX_POLL_ATTEMPTS})`;
          break;

        case 10003:
          // 10003 = 已扫码，等待用户在微信中确认授权（不是取消！）
          pollSpinner.text = chalk.cyan('已扫码，请在微信中点击"允许"...');
          break;

        case 10004:
          pollSpinner.fail(chalk.red('二维码已过期，请重试。'));
          return;

        case 10006:
          // 用户在微信中取消了授权，但可以重新扫码
          pollSpinner.text = chalk.yellow('用户取消了授权，请重新扫码...');
          break;

        case 10005:
        case 10044:
          pollSpinner.fail(chalk.red('扫码失败，请重试。'));
          return;

        default:
          pollSpinner.warn(`未知状态: ${result.status}`);
          break;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }

    pollSpinner.fail(chalk.red('登录超时，请重试。'));
  } catch (err) {
    pollSpinner.fail('登录失败');
    throw err;
  }
}

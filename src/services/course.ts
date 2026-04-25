import chalk from 'chalk';
import ora from 'ora';
import type { AxiosInstance } from 'axios';
import { createApiClient, createH5ApiClient } from '../api/client.js';
import {
  getAttendNormalList,
  getGatewayUrl,
  authenticateH5,
  getCatalogList,
  type AttendListItem,
  type CatalogItem,
} from '../api/course.js';
import { getToken } from '../config/store.js';

const RESOURCE_TYPE_NAMES: Record<number, string> = {
  1: '图文',
  2: '音频',
  3: '视频',
  4: '直播',
  5: '会员',
  6: '专栏',
  7: '圈子',
  8: '大纲课',
  11: '作业',
  16: '打卡',
  20: '电子书',
  25: '训练营',
  27: '考试',
  34: '练习',
  35: '班课',
  38: '考试',
  45: 'AI互动课',
  50: '训练营pro',
};

function getResourceTypeName(type: number): string {
  return RESOURCE_TYPE_NAMES[type] ?? `未知(${type})`;
}

export async function listCourses(options: { page?: number } = {}): Promise<void> {
  const token = getToken();
  if (!token) {
    console.log(chalk.yellow('未登录。运行 "xe login" 登录。'));
    return;
  }

  const spinner = ora('正在获取课程列表...').start();
  const client = createApiClient();

  try {
    const result = await getAttendNormalList(client, token, {
      page: options.page ?? 1,
      pageSize: 16,
    });

    if (result.code !== 0) {
      spinner.fail(chalk.red(`获取课程列表失败: ${result.msg}`));
      if (result.code === 9999 || result.code === -1001) {
        console.log(chalk.yellow('登录已过期，请运行 "xe login" 重新登录。'));
      }
      return;
    }

    const { list, is_end } = result.data;

    if (!list || list.length === 0) {
      spinner.info('暂无已购课程。');
      return;
    }

    spinner.succeed(chalk.green(`已获取 ${list.length} 门课程`));

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const typeName = getResourceTypeName(item.resource_type);
      const index = chalk.gray(`${(i + 1).toString().padStart(2, ' ')}.`);
      const title = chalk.white(item.title || '无标题');
      const tag = chalk.cyan(`[${typeName}]`);

      const rid = chalk.gray(item.resource_id);
      console.log(`${index} ${title} ${tag}`);
      console.log(`     ${rid}`);
    }

    console.log();
    console.log(chalk.gray(`第 ${options.page ?? 1} 页${is_end ? ' (已是最后一页)' : ` — 使用 -p ${(options.page ?? 1) + 1} 查看下一页`}`));
  } catch (err) {
    spinner.fail(chalk.red('获取课程列表失败'));
    throw err;
  }
}

// ── Course Tree ─────────────────────────────────────────────────────

interface CourseTreeNode {
  id: string;
  resourceId: string;
  title: string;
  type: 'chapter' | 'lesson';
  resourceType: number;
  progress: number;
  sectionNum?: number;
  children: CourseTreeNode[];
}

export async function findCourse(resourceId: string, token: string): Promise<AttendListItem> {
  const client = createApiClient();
  let page = 1;

  while (true) {
    const result = await getAttendNormalList(client, token, { page, pageSize: 16 });
    if (result.code !== 0) {
      throw new Error(`获取课程列表失败: ${result.msg}`);
    }

    const found = result.data.list?.find(item => item.resource_id === resourceId);
    if (found) return found;

    if (result.data.is_end || !result.data.list || result.data.list.length === 0) {
      throw new Error(`未找到课程 ${resourceId}，请确认 resource_id 是否正确`);
    }
    page++;
  }
}

// ── Shared H5 Auth Context ──────────────────────────────────────────

export interface H5AuthContext {
  course: AttendListItem;
  h5Client: AxiosInstance;
  koToken: string;
}

export async function getH5AuthContext(courseId: string): Promise<H5AuthContext> {
  const token = getToken();
  if (!token) {
    throw new Error('未登录。运行 "xe login" 登录。');
  }

  const course = await findCourse(courseId, token);

  const gatewayResult = await getGatewayUrl(token, {
    type: 2,
    app_id: course.app_id,
    user_id: course.user_id || '',
    resource_type: course.resource_type,
    resource_id: course.resource_id,
    content_app_id: course.content_app_id || '',
  });

  if (gatewayResult.code !== 0) {
    throw new Error(`获取网关地址失败: ${gatewayResult.msg}`);
  }

  const { koToken, baseUrl } = await authenticateH5(gatewayResult.data.url);
  const h5Client = createH5ApiClient(baseUrl);

  return { course, h5Client, koToken };
}

async function buildTree(
  h5Client: ReturnType<typeof createH5ApiClient>,
  koToken: string,
  appId: string,
  resourceId: string,
  pId: string,
): Promise<CourseTreeNode[]> {
  const pageSize = 50;
  let page = 1;
  const allItems: CatalogItem[] = [];

  // Fetch all items at this level (handle pagination)
  while (true) {
    const result = await getCatalogList(h5Client, koToken, {
      appId,
      resourceId,
      courseId: resourceId,
      pId,
      page,
      pageSize,
    });

    if (result.code !== 0) {
      throw new Error(`获取课程目录失败: ${result.msg}`);
    }

    const list = result.data.list || [];
    allItems.push(...list);

    if (list.length === 0 || list.length < pageSize) break;
    page++;
  }

  // Build tree nodes, recursing into chapters
  const nodes: CourseTreeNode[] = [];
  for (const item of allItems) {
    const node: CourseTreeNode = {
      id: item.chapter_id,
      resourceId: item.resource_id,
      title: item.resource_title,
      // debug: log raw item when chapter_id differs from resource_id
      ...(item.chapter_id !== item.resource_id ? { _debug_raw: JSON.stringify({ chapter_id: item.chapter_id, resource_id: item.resource_id, resource_type: item.resource_type }) } : {}),
      type: item.chapter_type === 1 ? 'chapter' : 'lesson',
      resourceType: item.resource_type,
      progress: item.learn_progress ?? 0,
      sectionNum: item.section_num,
      children: [],
    };

    if (item.chapter_type === 1) {
      node.children = await buildTree(h5Client, koToken, appId, resourceId, item.chapter_id);
    }

    nodes.push(node);
  }

  return nodes;
}

function renderTree(nodes: CourseTreeNode[], prefix: string = '', isLastFlags: boolean[] = []): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;

    // Build connector prefix
    const connector = isLast ? '└── ' : '├── ';

    // Build ancestor indent
    let indent = '';
    for (const flag of isLastFlags) {
      indent += flag ? '    ' : '│   ';
    }

    if (node.type === 'chapter') {
      const sectionInfo = node.sectionNum ? chalk.gray(` (${node.sectionNum}课时)`) : '';
      console.log(`${prefix}${indent}${connector}${chalk.bold.cyan(node.title)}${sectionInfo}`);
    } else {
      // Lesson
      const typeName = getResourceTypeName(node.resourceType);
      const tag = chalk.gray(`[${typeName}]`);
      const progress = node.progress > 0
        ? (node.progress >= 100 ? chalk.green(' ✓') : chalk.yellow(` ${node.progress}%`))
        : '';
      console.log(`${prefix}${indent}${connector}${node.title} ${tag}${progress}  ${chalk.gray(node.id)}`);
    }

    if (node.children.length > 0) {
      renderTree(node.children, prefix, [...isLastFlags, isLast]);
    }
  }
}

export async function showCourseTree(resourceId: string): Promise<void> {
  const spinner = ora('正在查找课程...').start();

  try {
    const { course, h5Client, koToken } = await getH5AuthContext(resourceId);

    spinner.text = '正在获取课程目录...';
    const tree = await buildTree(h5Client, koToken, course.app_id, resourceId, '0');

    // Render
    spinner.succeed(chalk.green(`「${course.title}」目录获取成功`));
    const typeName = getResourceTypeName(course.resource_type);
    console.log(chalk.bold.white(course.title) + chalk.cyan(` [${typeName}]`));
    renderTree(tree);
  } catch (err) {
    spinner.fail(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}


import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

// ── Common ──────────────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
  forward_url: string;
}

// ── Course List ─────────────────────────────────────────────────────

export interface AttendListItem {
  resource_id: string;
  resource_type: number;
  title: string;
  img_url: string;
  app_id: string;
  user_id: string;
  content_app_id: string;
  shop_name?: string;
  progress?: number;
  alive_status?: number;
  last_learn_time?: string;
  [key: string]: unknown;
}

export interface AttendListData {
  list: AttendListItem[];
  is_end: boolean;
}

export async function getAttendNormalList(
  client: AxiosInstance,
  pToken: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<ApiResponse<AttendListData>> {
  const { page = 1, pageSize = 16 } = options;
  const params = new URLSearchParams({
    page_size: String(pageSize),
    page: String(page),
    agent_type: '7',
    resource_type: '["0"]',
  });

  const { data }: AxiosResponse<ApiResponse<AttendListData>> = await client.post(
    '/xe.learn-pc/my_attend_normal_list.get/1.0.1',
    params.toString(),
    { headers: { Cookie: `p_token=${pToken}` } },
  );
  return data;
}

export async function getAttendList(
  client: AxiosInstance,
  pToken: string,
  options: { page?: number; pageSize?: number; tab?: string } = {},
): Promise<ApiResponse<AttendListData>> {
  const { page = 1, pageSize = 16, tab = 'alive' } = options;
  const params = new URLSearchParams({
    page_size: String(pageSize),
    page: String(page),
    tab,
  });

  const { data }: AxiosResponse<ApiResponse<AttendListData>> = await client.get(
    '/xe.learn-pc/my_attend_list.get/1.0.0',
    { params: Object.fromEntries(params), headers: { Cookie: `p_token=${pToken}` } },
  );
  return data;
}

// ── Gateway ─────────────────────────────────────────────────────────

export interface GatewayRequestBody {
  type: number;
  app_id: string;
  user_id: string;
  resource_type: number;
  resource_id: string;
  content_app_id: string;
}

export interface GatewayResponseData {
  url: string;
}

export async function getGatewayUrl(
  pToken: string,
  body: GatewayRequestBody,
): Promise<ApiResponse<GatewayResponseData>> {
  const { data }: AxiosResponse<ApiResponse<GatewayResponseData>> = await axios.post(
    'https://study.xiaoe-tech.com/xe.learn-pc/get_new_gateway/1.0.0',
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `p_token=${pToken}`,
      },
    },
  );
  return data;
}

// ── H5 Authentication ───────────────────────────────────────────────

function extractKoToken(setCookie: string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  for (const cookie of setCookie) {
    const match = cookie.match(/ko_token=([^;]+)/);
    if (match) return match[1];
  }
  return undefined;
}

function extractRedirectUrl(html: string): string | undefined {
  const patterns = [
    /window\.location\.href\s*=\s*["']([^"']+)["']/,
    /location\.replace\s*\(\s*["']([^"']+)["']\)/,
    /https?:\/\/[^\s"']+(xiaoecloud\.com|xet\.citv\.cn)\/platform\/login_cooperate[^\s"']*/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1] || match[0];
  }
  return undefined;
}

export interface H5AuthResult {
  koToken: string;
  baseUrl: string;  // e.g. https://appttezzxyn5858.h5.xet.citv.cn
}

function extractBaseUrl(urlStr: string): string {
  const url = new URL(urlStr);
  return `${url.protocol}//${url.host}`;
}

export async function authenticateH5(gatewayUrl: string): Promise<H5AuthResult> {
  // Step 1: fetch gateway URL — returns HTML with JS redirect
  const htmlResp = await axios.get(gatewayUrl, {
    maxRedirects: 0,
    validateStatus: () => true,
  });

  const koTokenFromStep1 = extractKoToken(htmlResp.headers['set-cookie']);
  if (koTokenFromStep1) {
    // Extract base URL from gateway URL itself
    const gatewayBase = extractBaseUrl(gatewayUrl);
    // Gateway may redirect, but if ko_token is already here, use the gateway's domain hint
    const redirectUrl = extractRedirectUrl(htmlResp.data as string);
    const baseUrl = redirectUrl ? extractBaseUrl(redirectUrl) : gatewayBase;
    return { koToken: koTokenFromStep1, baseUrl };
  }

  // Step 2: extract redirect URL from HTML
  const redirectUrl = extractRedirectUrl(htmlResp.data as string);
  if (!redirectUrl) {
    throw new Error('无法从网关页面提取认证跳转地址');
  }

  // Step 3: follow redirects manually until ko_token found
  let currentUrl = redirectUrl;
  const MAX_HOPS = 10;

  for (let i = 0; i < MAX_HOPS; i++) {
    const resp = await axios.get(currentUrl, {
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const koToken = extractKoToken(resp.headers['set-cookie']);
    if (koToken) {
      return { koToken, baseUrl: extractBaseUrl(currentUrl) };
    }

    const location = resp.headers['location'];
    if (!location || resp.status < 300 || resp.status >= 400) {
      throw new Error(`H5 认证失败：在第 ${i + 1} 步未获取到 ko_token（status=${resp.status}）`);
    }

    currentUrl = location;
  }

  throw new Error('H5 认证失败：超过最大重定向次数');
}

// ── Course Catalog ──────────────────────────────────────────────────

export interface CatalogItem {
  chapter_id: string;
  chapter_type: number;       // 1 = chapter (folder), 2 = lesson (leaf)
  resource_id: string;
  resource_title: string;
  resource_type: number;
  learn_progress: number;
  section_num?: number;
  study_status?: number;
}

export interface CatalogListData {
  list: CatalogItem[];
  total: number;
  page: number;
  has_chapter: boolean;
}

export async function getCatalogList(
  client: AxiosInstance,
  koToken: string,
  params: {
    appId: string;
    resourceId: string;
    courseId: string;
    pId: string;
    page?: number;
    pageSize?: number;
  },
): Promise<ApiResponse<CatalogListData>> {
  const { appId, resourceId, courseId, pId, page = 1, pageSize = 50 } = params;
  const form = new URLSearchParams({
    'bizData[app_id]': appId,
    'bizData[resource_id]': resourceId,
    'bizData[course_id]': courseId,
    'bizData[p_id]': pId,
    'bizData[order]': 'asc',
    'bizData[page]': String(page),
    'bizData[page_size]': String(pageSize),
  });

  const { data }: AxiosResponse<ApiResponse<CatalogListData>> = await client.post(
    '/xe.course.business_go.avoidlogin.e_course.resource_catalog_list.get/1.0.0',
    form.toString(),
    { headers: { Cookie: `ko_token=${koToken}` } },
  );
  return data;
}

// ── Video Detail ─────────────────────────────────────────────────────

export interface VideoDetailInfo {
  app_id: string;
  file_name: string;
  is_drm: number;
  is_transcode: number;
  material_id: string;
  patch_img_url: string;
  play_sign: string;
  resource_id: string;
  resource_type: number;
  video_audio_url: string;
  video_length: number;
  [key: string]: unknown;
}

export interface VideoDetailData {
  video_info: VideoDetailInfo;
  video_urls: string;
  is_try: number;
  is_auto_play: number;
  user_last_process: number;
  [key: string]: unknown;
}

export async function getVideoDetail(
  client: AxiosInstance,
  koToken: string,
  params: {
    resourceId: string;
    productId: string;
  },
): Promise<ApiResponse<VideoDetailData>> {
  const form = new URLSearchParams({
    'bizData[resource_id]': params.resourceId,
    'bizData[product_id]': params.productId,
    'bizData[opr_sys]': 'MacIntel',
  });

  const { data }: AxiosResponse<ApiResponse<VideoDetailData>> = await client.post(
    '/xe.course.business_go.video.detail_info.get/2.0.0',
    form.toString(),
    { headers: { Cookie: `ko_token=${koToken}` } },
  );
  return data;
}

// ── DRM Play URL ────────────────────────────────────────────────────

export interface PlayUrlQuality {
  desc: string;
  encrypt_type: string;
  is_support: boolean;
  play_url: string;
  ext: {
    host: string;
    path: string;
    param: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PlayUrlData {
  // Response is keyed by a hash string, each value contains play_list etc.
  [hashKey: string]: {
    support_list: string[];
    default_play: string;
    play_list: Record<string, PlayUrlQuality>;
    [key: string]: unknown;
  };
}

export async function getPlayUrl(
  client: AxiosInstance,
  koToken: string,
  params: {
    orgAppId: string;
    appId: string;
    userId: string;
    playSign: string[];
    playLine?: string;
    oprSys?: string;
  },
): Promise<ApiResponse<PlayUrlData>> {
  const body = {
    org_app_id: params.orgAppId,
    app_id: params.appId,
    user_id: params.userId,
    play_sign: params.playSign,
    play_line: params.playLine ?? 'A',
    opr_sys: params.oprSys ?? 'MacIntel',
  };

  const { data }: AxiosResponse<ApiResponse<PlayUrlData>> = await client.post(
    'xe.material-center.play/getPlayUrl',
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `ko_token=${koToken}`,
      },
    },
  );
  return data;
}

// ── Live Replay (直播回放) ──────────────────────────────────────────

export interface AliveInfo {
  alive_id: string;
  title: string;
  alive_state: number;  // 3 = ended
  app_id: string;
  room_id: string;
  product_id: string;
  resource_type: number;
  img_url: string;
  [key: string]: unknown;
}

export interface AliveBaseInfoData {
  alive_info: AliveInfo;
  alive_conf: {
    is_lookback: number;  // 1 = has replay
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function getAliveBaseInfo(
  client: AxiosInstance,
  koToken: string,
  params: {
    resourceId: string;
    productId: string;
  },
): Promise<ApiResponse<AliveBaseInfoData>> {
  const { data }: AxiosResponse<ApiResponse<AliveBaseInfoData>> = await client.get(
    '/_alive/v3/base_info',
    {
      params: {
        resource_id: params.resourceId,
        product_id: params.productId,
        type: 12,
        is_direct: 1,
        file_tag: 1,
      },
      headers: { Cookie: `ko_token=${koToken}` },
    },
  );
  return data;
}

export interface LookbackSharpness {
  name: string;
  resolution: string;
  url: string;
  material_id: string;
  default: boolean;
  cloud: string;
  type: string;  // "lookBack"
  [key: string]: unknown;
}

export interface LookbackLine {
  line_name: string;
  default: boolean;
  line_sharpness: LookbackSharpness[];
}

export async function getLookbackList(
  client: AxiosInstance,
  koToken: string,
  params: {
    appId: string;
    aliveId: string;
  },
): Promise<ApiResponse<LookbackLine[]>> {
  const { data }: AxiosResponse<ApiResponse<LookbackLine[]>> = await client.get(
    '/_alive/v3/get_lookback_list',
    {
      params: {
        app_id: params.appId,
        alive_id: params.aliveId,
      },
      headers: { Cookie: `ko_token=${koToken}` },
    },
  );
  return data;
}

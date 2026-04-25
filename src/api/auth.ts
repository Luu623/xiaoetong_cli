import type { AxiosInstance, AxiosResponse } from 'axios';
import type { UserInfo } from '../config/store.js';

interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
  forward_url: string;
}

export interface ScanCodeData {
  code: string;
  img_url: string;
}

export interface ScanStatusData {
  status: number;
  token_info: string;
  user: string | UserInfo;
  bind_wx_info: string;
}

export interface PollResult extends ScanStatusData {
  _setCookie?: string[];
  _pToken?: string;
}

function extractPToken(setCookie: string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  for (const cookie of setCookie) {
    const match = cookie.match(/p_token=([^;]+)/);
    if (match) return match[1];
  }
  return undefined;
}

export async function createScanCode(client: AxiosInstance): Promise<ScanCodeData> {
  const { data }: AxiosResponse<ApiResponse<ScanCodeData>> = await client.post(
    '/xe.learn-pc.create_scan_code/1.0.0',
  );
  if (data.code !== 0) throw new Error(`Create scan code failed: ${data.msg}`);
  return data.data;
}

export async function pollScanStatus(
  client: AxiosInstance,
  sessionId: string,
): Promise<PollResult> {
  const params = new URLSearchParams({ code: sessionId });
  const { data, headers }: AxiosResponse<ApiResponse<ScanStatusData>> = await client.post(
    '/xe.learn-pc.scan_status_get/1.0.0',
    params.toString(),
  );
  if (data.code !== 0) throw new Error(`Poll status failed: ${data.msg}`);

  const setCookie = headers['set-cookie'] as string[] | undefined;
  return {
    ...data.data,
    _setCookie: setCookie,
    _pToken: extractPToken(setCookie),
  };
}

export async function checkToken(
  client: AxiosInstance,
  pToken: string,
): Promise<ApiResponse> {
  const { data }: AxiosResponse<ApiResponse> = await client.post(
    '/xe.learn-pc.user/check_token',
    '',
    { headers: { Cookie: `p_token=${pToken}` } },
  );
  return data;
}

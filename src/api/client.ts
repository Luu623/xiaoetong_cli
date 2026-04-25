import axios, { type AxiosInstance } from 'axios';
import { generateReqUuid } from '../utils/uuid.js';

export function createApiClient() {
  const client = axios.create({
    baseURL: 'https://study.xiaoe-tech.com',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'retry': '1',
    },
  });

  client.interceptors.request.use((config) => {
    config.headers['req-uuid'] = generateReqUuid();
    return config;
  });

  return client;
}

export function createH5ApiClient(appIdOrBaseUrl: string): AxiosInstance {
  const isBaseUrl = appIdOrBaseUrl.startsWith('http');
  const client = axios.create({
    baseURL: isBaseUrl ? appIdOrBaseUrl : `https://${appIdOrBaseUrl}.h5.xiaoecloud.com`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });

  client.interceptors.request.use((config) => {
    config.headers['req-uuid'] = generateReqUuid();
    return config;
  });

  return client;
}

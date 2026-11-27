export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  if (
    (!init?.method || init.method === 'GET') &&
    [
      '/overview',
      '/competitors',
      '/competitor-profiles',
      '/dramas',
      '/intelligence',
      '/candidates',
      '/research',
      '/schedules',
      '/tasks',
      '/tasks/assignees',
      '/intelligence/assignees',
    ].includes(url.pathname.slice(4))
  ) {
    const product = new URLSearchParams(window.location.search).get('product');
    if (product && !url.searchParams.has('product'))
      url.searchParams.set('product', product);
  }
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = (await response.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      Array.isArray(data.message)
        ? data.message.join('；')
        : (data.message ?? '请求失败，请稍后重试'),
    );
  return data as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

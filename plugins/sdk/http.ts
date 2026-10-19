import type { Ctx, Manifest, RequestOptions } from './types.ts';

/** One GET in whatever way the environment allows (fetch, CapacitorHttp, the dev proxy). */
export type Get = (
  url: string,
  headers?: Record<string, string>,
) => Promise<{ status: number; text: string }>;

/**
 * ctx.http for a plugin: only the manifest's domains, and non-2xx is an error.
 * The domain check catches mistakes; it isn't a security boundary.
 */
export function makeHttp(manifest: Manifest, get: Get): Ctx['http'] {
  async function text(url: string, options?: RequestOptions): Promise<string> {
    const host = /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();
    if (!host || !manifest.domains.some((domain) => domain.toLowerCase() === host))
      throw new Error(`${manifest.id}: ${url} isn't in the manifest's "domains"`);
    const response = await get(url, options?.headers);
    if (response.status < 200 || response.status >= 300)
      throw new Error(`${host} returned ${response.status}`);
    return response.text;
  }
  return {
    text,
    async json<T>(url: string, options?: RequestOptions) {
      return JSON.parse(await text(url, options)) as T;
    },
  };
}

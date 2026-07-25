import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../index.js';

const COOKIE = `a1=${'a'.repeat(52)}; web_session=test-session`;

const callLite = (command: string, body: Record<string, unknown> = {}) =>
  worker.fetch(
    new Request(`https://local.test/api/${command}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xhs-cookie': COOKIE,
      },
      body: JSON.stringify(body),
    }),
    {},
    { waitUntil() {} },
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('XHS Lite session-risk headers', () => {
  it('keeps search on the previously stable request shape', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await callLite('search', { keyword: '小猫' });

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has('x-rap-param')).toBe(false);
    expect(headers.has('xy-direction')).toBe(false);
    expect(headers.get('user-agent')).toContain('Chrome/138.0.0.0');
    expect(headers.get('sec-ch-ua')).toContain('Chromium";v="138"');
  });

  it('uses one XYW comment request without a risky legacy retry', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/sns/web/v1/feed')) {
        return new Response(JSON.stringify({
          success: true,
          data: { items: [{ note_card: { title: 'test', desc: 'body' } }] },
        }));
      }
      return new Response(JSON.stringify({
        success: false,
        code: 300011,
        msg: 'comment request rejected',
      }));
    });

    const response = await callLite('get-feed-detail', {
      feed_id: 'note-id',
      xsec_token: 'token',
      xsec_source: 'pc_share',
      load_all_comments: true,
    });

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);

    const [, detailInit] = upstream.mock.calls[0];
    const detailHeaders = new Headers(detailInit?.headers);
    expect(detailHeaders.has('x-rap-param')).toBe(false);
    expect(detailHeaders.get('xy-direction')).toBe('13');

    const [, commentInit] = upstream.mock.calls[1];
    const commentHeaders = new Headers(commentInit?.headers);
    expect(commentHeaders.get('x-s')).toMatch(/^XYW_/);
    expect(commentHeaders.has('xy-direction')).toBe(false);
  });
});

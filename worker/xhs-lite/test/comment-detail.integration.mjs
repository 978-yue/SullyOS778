import assert from 'node:assert/strict';
import worker from '../../index.js';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).includes('/api/sns/web/v1/feed')) {
    return Response.json({
      success: true,
      data: {
        items: [{
          note_card: {
            title: 'test note',
            desc: 'body',
            user: { nickname: 'author' },
            interact_info: { comment_count: '42' },
          },
        }],
      },
    });
  }
  if (String(url).includes('/api/sns/web/v2/comment/page')) {
    const headers = new Headers(init.headers);
    assert.match(headers.get('x-s') || '', /^XYS_/);
    assert.match(headers.get('user-agent') || '', /Chrome\/121/);
    assert.match(String(url), /image_formats=jpg%2Cwebp%2Cavif/);
    return Response.json({
      success: true,
      code: 0,
      data: {
        comments: [{
          id: 'comment-1',
          content: '具体评论内容',
          user_info: { nickname: 'commenter', user_id: 'user-1' },
          sub_comments: [{
            id: 'reply-1',
            content: '具体回复内容',
            user_info: { nickname: 'replier', user_id: 'user-2' },
          }],
        }],
      },
    });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

try {
  const response = await worker.fetch(new Request('https://worker.example/api/get-feed-detail', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-xhs-cookie': 'a1=test-a1; web_session=test-session',
    },
    body: JSON.stringify({
      feed_id: 'note-1',
      xsec_token: 'token=',
      xsec_source: 'pc_feed',
    }),
  }), {}, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(body.data.comments_error, null);
  assert.equal(body.data.comments.list[0].content, '具体评论内容');
  assert.equal(body.data.comments.list[0].user.nickname, 'commenter');
  assert.equal(body.data.comments.list[0].sub_comments[0].content, '具体回复内容');
  console.log('Comment detail integration test passed');
} finally {
  globalThis.fetch = originalFetch;
}

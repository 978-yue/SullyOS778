import assert from 'node:assert/strict';
import { __xhsLiteTest } from '../../index.js';

const { decodeBrowserCommentPayload, browserCommentExtractorScript } = __xhsLiteTest._internals;

const expected = {
  comments: [{
    id: 'comment-1',
    content: '一条评论',
    like_count: '3',
    user_info: { nickname: '用户甲', user_id: 'user-1' },
    sub_comments: [],
  }],
};
const encoded = Buffer.from(JSON.stringify(expected), 'utf8').toString('base64');
assert.deepEqual(
  decodeBrowserCommentPayload(`<html><body>SULLY_XHS_COMMENTS:${encoded}</body></html>`),
  expected.comments,
);
assert.throws(
  () => decodeBrowserCommentPayload('<html><body>missing</body></html>'),
  /did not return a comment payload/,
);

const extractor = browserCommentExtractorScript();
assert.match(extractor, /\.comment-item:not\(\.comment-item-sub\)/);
assert.match(extractor, /SULLY_XHS_COMMENTS/);
assert.match(extractor, /userMatch/);

console.log('browser comment reader: OK');

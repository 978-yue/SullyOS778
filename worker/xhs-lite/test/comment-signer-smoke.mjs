import assert from 'node:assert/strict';
import { __xhsLiteTest } from '../../index.js';

assert.equal(__xhsLiteTest.commentSignerError, '');
assert.equal(typeof __xhsLiteTest.signComments, 'function');

const signed = __xhsLiteTest.signComments(
  '/api/sns/web/v2/comment/page?note_id=test&cursor=&top_comment_id=&image_formats=jpg%2Cwebp%2Cavif&xsec_token=token%3D',
  '',
  '197e9c5585d7b1lzytcj54rjel35piyzlurwevylq50000252033',
  'GET',
);

assert.match(signed.xs, /^XYS_/);
assert.equal(signed.xs.length, 380);
assert.ok(signed.xs_common.length >= 1700);
assert.equal(typeof signed.xt, 'number');

console.log('Comment signer 4.3.2 smoke test passed');

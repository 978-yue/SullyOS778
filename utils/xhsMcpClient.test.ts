import { describe, expect, it } from 'vitest';
import {
    normalizeNote,
    normalizeXhsLiteDetail,
    parseXhsCount,
} from './xhsMcpClient';

describe('parseXhsCount', () => {
    it('parses compact Chinese and English counters without truncating decimals', () => {
        expect(parseXhsCount('1.2万')).toBe(12_000);
        expect(parseXhsCount('3万+')).toBe(30_000);
        expect(parseXhsCount('2.5k')).toBe(2_500);
        expect(parseXhsCount('1,234')).toBe(1_234);
    });
});

describe('normalizeNote', () => {
    it('reads compact likes from Lite detail data', () => {
        expect(normalizeNote({
            note_id: 'note-1',
            title: '标题',
            interact_info: { liked_count: '1.2万' },
        })).toMatchObject({
            noteId: 'note-1',
            title: '标题',
            likes: 12_000,
        });
    });
});

describe('normalizeXhsLiteDetail', () => {
    it('keeps comments returned by the Lite bridge', () => {
        const payload = {
            data: {
                note: {
                    note_id: 'note-1',
                    title: '标题',
                    interact_info: { liked_count: '1.2万' },
                },
                comments: {
                    list: [{
                        nickname: '甲',
                        content: '一级评论',
                        like_count: '1.2万',
                        sub_comments: [{
                            nickname: '乙',
                            content: '回复内容',
                            like_count: '2',
                        }],
                    }],
                },
            },
        };

        expect(normalizeXhsLiteDetail(payload)).toMatchObject({
            noteId: 'note-1',
            title: '标题',
            likes: 12_000,
            comments: [
                { author: '甲', content: '一级评论', likes: 12_000 },
                { author: '乙', content: '回复内容', likes: 2 },
            ],
        });
    });
});

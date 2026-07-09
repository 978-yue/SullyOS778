import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context';
import { DailySchedule } from '../types';

function mkSchedule(slots: DailySchedule['slots'], flow?: Record<string, string>): DailySchedule {
    return { id: 'c_d', charId: 'c', date: 'd', slots, generatedAt: 1, flowNarrative: flow };
}

// 覆盖当前时刻：确保总有「过去 / 现在 / 未来」三类 slot，无论测试何时运行。
const hourStr = (delta: number) =>
    `${String(Math.min(23, Math.max(0, new Date().getHours() + delta))).padStart(2, '0')}:00`;

describe('buildScheduleInjection — 手动修改后的日程必须完整到达 AI', () => {
    it('注入包含全部时段，而不仅是当前 + 下一段', () => {
        const sched = mkSchedule([
            { startTime: '06:00', activity: '睡觉' },
            { startTime: '07:00', activity: '起床' },
            { startTime: '08:00', activity: '写代码' },
            { startTime: '12:00', activity: '午饭' },
            { startTime: '20:00', activity: '晚上健身' },
        ]);
        const inj = ContextBuilder.buildScheduleInjection(sched);
        for (const a of ['睡觉', '起床', '写代码', '午饭', '晚上健身']) {
            expect(inj).toContain(a);
        }
    });

    it('对靠后时段的手动修改也会出现在注入里', () => {
        const edited = mkSchedule([
            { startTime: hourStr(-2), activity: '写代码' },
            { startTime: hourStr(-1), activity: '开会' },
            { startTime: hourStr(+5), activity: '和朋友吃晚饭' }, // 用户改了这个靠后的时段
        ]);
        const inj = ContextBuilder.buildScheduleInjection(edited);
        expect(inj).toContain('和朋友吃晚饭');
    });

    it('slot 的 description 修改同样到达 AI', () => {
        const edited = mkSchedule([
            { startTime: hourStr(-1), activity: '在家', description: '改成了在家远程办公' },
        ]);
        const inj = ContextBuilder.buildScheduleInjection(edited);
        expect(inj).toContain('改成了在家远程办公');
    });

    it('仍然标注「现在」并保留意识流独白', () => {
        const sched = mkSchedule(
            [{ startTime: hourStr(-1), activity: '写代码' }],
            { morning: '今天想专心写代码', afternoon: '继续写', evening: '收尾' },
        );
        const inj = ContextBuilder.buildScheduleInjection(sched);
        expect(inj).toContain('← 现在');
        // 独白三选一必有其一
        expect(/今天想专心写代码|继续写|收尾/.test(inj)).toBe(true);
    });

    it('空日程返回空串', () => {
        expect(ContextBuilder.buildScheduleInjection(null)).toBe('');
        expect(ContextBuilder.buildScheduleInjection(mkSchedule([]))).toBe('');
    });
});

import { describe, it, expect } from 'vitest';
import {
    computeWeather, weightedSpend, guessCategory,
    nextStreak, streakMultiplier, computeCoins,
    levelForEnergy, levelTitle,
    pairKey, relationTier, rollPetEvents, applyEvents,
    composeLocalEpisode, txFlavor, overspendForecast,
} from './narrative';
import { BankTransaction, ShopStaff } from '../../types';

const tx = (amount: number, note: string, category = 'general'): BankTransaction => ({
    id: `tx-${Math.random()}`, amount, note, category, timestamp: 0, dateStr: '2026-07-16',
});

const pet = (id: string, name: string): ShopStaff => ({
    id, name, avatar: '🐶', role: 'waiter', fatigue: 0, maxFatigue: 100, hireDate: 0, isPet: true,
});

// 可预测随机源
const seq = (...vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
};

describe('加权支出与分类', () => {
    it('房租和奶茶不同罪：账单权重 0.2，餐饮 0.7', () => {
        expect(guessCategory('房租')).toBe('bills');
        expect(guessCategory('奶茶')).toBe('food');
        const spend = weightedSpend([tx(1000, '房租'), tx(10, '奶茶')]);
        expect(spend).toBeCloseTo(1000 * 0.2 + 10 * 0.7);
    });
});

describe('computeWeather', () => {
    it('无记账 → 雾天，不评分', () => {
        const r = computeWeather([], 100);
        expect(r.weather).toBe('fog');
        expect(r.energy).toBeNull();
    });

    it('比值档位映射正确', () => {
        // 加权 30/预算 100 = 0.3 → 大晴
        expect(computeWeather([tx(30, '衣服')], 100).weather).toBe('sunny');
        // 0.6 → 晴
        expect(computeWeather([tx(60, '衣服')], 100).weather).toBe('fair');
        // 0.9 → 多云
        expect(computeWeather([tx(90, '衣服')], 100).weather).toBe('cloudy');
        // 1.1 → 小雨
        expect(computeWeather([tx(110, '衣服')], 100).weather).toBe('rain');
        // 2.0 → 暴风雨
        expect(computeWeather([tx(200, '衣服')], 100).weather).toBe('storm');
    });

    it('必要大额支出不至于直接暴风雨：¥300 医药费在 ¥100 预算下加权后只有 0.6', () => {
        const r = computeWeather([tx(300, '看病买药')], 100);
        expect(r.weather).toBe('fair');
    });

    it('进步分：低于近 7 日中位数 +10，且需 ≥3 天基线', () => {
        const base = computeWeather([tx(60, '衣服')], 100);
        const boosted = computeWeather([tx(60, '衣服')], 100, [100, 90, 80]);
        expect(boosted.progressBonus).toBe(true);
        expect(boosted.energy!).toBe(Math.min(100, base.energy! + 10));
        // 基线不足 3 天不启用
        expect(computeWeather([tx(60, '衣服')], 100, [100, 90]).progressBonus).toBe(false);
    });

    it('元气不超过 100', () => {
        const r = computeWeather([tx(1, '衣服')], 100, [100, 90, 80]);
        expect(r.energy).toBeLessThanOrEqual(100);
    });

    it('预算未设置按多云处理', () => {
        expect(computeWeather([tx(50, '衣服')], 0).weather).toBe('cloudy');
    });
});

describe('streak 与金币', () => {
    it('记账 +1；雾天降档不清零', () => {
        expect(nextStreak(5, true)).toBe(6);
        expect(nextStreak(10, false)).toBe(7);   // 回落到 7 档
        expect(nextStreak(5, false)).toBe(3);    // 回落到 3 档
        expect(nextStreak(2, false)).toBe(0);
        expect(nextStreak(40, false)).toBe(30);
    });

    it('streak 乘数分档', () => {
        expect(streakMultiplier(0)).toBe(1.0);
        expect(streakMultiplier(3)).toBe(1.2);
        expect(streakMultiplier(7)).toBe(1.5);
        expect(streakMultiplier(30)).toBe(2.0);
    });

    it('金币公式：晴天 × streak × appeal', () => {
        // 20 × 1.5 × 1.0 × 1.0 = 30
        expect(computeCoins('sunny', 0, 100)).toBe(30);
        // 雾天也有保底产出
        expect(computeCoins('fog', 0, 100)).toBeGreaterThanOrEqual(1);
    });
});

describe('店铺等级', () => {
    it('累计元气阈值驱动', () => {
        expect(levelForEnergy(0)).toBe(1);
        expect(levelForEnergy(499)).toBe(1);
        expect(levelForEnergy(500)).toBe(2);
        expect(levelForEnergy(3500)).toBe(4);
        expect(levelTitle(1)).toBe('无名小店');
    });
});

describe('宠物关系', () => {
    it('pairKey 与顺序无关', () => {
        expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
    });

    it('关系档位', () => {
        expect(relationTier(-80).key).toBe('enemy');
        expect(relationTier(-30).key).toBe('plastic');
        expect(relationTier(0).key).toBe('neutral');
        expect(relationTier(50).key).toBe('close');
        expect(relationTier(70).key).toBe('crush');
    });

    it('applyEvents 累加关系并产出档位跃迁大事件', () => {
        const a = pet('p1', '柴犬'), b = pet('p2', '企鹅');
        const events = [
            { type: 'share' as const, aId: a.id, aName: a.name, bId: b.id, bName: b.name, text: '', relationDelta: 12 },
        ];
        const { relations, milestones } = applyEvents({ [pairKey('p1', 'p2')]: 25 }, events);
        expect(relations[pairKey('p1', 'p2')]).toBe(37);
        expect(milestones.length).toBe(1); // neutral → close 跃迁
        expect(milestones[0]).toContain('形影不离');
    });

    it('关系值夹在 [-100, 100]', () => {
        const events = [
            { type: 'crush' as const, aId: 'p1', aName: 'A', bId: 'p2', bName: 'B', text: '', relationDelta: 18 },
        ];
        const { relations } = applyEvents({ [pairKey('p1', 'p2')]: 95 }, events);
        expect(relations[pairKey('p1', 'p2')]).toBe(100);
    });
});

describe('rollPetEvents', () => {
    const pets = [pet('p1', '柴犬'), pet('p2', '企鹅')];

    it('雾天没有可见事件', () => {
        expect(rollPetEvents(pets, {}, 'fog')).toEqual([]);
    });

    it('单只宠物走独角戏池', () => {
        const evs = rollPetEvents([pet('p1', '柴犬')], {}, 'sunny', seq(0, 0, 0, 0, 0, 0, 0, 0));
        expect(evs.length).toBeGreaterThan(0);
        expect(evs.every(e => e.type === 'solo')).toBe(true);
        expect(evs[0].text).toContain('柴犬');
    });

    it('关系不到 30 不发糖（不会出 crush 事件）', () => {
        for (let i = 0; i < 50; i++) {
            const evs = rollPetEvents(pets, { [pairKey('p1', 'p2')]: 0 }, 'sunny');
            expect(evs.every(e => e.type !== 'crush')).toBe(true);
        }
    });

    it('暧昧期（≥70）晴天可以出 crush 事件', () => {
        let sawCrush = false;
        for (let i = 0; i < 200 && !sawCrush; i++) {
            const evs = rollPetEvents(pets, { [pairKey('p1', 'p2')]: 75 }, 'sunny');
            sawCrush = evs.some(e => e.type === 'crush');
        }
        expect(sawCrush).toBe(true);
    });

    it('事件文本代入了宠物名字，主人摘要存在', () => {
        const evs = rollPetEvents(pets, {}, 'storm', seq(0.99, 0.1, 0.1, 0.1, 0.1));
        expect(evs.length).toBeGreaterThan(0);
        for (const e of evs) {
            expect(e.text).not.toContain('{a}');
            expect(e.text).not.toContain('{b}');
            expect(e.ownerNote).toBeTruthy();
        }
    });
});

describe('本地剧集与小票文案', () => {
    const baseParams = {
        shopName: '咖啡馆', energy: 80, dayIndex: 3,
        events: [], milestones: [], txNotes: ['奶茶'], savedToday: 23,
        currency: '¥', goalName: 'Switch',
    };

    it('雾天只给一句悬念', () => {
        const ep = composeLocalEpisode({ ...baseParams, weather: 'fog', energy: null }, seq(0));
        expect(ep.body).toContain('无人知晓');
        expect(ep.body).not.toContain('奶茶');
    });

    it('正常剧集包含账本道具、结余与心愿', () => {
        const ep = composeLocalEpisode({ ...baseParams, weather: 'fair' }, seq(0));
        expect(ep.title).toContain('第 3 集');
        expect(ep.body).toContain('奶茶');
        expect(ep.body).toContain('¥23');
        expect(ep.body).toContain('Switch');
    });

    it('大事件被写进正文', () => {
        const ep = composeLocalEpisode({
            ...baseParams, weather: 'sunny',
            milestones: ['柴犬 和 企鹅 正式进入了暧昧期 💕——全店官宣！'],
        }, seq(0));
        expect(ep.body).toContain('本集大事件');
        expect(ep.body).toContain('暧昧期');
    });

    it('小票文案与超支预告', () => {
        expect(txFlavor('奶茶', seq(0))).toBeTruthy();
        expect(overspendForecast(1.5)).toContain('暴风雨');
        expect(overspendForecast(1.1)).toContain('小雨');
    });
});

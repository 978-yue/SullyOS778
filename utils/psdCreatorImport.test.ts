import { describe, it, expect } from 'vitest';
import { parseLayerName, multiplyPixelsToNormal } from './psdCreatorImport';

describe('parseLayerName', () => {
    it('中文别名 + 空格', () => {
        expect(parseLayerName('前发 云朵刘海')).toEqual({ categoryKey: 'fronthair', name: '云朵刘海', tintable: null });
        expect(parseLayerName('耳发 长鬓发')).toEqual({ categoryKey: 'earhair', name: '长鬓发', tintable: null });
    });

    it('英文 key + 各种分隔符', () => {
        expect(parseLayerName('fronthair-cloud')).toEqual({ categoryKey: 'fronthair', name: 'cloud', tintable: null });
        expect(parseLayerName('后发1_马尾')).toEqual({ categoryKey: 'back1', name: '马尾', tintable: null });
        expect(parseLayerName('配饰·蝴蝶结')).toEqual({ categoryKey: 'decor', name: '蝴蝶结', tintable: null });
    });

    it('后发1/后发2 不被"后发"截断', () => {
        expect(parseLayerName('后发2 双马尾').categoryKey).toBe('back2');
    });

    it('刘海是前发的别名', () => {
        expect(parseLayerName('刘海 齐刘海').categoryKey).toBe('fronthair');
    });

    it('#色 / #原色 标记（含全角井号），并从名字里剥掉', () => {
        expect(parseLayerName('衣服 水手服 #色')).toEqual({ categoryKey: 'outfit', name: '水手服', tintable: true });
        expect(parseLayerName('前发 挑染刘海 ＃原色')).toEqual({ categoryKey: 'fronthair', name: '挑染刘海', tintable: false });
        expect(parseLayerName('outfit sailor #notint').tintable).toBe(false);
        expect(parseLayerName('outfit sailor #tint').tintable).toBe(true);
    });

    it('识别不出类目时整个名字保留、categoryKey 为 null', () => {
        expect(parseLayerName('随便画的一层')).toEqual({ categoryKey: null, name: '随便画的一层', tintable: null });
    });

    it('只有类目没有名字时名字回退为原始串', () => {
        expect(parseLayerName('前发')).toEqual({ categoryKey: 'fronthair', name: '前发', tintable: null });
    });
});

describe('multiplyPixelsToNormal', () => {
    /** 正片叠底合成：B×m，m = 1-a+a×c（带不透明度的乘数） */
    const multiplyComposite = (backdrop: number, gray: number, alpha: number) =>
        backdrop * (1 - alpha + alpha * (gray / 255));
    /** 普通合成黑色：B×(1-a) + 0×a */
    const normalBlackComposite = (backdrop: number, outAlpha: number) =>
        backdrop * (1 - outAlpha / 255);

    it('中性灰阴影：转换后普通合成与原正片叠底逐点等价（±1 量化误差）', () => {
        for (const gray of [0, 64, 128, 200, 255]) {
            for (const srcAlpha of [255, 128]) {
                const px = new Uint8ClampedArray([gray, gray, gray, srcAlpha]);
                multiplyPixelsToNormal(px);
                expect(px[0]).toBe(0); // 输出必须是纯黑
                for (const backdrop of [255, 180, 90]) {
                    const want = multiplyComposite(backdrop, gray, srcAlpha / 255);
                    const got = normalBlackComposite(backdrop, px[3]);
                    expect(Math.abs(want - got)).toBeLessThanOrEqual(1.5);
                }
            }
        }
    });

    it('纯白像素（不产生变暗）→ alpha 0', () => {
        const px = new Uint8ClampedArray([255, 255, 255, 255]);
        multiplyPixelsToNormal(px);
        expect(px[3]).toBe(0);
    });

    it('全透明像素不动', () => {
        const px = new Uint8ClampedArray([50, 50, 50, 0]);
        expect(multiplyPixelsToNormal(px)).toBe(false);
        expect(Array.from(px)).toEqual([50, 50, 50, 0]);
    });

    it('带色阴影报告 hadColor 并被中性化', () => {
        const px = new Uint8ClampedArray([120, 80, 200, 255]);
        expect(multiplyPixelsToNormal(px)).toBe(true);
        expect(px[0]).toBe(0);
        expect(px[3]).toBeGreaterThan(0);
    });
});

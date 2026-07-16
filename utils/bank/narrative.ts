/**
 * 存钱罐「元气天气 + 宠物剧集」引擎（纯逻辑，无 React / DOM 依赖）。
 *
 * 设计文档：docs/bank-game-redesign-prd.md
 * - AP（元气）不是货币：每天由「省钱尽力程度」的比值评定，映射五档天气，
 *   决定当天宠物剧集的戏路与金币产出。可花的货币只有金币。
 * - 比值制回答的是"用户是不是尽力在省钱"：必要支出低权重（房租和奶茶不同罪），
 *   并与自己近 7 日的加权支出基线对比给进步分。
 */

import { BankTransaction, BankWeather, BankPetEvent, ShopStaff } from '../../types';

// ---------------------------------------------------------------------------
// 日期口径：本地时区（与手帐/日记 App 的 getLocalDateStr 同口径）
// 早期存钱罐数据用的是 UTC toISOString，东八区早上 8 点前的记账会归到前一天，
// v3 起统一按用户系统本地时间记"日"。
// ---------------------------------------------------------------------------

/** 本地时区的 YYYY-MM-DD */
export function localDateStr(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// 消费分类（与 BankAnalytics 的 8 分类保持一致）
// ---------------------------------------------------------------------------

export type BankCategory =
    | 'food' | 'transport' | 'shopping' | 'entertainment'
    | 'bills' | 'health' | 'education' | 'other';

/**
 * 关键词猜分类：从 BankAnalytics 抽出以便复用（那边保留 UI 专用的图标/配色表）。
 * 医疗/账单检查置于购物之前——"看病买药"不该因为一个"买"字被记成购物。
 */
export function guessCategory(note: string): BankCategory {
    const lower = note.toLowerCase();
    if (/医|药|健康|体检|看病/.test(lower)) return 'health';
    if (/话费|水电|房租|网费|会员|订阅/.test(lower)) return 'bills';
    if (/饭|餐|吃|外卖|食|奶茶|咖啡|早|午|晚|火锅|烧烤|面|饮/.test(lower)) return 'food';
    if (/车|地铁|公交|打车|油|加油|停车|出租/.test(lower)) return 'transport';
    if (/买|购|淘宝|京东|拼多多|商场|超市|衣服/.test(lower)) return 'shopping';
    if (/游戏|电影|娱乐|ktv|酒吧|玩/.test(lower)) return 'entertainment';
    if (/书|课|学习|培训|教育/.test(lower)) return 'education';
    return 'other';
}

/** 必要支出低权重，可选支出高权重——房租和奶茶不能同罪 */
export const CATEGORY_WEIGHTS: Record<BankCategory, number> = {
    bills: 0.2,
    health: 0.2,
    transport: 0.4,
    education: 0.5,
    food: 0.7,
    shopping: 1.0,
    entertainment: 1.0,
    other: 1.0,
};

export function weightedSpend(txs: BankTransaction[]): number {
    return txs.reduce((sum, tx) => {
        const cat = (tx.category && tx.category in CATEGORY_WEIGHTS)
            ? tx.category as BankCategory
            : guessCategory(tx.note);
        return sum + tx.amount * CATEGORY_WEIGHTS[cat];
    }, 0);
}

// ---------------------------------------------------------------------------
// 天气评定
// ---------------------------------------------------------------------------

export interface WeatherMeta {
    label: string;
    emoji: string;
    coinMult: number;
    /** 剧集戏路，供 LLM prompt 与本地骨架选择 */
    tone: string;
}

export const WEATHER_META: Record<BankWeather, WeatherMeta> = {
    sunny:  { label: '大晴', emoji: '☀️', coinMult: 1.5, tone: '温馨日常，宠物们其乐融融，可推进暧昧线' },
    fair:   { label: '晴',   emoji: '🌤', coinMult: 1.2, tone: '轻快日常，小确幸，正向互动为主' },
    cloudy: { label: '多云', emoji: '⛅', coinMult: 1.0, tone: '平淡小品，埋一个伏笔' },
    rain:   { label: '小雨', emoji: '🌧', coinMult: 0.7, tone: '鸡飞狗跳的喜剧，混乱但好笑' },
    storm:  { label: '暴风雨', emoji: '⛈', coinMult: 0.5, tone: '大事故连续剧，戏剧冲突拉满（但依然好看）' },
    fog:    { label: '雾天', emoji: '🌫', coinMult: 0.2, tone: '一切被雾笼罩，只留一句悬念' },
};

export interface WeatherResult {
    weather: BankWeather;
    /** 0-100，雾天为 null */
    energy: number | null;
    /** 加权节制比，雾天为 null */
    ratio: number | null;
    progressBonus: boolean;
}

/**
 * 评定今日天气。
 * @param todayTxs        今日流水
 * @param dailyBudget     每日预算（<=0 视为未设置，按多云处理）
 * @param recentWeighted  近 7 日（不含今日）每日加权支出，用于进步分；不足 3 天不启用
 */
export function computeWeather(
    todayTxs: BankTransaction[],
    dailyBudget: number,
    recentWeighted: number[] = [],
): WeatherResult {
    if (todayTxs.length === 0) {
        return { weather: 'fog', energy: null, ratio: null, progressBonus: false };
    }
    const spend = weightedSpend(todayTxs);
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
        return { weather: 'cloudy', energy: 55, ratio: null, progressBonus: false };
    }
    const r = spend / dailyBudget;

    // 档位区间：[rMin, rMax) → [eMin, eMax]，r 越小元气越高
    const bands: { max: number; weather: BankWeather; eMin: number; eMax: number; rMin: number }[] = [
        { rMin: 0,   max: 0.5,      weather: 'sunny',  eMin: 90, eMax: 100 },
        { rMin: 0.5, max: 0.8,      weather: 'fair',   eMin: 70, eMax: 89 },
        { rMin: 0.8, max: 1.0,      weather: 'cloudy', eMin: 50, eMax: 69 },
        { rMin: 1.0, max: 1.3,      weather: 'rain',   eMin: 30, eMax: 49 },
        { rMin: 1.3, max: Infinity, weather: 'storm',  eMin: 0,  eMax: 29 },
    ];
    const band = bands.find(b => r < b.max) || bands[bands.length - 1];
    // 在档位内插值（暴风雨档 r 上不封顶，取 2.0 为地板参照）
    const span = band.max === Infinity ? 0.7 : band.max - band.rMin;
    const pos = Math.min(1, Math.max(0, (r - band.rMin) / span));
    let energy = Math.round(band.eMax - pos * (band.eMax - band.eMin));

    // 进步分：今日低于自己近 7 日中位数 → +10（需 ≥3 天基线）
    let progressBonus = false;
    if (recentWeighted.length >= 3) {
        const sorted = [...recentWeighted].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (spend < median) {
            energy = Math.min(100, energy + 10);
            progressBonus = true;
        }
    }
    return { weather: band.weather, energy, ratio: r, progressBonus };
}

// ---------------------------------------------------------------------------
// 记账连击（宽容制）与金币
// ---------------------------------------------------------------------------

/** streak 阶梯（唯一事实来源：降档回落与金币乘数都由它驱动） */
export const STREAK_TIERS: { days: number; mult: number }[] = [
    { days: 0, mult: 1.0 },
    { days: 3, mult: 1.2 },
    { days: 7, mult: 1.5 },
    { days: 30, mult: 2.0 },
];

/** 有记账 +1；雾天（没记账）降档不清零：回落到上一个门槛 */
export function nextStreak(streak: number, loggedToday: boolean): number {
    if (loggedToday) return streak + 1;
    return STREAK_TIERS.map(t => t.days).filter(d => d < streak).pop() ?? 0;
}

export function streakMultiplier(streak: number): number {
    for (let i = STREAK_TIERS.length - 1; i >= 0; i--) {
        if (streak >= STREAK_TIERS[i].days) return STREAK_TIERS[i].mult;
    }
    return 1.0;
}

/** 金币 = 基础 20 × 天气乘数 × streak 乘数 × appeal/100（下限 1） */
export function computeCoins(weather: BankWeather, streak: number, appeal: number): number {
    const base = 20 * WEATHER_META[weather].coinMult * streakMultiplier(streak) * Math.max(0.5, appeal / 100);
    return Math.max(1, Math.round(base));
}

// ---------------------------------------------------------------------------
// 店铺等级（累计元气驱动）
// ---------------------------------------------------------------------------

export const LEVEL_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000, 32000];
export const LEVEL_TITLES = [
    '无名小店', '街角新面孔', '常客的秘密基地', '街区话题店',
    '巷子里的传说', '城中名店', '深夜食堂级传奇', '这条街本身',
];

export function levelForEnergy(cumulativeEnergy: number): number {
    let lvl = 1;
    for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
        if (cumulativeEnergy >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
    }
    return lvl;
}

export function levelTitle(level: number): string {
    return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1];
}

// ---------------------------------------------------------------------------
// 宠物关系图谱
// ---------------------------------------------------------------------------

export function pairKey(aId: string, bId: string): string {
    return [aId, bId].sort().join('|');
}

export interface RelationTier {
    key: 'enemy' | 'plastic' | 'neutral' | 'close' | 'crush';
    label: string;
    emoji: string;
}

export function relationTier(value: number): RelationTier {
    if (value <= -60) return { key: 'enemy', label: '死对头', emoji: '💢' };
    if (value <= -10) return { key: 'plastic', label: '塑料友情', emoji: '🙄' };
    if (value < 30) return { key: 'neutral', label: '点头之交', emoji: '🐾' };
    if (value < 70) return { key: 'close', label: '形影不离', emoji: '🤝' };
    return { key: 'crush', label: '暧昧期', emoji: '💕' };
}

export const clampRelation = (v: number) => Math.max(-100, Math.min(100, v));

// ---------------------------------------------------------------------------
// 宠物事件（文案表；{a}/{b} 为宠物名占位符）
// 基调红线：暧昧全部走萌向拟人（分零食/尾巴缠一起/看月亮），PG 分级。
// ---------------------------------------------------------------------------

interface EventSpec {
    type: BankPetEvent['type'];
    delta: number;
    /** 正向事件权重在晴天高，负向在暴风雨高 */
    valence: 'good' | 'bad' | 'neutral';
    texts: string[];
    /** 主人系统消息摘要模板（{a}=事件主角宠物名，{b}=对方） */
    ownerNote: string;
}

const PAIR_EVENTS: EventSpec[] = [
    {
        type: 'fight', delta: -15, valence: 'bad',
        texts: [
            '{a}和{b}为了最后一块曲奇大打出手，吧台的杯子遭了殃',
            '{a}抢占了{b}最爱的窗边位置，两只从冷战升级成追逐战',
            '{b}打翻了{a}藏起来的零食罐，现场炸毛，羽毛（和猫毛）齐飞',
            '{a}和{b}对着同一个客人献殷勤，争宠大战一触即发',
            '{a}嫌{b}打呼噜太吵，半夜把对方的垫子拖走了，早上被抓个正着',
            '为了"谁才是店里第一可爱"，{a}和{b}僵持了一下午谁也不理谁',
            '{a}练习拉花时被{b}嘲笑了，恼羞成怒泼了对方一爪子奶泡',
            '{b}偷偷坐了{a}的专属椅子，{a}发现后当场掀了桌（上的杯垫）',
        ],
        ownerNote: '和{b}大吵了一架，现在气鼓鼓的',
    },
    {
        type: 'steal', delta: -8, valence: 'bad',
        texts: [
            '{a}趁{b}打盹，把对方的小鱼干叼走了，现场只留下一撮毛',
            '{b}的下午茶点心不翼而飞，监控里只有{a}心虚的背影',
            '{a}以"帮忙试吃"为名吃光了{b}藏的饼干，事后装无辜',
            '{b}存了一周的零食被{a}一锅端，正在全店通缉',
            '{a}偷喝了{b}的特调，还咂了咂嘴说"一般"，气得对方直跺脚',
        ],
        ownerNote: '干了点小坏事——偷了{b}的零食，正在被追捕',
    },
    {
        type: 'nap', delta: 10, valence: 'good',
        texts: [
            '{a}和{b}在窗边的阳光里叠成一团睡着了，客人们不忍心点单',
            '打烊前，{a}靠着{b}的背打起了小呼噜，谁都没舍得动',
            '下雨的午后，{a}和{b}挤在同一张软垫上睡成了麻花',
            '{b}睡着后一直往{a}那边滚，{a}认命地当了一下午枕头',
            '两只约好守店，结果双双睡着，店长回来看到的是并排的两个肚皮',
        ],
        ownerNote: '和{b}窝在一起睡了一下午，画面被客人拍下来传遍了',
    },
    {
        type: 'share', delta: 12, valence: 'good',
        texts: [
            '{a}偷偷给{b}留了一块边角蛋糕，还假装是"不小心多切的"',
            '{b}把自己最喜欢的小鱼干分了一半给{a}，罕见地没有讨价还价',
            '{a}学会了新把戏，第一个表演给{b}看，尾巴都快摇出残影了',
            '{b}帮{a}把够不到的玩具拨了下来，两只开心地闹作一团',
            '{a}today的员工餐多了一份甜点——是{b}用自己的份换来的',
        ],
        ownerNote: '和{b}分享了零食，关系肉眼可见地变好了',
    },
    {
        type: 'crush', delta: 18, valence: 'good',
        texts: [
            '打烊后，有人看见{a}和{b}的尾巴缠在一起看月亮…店报记者已就位',
            '{a}把攒了三天的小鱼干全给了{b}，全店哗然',
            '{b}给{a}梳了一下午毛，梳到两只都睡着了，画面过于美好',
            '{a}学人类把一朵小花放在了{b}的垫子上，然后躲起来偷看',
            '今天{a}和{b}共享了一杯（宠物专用）特调，两根吸管，全店起哄',
        ],
        ownerNote: '和{b}的关系好像有点不一样了…全店都在磕',
    },
];

const SOLO_EVENTS: EventSpec[] = [
    {
        type: 'solo', delta: 0, valence: 'neutral',
        texts: [
            '{a}对着窗外的鸟发了一下午呆，错过了三位想撸它的客人',
            '{a}试图帮忙端盘子，成功打碎了一个杯子，然后假装无事发生',
            '{a}发现了一个新纸箱，从此那是它的城堡，谁靠近凶谁',
            '{a}偷偷练习了招财姿势，被客人拍下来发到了网上，小火了一把',
            '{a}把店长的笔藏进了沙发缝——这已经是本周第三支了',
            '{a}守着烤箱等了一下午，就为了闻刚出炉的第一口香味',
        ],
        ownerNote: '今天独自看店，干了些让人哭笑不得的事',
    },
];

const cloneEvent = (spec: EventSpec, text: string, a: ShopStaff, b?: ShopStaff): BankPetEvent => ({
    type: spec.type,
    aId: a.id,
    aName: a.name,
    bId: b?.id,
    bName: b?.name,
    text: text.replace(/\{a\}/g, a.name).replace(/\{b\}/g, b?.name || ''),
    relationDelta: spec.delta,
    ownerNote: spec.ownerNote.replace(/\{a\}/g, a.name).replace(/\{b\}/g, b?.name || ''),
});

/** 天气 → (好事权重, 坏事权重, 事件数) */
const WEATHER_EVENT_PROFILE: Record<BankWeather, { good: number; bad: number; count: [number, number] }> = {
    sunny:  { good: 4, bad: 1, count: [2, 3] },
    fair:   { good: 3, bad: 1, count: [2, 3] },
    cloudy: { good: 1, bad: 1, count: [1, 2] },
    rain:   { good: 1, bad: 2, count: [2, 3] },
    storm:  { good: 1, bad: 4, count: [2, 3] },
    fog:    { good: 0, bad: 0, count: [0, 0] },
};

/**
 * 掷本集宠物事件。关系数学在这里定死（LLM 只负责润色叙事，不碰数值）。
 * - 关系 ≥+70（暧昧期）时 crush 事件权重翻倍：官宣线自然推进
 * - 关系 ≤−60（死对头）时 fight 权重翻倍：宿敌线持续供戏
 * @param rand 可注入随机源以便测试
 */
export function rollPetEvents(
    pets: ShopStaff[],
    relations: Record<string, number>,
    weather: BankWeather,
    rand: () => number = Math.random,
): BankPetEvent[] {
    const profile = WEATHER_EVENT_PROFILE[weather];
    const [minC, maxC] = profile.count;
    if (maxC === 0 || pets.length === 0) return [];
    const count = minC + Math.floor(rand() * (maxC - minC + 1));
    const events: BankPetEvent[] = [];

    for (let i = 0; i < count; i++) {
        if (pets.length < 2) {
            const spec = SOLO_EVENTS[0];
            const a = pets[Math.floor(rand() * pets.length)];
            const text = spec.texts[Math.floor(rand() * spec.texts.length)];
            events.push(cloneEvent(spec, text, a));
            continue;
        }
        // 随机挑一对
        const ai = Math.floor(rand() * pets.length);
        let bi = Math.floor(rand() * (pets.length - 1));
        if (bi >= ai) bi++;
        const a = pets[ai], b = pets[bi];
        const rel = relations[pairKey(a.id, b.id)] ?? 0;

        // 按天气 + 关系构建加权事件池
        const pool: EventSpec[] = [];
        for (const spec of PAIR_EVENTS) {
            let w = spec.valence === 'good' ? profile.good : spec.valence === 'bad' ? profile.bad : 1;
            if (spec.type === 'crush') {
                if (rel < 30) w = 0;                    // 还不熟，不发糖
                else if (rel >= 70) w *= 2;             // 暧昧期糖分加倍
            }
            if (spec.type === 'fight' && rel <= -60) w *= 2; // 宿敌线
            for (let k = 0; k < w; k++) pool.push(spec);
        }
        if (pool.length === 0) pool.push(PAIR_EVENTS[2]); // 保底：打盹
        const spec = pool[Math.floor(rand() * pool.length)];
        const text = spec.texts[Math.floor(rand() * spec.texts.length)];
        events.push(cloneEvent(spec, text, a, b));
    }
    return events;
}

/** 把事件的关系变化落到图谱上，返回新图谱与"档位跃迁"大事件列表 */
export function applyEvents(
    relations: Record<string, number>,
    events: BankPetEvent[],
): { relations: Record<string, number>; milestones: string[] } {
    const next = { ...relations };
    const milestones: string[] = [];
    for (const ev of events) {
        if (!ev.bId || ev.relationDelta === 0) continue;
        const key = pairKey(ev.aId, ev.bId);
        const before = next[key] ?? 0;
        const after = clampRelation(before + ev.relationDelta);
        next[key] = after;
        const tierBefore = relationTier(before).key;
        const tierAfter = relationTier(after).key;
        if (tierBefore !== tierAfter) {
            const t = relationTier(after);
            milestones.push(
                tierAfter === 'crush' ? `${ev.aName} 和 ${ev.bName} 正式进入了暧昧期 ${t.emoji}——全店官宣！`
                : tierAfter === 'enemy' ? `${ev.aName} 和 ${ev.bName} 彻底决裂，成了死对头 ${t.emoji}`
                : `${ev.aName} 和 ${ev.bName} 的关系变成了「${t.label}」${t.emoji}`
            );
        }
    }
    return { relations: next, milestones };
}

// ---------------------------------------------------------------------------
// 本地剧集骨架（无 API Key 兜底；LLM 可用时仅替换 title/body 的叙事层）
// ---------------------------------------------------------------------------

export interface EpisodeDraftParams {
    shopName: string;
    weather: BankWeather;
    energy: number | null;
    dayIndex: number;
    events: BankPetEvent[];
    milestones: string[];
    /** 今日流水备注摘录（最多取 3 条做道具） */
    txNotes: string[];
    savedToday: number;
    currency: string;
    goalName?: string;
}

const OPENERS: Record<BankWeather, string[]> = {
    sunny: [
        '今天的{shop}被阳光泡得暖融融的，连espresso机都心情很好地哼着气。',
        '{shop}今天生意兴隆，玻璃窗擦得能照出每一条摇起来的尾巴。',
    ],
    fair: [
        '晴朗的一天，{shop}门口的小黑板上被谁用爪印画了个笑脸。',
        '{shop}今天不紧不慢地开着，风铃响一次，就有一位熟客推门进来。',
    ],
    cloudy: [
        '天色平平，{shop}里也是寻常的一天——但寻常的日子往往藏着伏笔。',
        '多云。{shop}的下午有点安静，安静得能听见谁在储物间里偷偷拆纸箱。',
    ],
    rain: [
        '外面下着小雨，{shop}里却鸡飞狗跳——字面意义上的。',
        '雨天客人少，闲下来的动物们把{shop}变成了自己的游乐场，后果自负。',
    ],
    storm: [
        '暴风雨拍打着{shop}的玻璃窗，而店里的风暴比外面还大。',
        '今天{shop}的营业日志只写了一句话："发生了很多事，别问。"',
    ],
    fog: [
        '雾很大。{shop}的灯亮了一晚上，里面似乎发生了大事——但没人记账，无人知晓昨夜的故事。',
        '一整天没有账目，{shop}的这一页是空白的。雾里只传出几声可疑的猫叫和碎裂声…明天，记得记账。',
    ],
};

const CLOSERS: Record<'good' | 'mid' | 'bad', string[]> = {
    good: [
        '打烊时，钱箱比昨天沉了一点，大家心照不宣地碰了碰爪子。',
        '今天的营业额被郑重记进了小本本，配了一颗手画的星星。',
    ],
    mid: [
        '不好不坏的一天，但店还开着，灯还亮着，这就够了。',
        '打烊后店长盘了盘账，叹了口气，又笑了笑。',
    ],
    bad: [
        '收拾完残局已是深夜。不过说真的——今天的戏，值回票价。',
        '损失清单写了半页纸，但常客们说，就爱看你们这出。',
    ],
};

const pick = <T,>(arr: T[], rand: () => number) => arr[Math.floor(rand() * arr.length)];

export function composeLocalEpisode(
    p: EpisodeDraftParams,
    rand: () => number = Math.random,
): { title: string; body: string } {
    const meta = WEATHER_META[p.weather];
    const title = `第 ${p.dayIndex} 集 · ${meta.emoji} ${meta.label}场`;

    if (p.weather === 'fog') {
        return { title, body: pick(OPENERS.fog, rand).replace(/\{shop\}/g, p.shopName) };
    }

    const parts: string[] = [pick(OPENERS[p.weather], rand).replace(/\{shop\}/g, p.shopName)];

    if (p.txNotes.length > 0) {
        const props = p.txNotes.slice(0, 3).join('、');
        parts.push(`今天的道具清单来自你的账本：${props}——它们都以各自的方式进入了剧情。`);
    }
    for (const ev of p.events) parts.push(ev.text + '。');
    for (const m of p.milestones) parts.push(`【本集大事件】${m}`);
    if (p.savedToday > 0) {
        parts.push(
            p.goalName
                ? `今日结余 ${p.currency}${p.savedToday}，已悄悄存进心愿「${p.goalName}」的储蓄罐。`
                : `今日结余 ${p.currency}${p.savedToday}，储蓄罐发出了令人安心的响声。`
        );
    }
    const closer = p.weather === 'sunny' || p.weather === 'fair' ? 'good'
        : p.weather === 'cloudy' ? 'mid' : 'bad';
    parts.push(pick(CLOSERS[closer], rand));
    return { title, body: parts.join('\n\n') };
}

// ---------------------------------------------------------------------------
// 记账即事件：白天的小票，晚上的剧本
// ---------------------------------------------------------------------------

const TX_FLAVOR: Record<BankCategory, string[]> = {
    food: [
        '柴势力闻到了食物的味道，正在收银台后集体吸鼻子——今晚的剧本 +1 个香味桥段。',
        '店里的鼻子们一致转向了你的方向。这笔账已被编入今晚的剧情。',
        '有宠物开始对着你的袋子流口水了。素材，都是素材。',
    ],
    transport: [
        '车轮上的一天。店里的懒骨头们表示不能理解，但尊重。',
        '你在路上奔波时，店里正有谁占了你的专属座位——今晚见分晓。',
    ],
    shopping: [
        '拆快递的声音是全店最诱人的声音，纸箱已被预定为新城堡。',
        '购物袋的窸窣声惊动了店里的收藏家，它已经开始规划新纸箱的用途。',
    ],
    entertainment: [
        '你玩得开心，店里的家伙们也没闲着——具体干了什么，今晚开演便知。',
        '娱乐精神传染给了店里的某只，它正在练一个新把戏。',
    ],
    bills: [
        '账单类支出已按"必要开销"轻权重计入——生活成本不该淋你的雨。',
        '交完该交的钱，日子照常过。店里的灯还亮着，就好。',
    ],
    health: [
        '照顾好自己最重要，店里的毛孩子们今天会加倍乖（大概）。',
        '健康支出不扣戏份——你养好身体，才能一直看它们的戏。',
    ],
    education: [
        '你在学习时，店里有谁正偷偷模仿你翻书的样子。',
        '知识类支出轻权重计入。店里最聪明的那只表示欣慰。',
    ],
    other: [
        '一笔神秘支出。店报记者已把它列入今晚的悬念清单。',
        '账本上多了一行，今晚的剧本里就多了一个道具。',
    ],
};

export function txFlavor(note: string, rand: () => number = Math.random): string {
    const cat = guessCategory(note);
    return pick(TX_FLAVOR[cat], rand);
}

/** 超支时的剧透预告（替代冷冰冰的警告） */
export function overspendForecast(ratio: number): string {
    if (ratio > 1.3) return '⛈ 按这个花法，今晚是暴风雨场——宠物们已经开始藏零食了…';
    return '🌧 今晚可能要下小雨了，店里的家伙们正在搬凳子占看戏的位置。';
}

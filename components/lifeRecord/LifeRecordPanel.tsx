
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { BankTransaction, LifeRecord, LifeRecordModule, LifeRecordSettings, MedPlan } from '../../types';
import { DEFAULT_CYCLE_LENGTH, computePeriodStatus, lifeToday } from '../../utils/lifeRecords';

/**
 * 档案 App「生活记录」面板 —— 复古优雅（浅色纸感）风格。
 * 四个模块各有独立视觉主题：月相记事 / 药剂手记 / 每日账簿 / 体能训练。
 *
 * - 用户手动记录 reviewStatus 直接 'confirmed'（不需要复核）。
 * - 记账不独立存储：直接读写 BankApp 的 bank_transactions（同一本账）。
 * - 长按模块页签 →「是否不需要这个功能？」→ 全局隐藏：前端不显示，
 *   并对所有角色断掉该模块注入与代记（settings.hiddenModules，优先级高于角色小开关）。
 */

const SERIF = "'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',Georgia,serif";

interface ModuleTheme {
    cn: string;           // 中文标题
    en: string;           // 英文小标（vintage 版式点缀）
    accent: string;       // 主色（深）
    soft: string;         // 主色（浅，用于底纹/描边）
    paper: string;        // 纸面渐变
    icon: React.ReactNode;
}

const iconStroke = (accent: string): React.SVGProps<SVGSVGElement> => ({
    viewBox: '0 0 24 24', fill: 'none', stroke: accent, strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    width: 17, height: 17,
});

const THEMES: Record<LifeRecordModule, ModuleTheme> = {
    period: {
        cn: '月相记事', en: 'LUNA', accent: '#a34a5e', soft: '#e7c3ca',
        paper: 'linear-gradient(160deg,#fdf8f6 0%,#faeef0 100%)',
        icon: <svg {...iconStroke('#a34a5e')}><path d="M20 13.2A8.2 8.2 0 0 1 10.8 4a8.2 8.2 0 1 0 9.2 9.2Z" /></svg>,
    },
    med: {
        cn: '药剂手记', en: 'PHARMACY', accent: '#3e7c6f', soft: '#bfdcd3',
        paper: 'linear-gradient(160deg,#f7fbf8 0%,#eaf4ef 100%)',
        icon: <svg {...iconStroke('#3e7c6f')}><path d="M9.5 3h5M10 3v4.2L5.8 14a4.6 4.6 0 0 0 4 7h4.4a4.6 4.6 0 0 0 4-7L14 7.2V3M7.5 15.5h9" /></svg>,
    },
    expense: {
        cn: '每日账簿', en: 'LEDGER', accent: '#9a7433', soft: '#e2d0a8',
        paper: 'linear-gradient(160deg,#fdfaf2 0%,#f8f1de 100%)',
        icon: <svg {...iconStroke('#9a7433')}><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v15A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15ZM9 3v18M12.5 8h3.5M12.5 12h3.5" /></svg>,
    },
    exercise: {
        cn: '体能训练', en: 'TRAINING', accent: '#5d7345', soft: '#ccd8b6',
        paper: 'linear-gradient(160deg,#f9fbf3 0%,#eef4e2 100%)',
        icon: <svg {...iconStroke('#5d7345')}><path d="M7 8v8M4.5 10v4M17 8v8M19.5 10v4M7 12h10" /></svg>,
    },
};

const MODULE_ORDER: LifeRecordModule[] = ['period', 'med', 'expense', 'exercise'];

const fmtCN = (s: string): string => {
    const p = (s || '').split('-');
    return p.length === 3 ? `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日` : s;
};

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

// ─── 装饰组件 ───

/** 描角画框卡片：细边 + 四角 L 形描金角饰，纸面渐变底 */
const Plaque: React.FC<{ theme: ModuleTheme; children: React.ReactNode; className?: string }> = ({ theme, children, className }) => (
    <div
        className={`relative rounded-[4px] p-[18px] ${className || ''}`}
        style={{
            background: theme.paper,
            border: `1px solid ${theme.soft}`,
            boxShadow: `0 12px 28px -18px ${theme.accent}55, inset 0 0 0 1px #ffffffb0`,
        }}
    >
        {(['top-1.5 left-1.5 border-t border-l', 'top-1.5 right-1.5 border-t border-r',
           'bottom-1.5 left-1.5 border-b border-l', 'bottom-1.5 right-1.5 border-b border-r'] as const).map(pos => (
            <span key={pos} aria-hidden className={`pointer-events-none absolute w-2.5 h-2.5 ${pos}`}
                style={{ borderColor: theme.accent, opacity: 0.5 }} />
        ))}
        {children}
    </div>
);

/** 模块小节标题：EN 小字距标 + 中文衬线标题 + 两侧细线 */
const SectionHead: React.FC<{ theme: ModuleTheme; cn: string; en?: string }> = ({ theme, cn, en }) => (
    <div className="mb-3.5">
        {en && (
            <div className="text-center text-[8px] font-semibold mb-0.5"
                style={{ color: theme.accent, opacity: 0.55, letterSpacing: '0.4em', textIndent: '0.4em' }}>
                {en}
            </div>
        )}
        <div className="flex items-center gap-3">
            <span className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${theme.soft})` }} />
            <span className="text-[13px] font-bold" style={{ fontFamily: SERIF, color: '#4a4039' }}>{cn}</span>
            <span className="flex-1 h-px" style={{ background: `linear-gradient(to left, transparent, ${theme.soft})` }} />
        </div>
    </div>
);

/** 纸面书写风输入框（下划线式） */
const inkInput = (accent: string): string =>
    `bg-transparent border-0 border-b outline-none text-xs px-1 py-1.5 transition-colors placeholder:text-slate-300 focus:border-current`;
const inkInputStyle = (theme: ModuleTheme): React.CSSProperties => ({
    borderBottom: `1px solid ${theme.soft}`, fontFamily: SERIF, color: '#4a4039', borderRadius: 0,
});

/** 长按检测（600ms，位移 >12px 取消）——用于页签隐藏 */
const useLongPress = (onLongPress: () => void, ms = 600) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const origin = useRef({ x: 0, y: 0 });
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    useEffect(() => clear, []);
    return {
        onPointerDown: (e: React.PointerEvent) => {
            origin.current = { x: e.clientX, y: e.clientY };
            clear();
            timer.current = setTimeout(onLongPress, ms);
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 12) clear();
        },
        onPointerUp: clear,
        onPointerLeave: clear,
        onPointerCancel: clear,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
};

/** 书签式模块页签（独立组件以便每个页签持有自己的长按 hook） */
const ModuleTab: React.FC<{
    module: LifeRecordModule;
    active: boolean;
    onSelect: () => void;
    onRequestHide: () => void;
}> = ({ module, active, onSelect, onRequestHide }) => {
    const theme = THEMES[module];
    const longPress = useLongPress(onRequestHide);
    return (
        <button
            {...longPress}
            onClick={onSelect}
            className="flex-1 select-none touch-manipulation flex flex-col items-center gap-1 pt-2.5 pb-2 rounded-[4px] transition-all active:scale-[0.97]"
            style={active ? {
                background: theme.paper,
                border: `1px solid ${theme.soft}`,
                boxShadow: `0 8px 18px -12px ${theme.accent}66, inset 0 0 0 1px #ffffffa0`,
            } : {
                background: 'transparent',
                border: '1px solid transparent',
                opacity: 0.55,
            }}
        >
            {theme.icon}
            <span className="text-[11px] font-bold leading-none" style={{ fontFamily: SERIF, color: active ? theme.accent : '#8b8378' }}>
                {theme.cn.slice(0, 2)}
            </span>
            <span className="text-[7px] font-semibold leading-none" style={{ letterSpacing: '0.22em', textIndent: '0.22em', color: active ? theme.accent : '#b3aca1', opacity: 0.7 }}>
                {theme.en}
            </span>
            <span aria-hidden className="h-[2px] w-5 rounded-full mt-0.5"
                style={{ background: active ? theme.accent : 'transparent', opacity: 0.65 }} />
        </button>
    );
};

// ─── 主面板 ───

const LifeRecordPanel: React.FC = () => {
    const { addToast } = useOS();
    const [tab, setTab] = useState<LifeRecordModule>('period');
    const [records, setRecords] = useState<LifeRecord[]>([]);
    const [plans, setPlans] = useState<MedPlan[]>([]);
    const [settings, setSettings] = useState<LifeRecordSettings | null>(null);
    const [txs, setTxs] = useState<BankTransaction[]>([]);
    const [loaded, setLoaded] = useState(false);
    /** 长按页签后待确认隐藏的模块 */
    const [hideCandidate, setHideCandidate] = useState<LifeRecordModule | null>(null);
    const [showRestore, setShowRestore] = useState(false);

    const today = lifeToday();

    const reload = async () => {
        const [r, p, s, t] = await Promise.all([
            DB.getAllLifeRecords().catch(() => [] as LifeRecord[]),
            DB.getAllMedPlans().catch(() => [] as MedPlan[]),
            DB.getLifeRecordSettings().catch(() => null),
            DB.getAllTransactions().catch(() => [] as BankTransaction[]),
        ]);
        setRecords(r.sort((a, b) => b.timestamp - a.timestamp));
        setPlans(p.sort((a, b) => a.time.localeCompare(b.time)));
        setSettings(s);
        setTxs(t.sort((a, b) => b.timestamp - a.timestamp));
        setLoaded(true);
    };
    useEffect(() => { reload(); }, []);

    const hiddenModules = useMemo(() => settings?.hiddenModules || [], [settings]);
    const visibleModules = useMemo(() => MODULE_ORDER.filter(m => !hiddenModules.includes(m)), [hiddenModules]);

    // 当前页签被隐藏时自动落到第一个可见模块
    useEffect(() => {
        if (hiddenModules.includes(tab) && visibleModules.length > 0) setTab(visibleModules[0]);
    }, [hiddenModules, tab, visibleModules]);

    const confirmHide = async (m: LifeRecordModule) => {
        const next = Array.from(new Set([...(settings?.hiddenModules || []), m]));
        await DB.saveLifeRecordSettings({ id: 'main', ...(settings || {}), hiddenModules: next });
        setHideCandidate(null);
        await reload();
        addToast('已隐藏，该功能不会再注入给任何角色', 'success');
    };

    const restoreModule = async (m: LifeRecordModule) => {
        const next = (settings?.hiddenModules || []).filter(x => x !== m);
        await DB.saveLifeRecordSettings({ id: 'main', ...(settings || {}), hiddenModules: next });
        await reload();
        addToast(`已恢复「${THEMES[m].cn}」`, 'success');
    };

    /** 未被否决的记录 */
    const effectiveRecords = useMemo(() => records.filter(r => r.reviewStatus !== 'rejected'), [records]);

    const addUserRecord = async (module: LifeRecordModule, kind: string, payload: Record<string, any>, extra?: Partial<LifeRecord>) => {
        const rec: LifeRecord = {
            id: newId('life'),
            module, kind, date: today, timestamp: Date.now(),
            payload,
            recordedBy: 'user',
            reviewStatus: 'confirmed',
            ...extra,
        };
        await DB.saveLifeRecord(rec);
        await reload();
        return rec;
    };

    const removeRecord = async (rec: LifeRecord) => {
        if (rec.bankTxId) await DB.deleteTransaction(rec.bankTxId).catch(() => {});
        await DB.deleteLifeRecord(rec.id);
        await reload();
        addToast('记录已删除', 'success');
    };

    const recordedByLabel = (r: LifeRecord) => r.recordedBy === 'user' ? '' : ` · ${r.recordedByName || '角色'}代记`;

    // ─── 生理期 ───
    const periodStatus = useMemo(() => computePeriodStatus(records, settings, today), [records, settings, today]);
    const periodHistory = useMemo(
        () => effectiveRecords.filter(r => r.module === 'period').slice(0, 12),
        [effectiveRecords],
    );

    const handlePeriodToggle = async () => {
        if (periodStatus.inPeriod) {
            await addUserRecord('period', 'end', {});
            addToast('已记录：生理期结束', 'success');
        } else {
            await addUserRecord('period', 'start', {});
            addToast('已记录：生理期开始', 'success');
        }
    };

    const handleCycleChange = async (v: string) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 15 || n > 90) return;
        await DB.saveLifeRecordSettings({ id: 'main', ...(settings || {}), cycleLength: n });
        await reload();
    };

    // ─── 药盒 ───
    const [planName, setPlanName] = useState('');
    const [planTime, setPlanTime] = useState('08:00');
    const [planDosage, setPlanDosage] = useState('');
    const todayMeds = useMemo(
        () => effectiveRecords.filter(r => r.module === 'med' && r.date === today),
        [effectiveRecords, today],
    );

    const handleAddPlan = async () => {
        if (!planName.trim()) { addToast('先填药名哦', 'error'); return; }
        await DB.saveMedPlan({
            id: newId('med'), name: planName.trim(), time: planTime,
            dosage: planDosage.trim() || undefined, enabled: true, createdAt: Date.now(),
        });
        setPlanName(''); setPlanDosage('');
        await reload();
        addToast('用药计划已添加', 'success');
    };

    const planTakenRecord = (p: MedPlan) =>
        todayMeds.find(r => (r.payload.planId && r.payload.planId === p.id) || r.payload.name === p.name);

    const handleTogglePlanTaken = async (p: MedPlan) => {
        const taken = planTakenRecord(p);
        if (taken) {
            await DB.deleteLifeRecord(taken.id);
            await reload();
        } else {
            await addUserRecord('med', 'taken', { name: p.name, planId: p.id, time: p.time });
            addToast(`已打卡：${p.name}`, 'success');
        }
    };

    // ─── 记账（银行同一本账） ───
    const [txAmount, setTxAmount] = useState('');
    const [txNote, setTxNote] = useState('');
    const todayTxs = useMemo(() => txs.filter(t => t.dateStr === today), [txs, today]);
    const todayTotal = useMemo(() => todayTxs.reduce((s, t) => s + t.amount, 0), [todayTxs]);
    const monthTotal = useMemo(() => {
        const monthKey = today.slice(0, 7);
        return txs.filter(t => (t.dateStr || '').startsWith(monthKey)).reduce((s, t) => s + t.amount, 0);
    }, [txs, today]);

    const handleAddTx = async () => {
        const amount = parseFloat(txAmount);
        if (isNaN(amount) || amount <= 0 || !txNote.trim()) { addToast('请填写金额和用途哦', 'error'); return; }
        await DB.saveTransaction({
            id: newId('tx-life'), amount, category: 'general',
            note: txNote.trim(), timestamp: Date.now(), dateStr: today,
        });
        setTxAmount(''); setTxNote('');
        await reload();
        addToast('记账成功', 'success');
    };

    // ─── 锻炼 ───
    const [exActivity, setExActivity] = useState('');
    const [exDuration, setExDuration] = useState('');
    const exerciseRecords = useMemo(() => effectiveRecords.filter(r => r.module === 'exercise'), [effectiveRecords]);
    const todayExercise = useMemo(() => exerciseRecords.filter(r => r.date === today), [exerciseRecords, today]);
    /** 最近 7 天（含今日），供打点日历用：[{date, done, weekday}] */
    const weekDots = useMemo(() => {
        const names = ['日', '一', '二', '三', '四', '五', '六'];
        const done = new Set(exerciseRecords.map(r => r.date));
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(Date.now() - (6 - i) * 24 * 3600 * 1000);
            const ds = d.toISOString().split('T')[0];
            return { date: ds, done: done.has(ds), weekday: names[d.getUTCDay()] };
        });
    }, [exerciseRecords]);
    const weekDays = useMemo(() => weekDots.filter(d => d.done).length, [weekDots]);

    const handleAddExercise = async () => {
        if (!exActivity.trim()) { addToast('先填运动项目哦', 'error'); return; }
        await addUserRecord('exercise', 'session', {
            activity: exActivity.trim(),
            ...(exDuration.trim() ? { duration: exDuration.trim() } : {}),
        });
        setExActivity(''); setExDuration('');
        addToast('已记录锻炼', 'success');
    };

    if (!loaded) return <div className="py-16 text-center text-xs text-slate-300" style={{ fontFamily: SERIF }}>翻开记事簿…</div>;

    const theme = THEMES[tab];
    const accentBtn = (t: ModuleTheme): React.CSSProperties => ({
        background: t.accent, color: '#fdfbf7', fontFamily: SERIF,
        boxShadow: `0 8px 16px -8px ${t.accent}99, inset 0 0 0 1px #ffffff30`,
    });

    return (
        <div className="space-y-4">
            {/* 模块页签（书签式；长按隐藏） */}
            {visibleModules.length > 0 && (
                <div className="flex gap-1.5 rounded-[6px] p-1.5"
                    style={{ background: '#f2ede4', border: '1px solid #e5ddcd', boxShadow: 'inset 0 1px 3px #0000000a' }}>
                    {visibleModules.map(m => (
                        <ModuleTab
                            key={m}
                            module={m}
                            active={tab === m}
                            onSelect={() => setTab(m)}
                            onRequestHide={() => setHideCandidate(m)}
                        />
                    ))}
                </div>
            )}

            {visibleModules.length === 0 && (
                <Plaque theme={THEMES.expense} className="text-center py-10">
                    <div className="text-2xl mb-2" style={{ color: '#b3aca1' }}>❧</div>
                    <p className="text-xs" style={{ fontFamily: SERIF, color: '#8b8378' }}>所有功能均已隐藏</p>
                </Plaque>
            )}

            {/* ─── 月相记事（生理期） ─── */}
            {tab === 'period' && visibleModules.includes('period') && (
                <>
                    <Plaque theme={THEMES.period}>
                        <SectionHead theme={THEMES.period} cn="月相记事" en="LUNA · CYCLE" />
                        {/* 背景月牙 */}
                        <div aria-hidden className="pointer-events-none absolute right-4 top-9 opacity-[0.09]">
                            <svg viewBox="0 0 24 24" width={92} height={92} fill={THEMES.period.accent}>
                                <path d="M20 13.2A8.2 8.2 0 0 1 10.8 4a8.2 8.2 0 1 0 9.2 9.2Z" />
                            </svg>
                        </div>
                        <div className="relative text-center py-1">
                            {periodStatus.inPeriod ? (
                                <>
                                    <div className="text-[10px] mb-1.5" style={{ color: THEMES.period.accent, opacity: 0.75, fontFamily: SERIF }}>
                                        {fmtCN(periodStatus.lastStart!)} 开始
                                    </div>
                                    <div style={{ fontFamily: SERIF, color: THEMES.period.accent }}>
                                        <span className="text-sm align-[0.5em] mr-1">第</span>
                                        <span className="text-[44px] font-bold leading-none tracking-tight">{periodStatus.dayN}</span>
                                        <span className="text-sm align-[0.5em] ml-1">天</span>
                                    </div>
                                    <div className="text-[10px] mt-2" style={{ color: '#8b8378' }}>月事进行中 · 记得对自己好一点</div>
                                </>
                            ) : periodStatus.lastStart ? (
                                <>
                                    <div className="text-[15px] font-bold" style={{ fontFamily: SERIF, color: '#4a4039' }}>当前不在经期</div>
                                    <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: '#8b8378' }}>
                                        上次 {fmtCN(periodStatus.lastStart)}{periodStatus.lastEnd ? ` ～ ${fmtCN(periodStatus.lastEnd)}` : ''}
                                        {periodStatus.nextPredicted && periodStatus.daysUntilNext !== undefined && (
                                            <>
                                                <br />
                                                {periodStatus.daysUntilNext >= 0
                                                    ? <>下一次约在 <span style={{ color: THEMES.period.accent, fontWeight: 700 }}>{fmtCN(periodStatus.nextPredicted)}</span>（{periodStatus.daysUntilNext} 天后）</>
                                                    : <>已比预测推迟约 {-periodStatus.daysUntilNext} 天</>}
                                            </>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="text-[15px] font-bold" style={{ fontFamily: SERIF, color: '#4a4039' }}>尚无记录</div>
                                    <div className="text-[10px] mt-1.5" style={{ color: '#8b8378' }}>月事来临时，在这里落下一笔</div>
                                </>
                            )}
                            <button
                                onClick={handlePeriodToggle}
                                className="mt-4 px-9 py-2.5 rounded-full text-[13px] font-bold active:scale-95 transition-transform"
                                style={accentBtn(THEMES.period)}
                            >
                                {periodStatus.inPeriod ? '记录结束' : '记录开始'}
                            </button>
                        </div>
                        <div className="relative mt-4 pt-3 flex items-center justify-between"
                            style={{ borderTop: `1px dashed ${THEMES.period.soft}` }}>
                            <span className="text-[10px]" style={{ color: '#8b8378', fontFamily: SERIF }}>平均周期（用于预测）</span>
                            <span className="flex items-baseline gap-1">
                                <input
                                    type="number"
                                    defaultValue={settings?.cycleLength || DEFAULT_CYCLE_LENGTH}
                                    onBlur={(e) => handleCycleChange(e.target.value)}
                                    className="w-12 text-center bg-transparent outline-none text-sm font-bold"
                                    style={{ fontFamily: SERIF, color: THEMES.period.accent, borderBottom: `1px solid ${THEMES.period.soft}` }}
                                />
                                <span className="text-[10px]" style={{ color: '#8b8378' }}>天</span>
                            </span>
                        </div>
                    </Plaque>

                    {periodHistory.length > 0 && (
                        <Plaque theme={THEMES.period}>
                            <SectionHead theme={THEMES.period} cn="往月手记" en="ARCHIVE" />
                            <div className="relative pl-4">
                                <span aria-hidden className="absolute left-[5px] top-1 bottom-1 w-px" style={{ background: THEMES.period.soft }} />
                                <div className="space-y-2.5">
                                    {periodHistory.map(r => (
                                        <div key={r.id} className="relative flex items-center justify-between text-[11px]" style={{ fontFamily: SERIF }}>
                                            <span aria-hidden className="absolute -left-[14.5px] w-[9px] h-[9px] rounded-full"
                                                style={r.kind === 'start'
                                                    ? { background: THEMES.period.accent, boxShadow: '0 0 0 2px #fff' }
                                                    : { background: '#fff', border: `1.5px solid ${THEMES.period.accent}`, boxShadow: '0 0 0 2px #fff' }} />
                                            <span style={{ color: '#4a4039' }}>
                                                {fmtCN(r.date)} · {r.kind === 'start' ? '始' : '止'}
                                                <span className="text-[9px]" style={{ color: '#b3aca1' }}>{recordedByLabel(r)}</span>
                                            </span>
                                            <button onClick={() => removeRecord(r)} className="px-1.5 text-slate-300 hover:text-rose-400">✕</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Plaque>
                    )}
                </>
            )}

            {/* ─── 药剂手记（药盒） ─── */}
            {tab === 'med' && visibleModules.includes('med') && (
                <>
                    <Plaque theme={THEMES.med}>
                        <SectionHead theme={THEMES.med} cn="今日药签" en="PHARMACY · TODAY" />
                        {plans.filter(p => p.enabled).length === 0 ? (
                            <p className="text-[11px] text-center py-4" style={{ color: '#8b8378', fontFamily: SERIF }}>
                                药柜空空 —— 先在下方立一条用药计划
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {plans.filter(p => p.enabled).map(p => {
                                    const taken = !!planTakenRecord(p);
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={() => handleTogglePlanTaken(p)}
                                            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[4px] text-left transition-all active:scale-[0.99]"
                                            style={{
                                                background: taken ? '#eef6f1' : '#ffffffa8',
                                                border: `1px solid ${taken ? THEMES.med.accent + '55' : THEMES.med.soft}`,
                                            }}
                                        >
                                            <span className="text-[11px] tabular-nums shrink-0 w-10" style={{ fontFamily: SERIF, color: THEMES.med.accent }}>{p.time}</span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xs font-bold truncate" style={{ fontFamily: SERIF, color: taken ? THEMES.med.accent : '#4a4039' }}>
                                                    {p.name}
                                                </span>
                                                {p.dosage && <span className="text-[9px]" style={{ color: '#8b8378' }}>{p.dosage}</span>}
                                            </span>
                                            {/* 蜡封印章式打卡钮 */}
                                            <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition-all"
                                                style={taken ? {
                                                    background: THEMES.med.accent, color: '#fdfbf7', transform: 'rotate(-8deg)',
                                                    boxShadow: `inset 0 0 0 2px #ffffff40, 0 3px 8px -3px ${THEMES.med.accent}`,
                                                } : {
                                                    border: `1.5px dashed ${THEMES.med.soft}`, color: '#c9c2b5',
                                                }}>
                                                {taken ? '✓' : ''}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {todayMeds.filter(r => !r.payload.planId).length > 0 && (
                            <div className="mt-3 pt-3" style={{ borderTop: `1px dashed ${THEMES.med.soft}` }}>
                                <div className="text-[9px] mb-1.5" style={{ color: '#8b8378', letterSpacing: '0.2em' }}>计划之外</div>
                                {todayMeds.filter(r => !r.payload.planId).map(r => (
                                    <div key={r.id} className="flex items-center justify-between text-[11px] py-1" style={{ fontFamily: SERIF }}>
                                        <span style={{ color: '#4a4039' }}>{r.payload.name}<span className="text-[9px]" style={{ color: '#b3aca1' }}>{recordedByLabel(r)}</span></span>
                                        <button onClick={() => removeRecord(r)} className="px-1.5 text-slate-300 hover:text-rose-400">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Plaque>

                    <Plaque theme={THEMES.med}>
                        <SectionHead theme={THEMES.med} cn="配药方" en="PRESCRIPTION" />
                        {plans.length > 0 && (
                            <div className="space-y-1.5 mb-3">
                                {plans.map(p => (
                                    <div key={p.id} className="flex items-center gap-2 text-[11px] py-1"
                                        style={{ fontFamily: SERIF, opacity: p.enabled ? 1 : 0.45, borderBottom: `1px dashed ${THEMES.med.soft}` }}>
                                        <span className="tabular-nums w-10" style={{ color: THEMES.med.accent }}>{p.time}</span>
                                        <span className="flex-1 truncate font-medium" style={{ color: '#4a4039' }}>{p.name}{p.dosage ? ` · ${p.dosage}` : ''}</span>
                                        <button
                                            onClick={async () => { await DB.saveMedPlan({ ...p, enabled: !p.enabled }); await reload(); }}
                                            className="text-[9px] px-2 py-0.5 rounded-full"
                                            style={p.enabled
                                                ? { color: THEMES.med.accent, border: `1px solid ${THEMES.med.accent}55` }
                                                : { color: '#b3aca1', border: '1px solid #e5ddcd' }}
                                        >
                                            {p.enabled ? '启用' : '停用'}
                                        </button>
                                        <button onClick={async () => { await DB.deleteMedPlan(p.id); await reload(); }} className="px-1 text-slate-300 hover:text-rose-400">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex items-end gap-2.5">
                            <input type="time" value={planTime} onChange={e => setPlanTime(e.target.value)}
                                className={`w-[74px] ${inkInput(THEMES.med.accent)}`} style={inkInputStyle(THEMES.med)} />
                            <input value={planName} onChange={e => setPlanName(e.target.value)} placeholder="药名"
                                className={`flex-1 min-w-0 ${inkInput(THEMES.med.accent)}`} style={inkInputStyle(THEMES.med)} />
                            <input value={planDosage} onChange={e => setPlanDosage(e.target.value)} placeholder="剂量"
                                className={`w-14 ${inkInput(THEMES.med.accent)}`} style={inkInputStyle(THEMES.med)} />
                            <button onClick={handleAddPlan}
                                className="shrink-0 px-4 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-transform"
                                style={accentBtn(THEMES.med)}>
                                立方
                            </button>
                        </div>
                    </Plaque>
                </>
            )}

            {/* ─── 每日账簿（记账） ─── */}
            {tab === 'expense' && visibleModules.includes('expense') && (
                <>
                    <Plaque theme={THEMES.expense}>
                        <SectionHead theme={THEMES.expense} cn="每日账簿" en="LEDGER" />
                        <div className="flex items-end justify-between px-1">
                            <div>
                                <div className="text-[9px] mb-0.5" style={{ color: '#8b8378', letterSpacing: '0.25em' }}>今日支出</div>
                                <div style={{ fontFamily: SERIF, color: THEMES.expense.accent }}>
                                    <span className="text-[34px] font-bold leading-none tabular-nums">{todayTotal}</span>
                                </div>
                            </div>
                            <div className="text-right pb-1">
                                <div className="text-[9px] mb-0.5" style={{ color: '#8b8378', letterSpacing: '0.25em' }}>本月累计</div>
                                <div className="text-sm font-bold tabular-nums" style={{ fontFamily: SERIF, color: '#4a4039' }}>{monthTotal}</div>
                            </div>
                        </div>
                        <p className="text-[9px] italic mt-2 px-1" style={{ color: '#b3aca1', fontFamily: SERIF }}>
                            与银行 App 共用一本账
                        </p>
                        <div className="flex items-end gap-2.5 mt-3 pt-3" style={{ borderTop: `1px dashed ${THEMES.expense.soft}` }}>
                            <input value={txAmount} onChange={e => setTxAmount(e.target.value)} inputMode="decimal" placeholder="金额"
                                className={`w-16 ${inkInput(THEMES.expense.accent)}`} style={inkInputStyle(THEMES.expense)} />
                            <input value={txNote} onChange={e => setTxNote(e.target.value)} placeholder="用途（奶茶 / 午饭…）"
                                className={`flex-1 min-w-0 ${inkInput(THEMES.expense.accent)}`} style={inkInputStyle(THEMES.expense)} />
                            <button onClick={handleAddTx}
                                className="shrink-0 px-4 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-transform"
                                style={accentBtn(THEMES.expense)}>
                                入账
                            </button>
                        </div>
                    </Plaque>

                    <Plaque theme={THEMES.expense}>
                        <SectionHead theme={THEMES.expense} cn="今日流水" en="ENTRIES" />
                        {todayTxs.length === 0 ? (
                            <p className="text-[11px] text-center py-4" style={{ color: '#8b8378', fontFamily: SERIF }}>
                                今日账面清白 ❧
                            </p>
                        ) : (
                            <div>
                                {todayTxs.map(t => (
                                    <div key={t.id} className="flex items-center gap-2 py-2 text-[11px]"
                                        style={{ fontFamily: SERIF, borderBottom: `1px dashed ${THEMES.expense.soft}` }}>
                                        <span className="flex-1 truncate" style={{ color: '#4a4039' }}>{t.note || '未备注'}</span>
                                        <span className="font-bold tabular-nums" style={{ color: THEMES.expense.accent }}>{t.amount}</span>
                                        <button
                                            onClick={async () => { await DB.deleteTransaction(t.id); await reload(); addToast('记录已删除', 'success'); }}
                                            className="px-1 text-slate-300 hover:text-rose-400"
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Plaque>
                </>
            )}

            {/* ─── 体能训练（锻炼） ─── */}
            {tab === 'exercise' && visibleModules.includes('exercise') && (
                <>
                    <Plaque theme={THEMES.exercise}>
                        <SectionHead theme={THEMES.exercise} cn="体能训练" en="TRAINING" />
                        {/* 近七日打点 */}
                        <div className="flex justify-between px-2 mb-1">
                            {weekDots.map(d => (
                                <div key={d.date} className="flex flex-col items-center gap-1.5">
                                    <span aria-hidden className="w-3 h-3 rotate-45 transition-colors"
                                        style={d.done
                                            ? { background: THEMES.exercise.accent, boxShadow: `0 2px 6px -2px ${THEMES.exercise.accent}` }
                                            : { border: `1px solid ${THEMES.exercise.soft}`, background: '#ffffff90' }} />
                                    <span className="text-[8px]" style={{ color: d.date === today ? THEMES.exercise.accent : '#b3aca1', fontFamily: SERIF }}>
                                        {d.date === today ? '今' : d.weekday}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="text-center text-[10px] mb-3" style={{ color: '#8b8378', fontFamily: SERIF }}>
                            {todayExercise.length > 0
                                ? <>今日已训 <span style={{ color: THEMES.exercise.accent, fontWeight: 700 }}>{todayExercise.length}</span> 次</>
                                : '今日尚未开练'}
                            <span className="mx-2" style={{ color: THEMES.exercise.soft }}>❖</span>
                            七日之内 <span style={{ color: THEMES.exercise.accent, fontWeight: 700 }}>{weekDays}</span> 天有练
                        </div>
                        <div className="flex items-end gap-2.5 pt-3" style={{ borderTop: `1px dashed ${THEMES.exercise.soft}` }}>
                            <input value={exActivity} onChange={e => setExActivity(e.target.value)} placeholder="项目（跑步 / 瑜伽…）"
                                className={`flex-1 min-w-0 ${inkInput(THEMES.exercise.accent)}`} style={inkInputStyle(THEMES.exercise)} />
                            <input value={exDuration} onChange={e => setExDuration(e.target.value)} placeholder="时长"
                                className={`w-16 ${inkInput(THEMES.exercise.accent)}`} style={inkInputStyle(THEMES.exercise)} />
                            <button onClick={handleAddExercise}
                                className="shrink-0 px-4 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-transform"
                                style={accentBtn(THEMES.exercise)}>
                                盖章
                            </button>
                        </div>
                    </Plaque>

                    {exerciseRecords.length > 0 && (
                        <Plaque theme={THEMES.exercise}>
                            <SectionHead theme={THEMES.exercise} cn="训练存档" en="ARCHIVE" />
                            <div className="space-y-0.5">
                                {exerciseRecords.slice(0, 14).map(r => (
                                    <div key={r.id} className="flex items-center gap-2 py-1.5 text-[11px]"
                                        style={{ fontFamily: SERIF, borderBottom: `1px dashed ${THEMES.exercise.soft}` }}>
                                        <span aria-hidden className="w-2 h-2 rotate-45 shrink-0" style={{ background: THEMES.exercise.accent, opacity: 0.6 }} />
                                        <span className="flex-1 truncate" style={{ color: '#4a4039' }}>
                                            {fmtCN(r.date)} · {r.payload.activity}{r.payload.duration ? ` ${r.payload.duration}` : ''}
                                            <span className="text-[9px]" style={{ color: '#b3aca1' }}>{recordedByLabel(r)}</span>
                                        </span>
                                        <button onClick={() => removeRecord(r)} className="px-1 text-slate-300 hover:text-rose-400">✕</button>
                                    </div>
                                ))}
                            </div>
                        </Plaque>
                    )}
                </>
            )}

            {/* 页脚注释：注入提示 + 长按隐藏提示 + 恢复入口 */}
            <div className="text-center space-y-1 pb-1">
                <p className="text-[9px] italic leading-relaxed px-4" style={{ color: '#b3aca1', fontFamily: SERIF }}>
                    想让某个角色「隐约知道」这些，去神经链接里打开对应角色的「生活记录注入」；
                    <br />长按上方页签，可隐藏你不需要的功能。
                </p>
                {hiddenModules.length > 0 && (
                    <button
                        onClick={() => setShowRestore(true)}
                        className="text-[9px] underline underline-offset-2"
                        style={{ color: '#8b8378', fontFamily: SERIF }}
                    >
                        已隐藏 {hiddenModules.length} 项功能 · 查看与恢复
                    </button>
                )}
            </div>

            {/* 隐藏确认弹窗 */}
            {hideCandidate && (
                <div className="fixed inset-0 z-[100] bg-black/35 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in"
                    onClick={() => setHideCandidate(null)}>
                    <div onClick={e => e.stopPropagation()}>
                        <Plaque theme={THEMES[hideCandidate]} className="w-[280px] !p-6 text-center">
                            <div className="flex justify-center mb-2 opacity-80">{THEMES[hideCandidate].icon}</div>
                            <h3 className="text-[15px] font-bold mb-2" style={{ fontFamily: SERIF, color: '#4a4039' }}>
                                是否不需要这个功能？
                            </h3>
                            <p className="text-[11px] leading-relaxed mb-5" style={{ color: '#8b8378', fontFamily: SERIF }}>
                                隐藏「{THEMES[hideCandidate].cn}」后，这里不再显示它，
                                也不会把相关内容注入给任何角色。
                                <br />之后随时可以从页脚恢复。
                            </p>
                            <div className="flex gap-2.5">
                                <button
                                    onClick={() => setHideCandidate(null)}
                                    className="flex-1 py-2 rounded-full text-[12px] font-bold"
                                    style={{ fontFamily: SERIF, color: '#8b8378', border: '1px solid #e5ddcd', background: '#ffffff90' }}
                                >
                                    先留着
                                </button>
                                <button
                                    onClick={() => confirmHide(hideCandidate)}
                                    className="flex-1 py-2 rounded-full text-[12px] font-bold active:scale-95 transition-transform"
                                    style={accentBtn(THEMES[hideCandidate])}
                                >
                                    确定隐藏
                                </button>
                            </div>
                        </Plaque>
                    </div>
                </div>
            )}

            {/* 恢复弹窗 */}
            {showRestore && (
                <div className="fixed inset-0 z-[100] bg-black/35 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in"
                    onClick={() => setShowRestore(false)}>
                    <div onClick={e => e.stopPropagation()}>
                        <Plaque theme={THEMES.expense} className="w-[280px] !p-6">
                            <h3 className="text-[14px] font-bold mb-4 text-center" style={{ fontFamily: SERIF, color: '#4a4039' }}>
                                已隐藏的功能
                            </h3>
                            <div className="space-y-2 mb-4">
                                {hiddenModules.map(m => (
                                    <div key={m} className="flex items-center justify-between px-3 py-2 rounded-[4px]"
                                        style={{ background: '#ffffff90', border: '1px solid #e5ddcd' }}>
                                        <span className="flex items-center gap-2 text-[12px] font-bold" style={{ fontFamily: SERIF, color: '#4a4039' }}>
                                            {THEMES[m].icon}{THEMES[m].cn}
                                        </span>
                                        <button
                                            onClick={() => restoreModule(m)}
                                            className="text-[10px] px-3 py-1 rounded-full font-bold"
                                            style={{ color: THEMES[m].accent, border: `1px solid ${THEMES[m].accent}66` }}
                                        >
                                            恢复
                                        </button>
                                    </div>
                                ))}
                                {hiddenModules.length === 0 && (
                                    <p className="text-[11px] text-center py-2" style={{ color: '#8b8378', fontFamily: SERIF }}>没有隐藏中的功能</p>
                                )}
                            </div>
                            <button
                                onClick={() => setShowRestore(false)}
                                className="w-full py-2 rounded-full text-[12px] font-bold"
                                style={{ fontFamily: SERIF, color: '#8b8378', border: '1px solid #e5ddcd', background: '#ffffff90' }}
                            >
                                收起
                            </button>
                        </Plaque>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LifeRecordPanel;


import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { BankTransaction, LifeRecord, LifeRecordModule, LifeRecordSettings, MedPlan } from '../../types';
import {
    DEFAULT_CYCLE_LENGTH, computePeriodStatus, lifeToday,
} from '../../utils/lifeRecords';

/**
 * 档案 App「生活记录」面板：生理期 / 药盒 / 记账 / 锻炼。
 * - 用户手动记录 reviewStatus 直接 'confirmed'（不需要复核）。
 * - 记账不独立存储：直接读写 BankApp 的 bank_transactions（同一本账，
 *   BankApp 打开时会从流水重算 todaySpent）。
 * - 是否注入给某个角色，在「神经链接」该角色的设置里开（总开关 + 模块小开关）。
 */

const MODULE_TABS: { key: LifeRecordModule; label: string; icon: string }[] = [
    { key: 'period', label: '生理期', icon: '🌙' },
    { key: 'med', label: '药盒', icon: '💊' },
    { key: 'expense', label: '记账', icon: '🧾' },
    { key: 'exercise', label: '锻炼', icon: '🏃' },
];

const fmtCN = (s: string): string => {
    const p = (s || '').split('-');
    return p.length === 3 ? `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日` : s;
};

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div className={`bg-white rounded-[1.75rem] shadow-[0_10px_30px_-12px_rgba(80,70,120,0.18)] border border-slate-100 p-5 ${className || ''}`}>
        {children}
    </div>
);

const LifeRecordPanel: React.FC = () => {
    const { addToast } = useOS();
    const [tab, setTab] = useState<LifeRecordModule>('period');
    const [records, setRecords] = useState<LifeRecord[]>([]);
    const [plans, setPlans] = useState<MedPlan[]>([]);
    const [settings, setSettings] = useState<LifeRecordSettings | null>(null);
    const [txs, setTxs] = useState<BankTransaction[]>([]);
    const [loaded, setLoaded] = useState(false);

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

    const recordedByLabel = (r: LifeRecord) => r.recordedBy === 'user' ? '' : `（${r.recordedByName || '角色'} 代记）`;

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
    const weekDays = useMemo(() => {
        const cutoff = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString().split('T')[0];
        return new Set(exerciseRecords.filter(r => r.date >= cutoff && r.date <= today).map(r => r.date)).size;
    }, [exerciseRecords, today]);

    const handleAddExercise = async () => {
        if (!exActivity.trim()) { addToast('先填运动项目哦', 'error'); return; }
        await addUserRecord('exercise', 'session', {
            activity: exActivity.trim(),
            ...(exDuration.trim() ? { duration: exDuration.trim() } : {}),
        });
        setExActivity(''); setExDuration('');
        addToast('已记录锻炼', 'success');
    };

    if (!loaded) return <div className="py-16 text-center text-xs text-slate-300">加载中…</div>;

    return (
        <div className="space-y-4">
            {/* 模块切换 */}
            <div className="bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 flex gap-1">
                {MODULE_TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-colors ${
                            tab === t.key ? 'bg-primary text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50'
                        }`}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed px-1">
                想让某个角色"隐约知道"这些记录，去「神经链接」那个角色的设置里打开「生活记录注入」。角色也能在聊天里帮你代记（会出卡片让你确认 / 否决）。
            </p>

            {/* ─── 生理期 ─── */}
            {tab === 'period' && (
                <>
                    <Card>
                        <div className="text-center py-2">
                            {periodStatus.inPeriod ? (
                                <>
                                    <div className="text-3xl mb-1">🌙</div>
                                    <div className="text-lg font-bold text-rose-500">经期第 {periodStatus.dayN} 天</div>
                                    <div className="text-[11px] text-slate-400 mt-1">{fmtCN(periodStatus.lastStart!)} 开始</div>
                                </>
                            ) : periodStatus.lastStart ? (
                                <>
                                    <div className="text-3xl mb-1">🌸</div>
                                    <div className="text-lg font-bold text-slate-700">当前不在经期</div>
                                    <div className="text-[11px] text-slate-400 mt-1">
                                        上次：{fmtCN(periodStatus.lastStart)}{periodStatus.lastEnd ? ` ~ ${fmtCN(periodStatus.lastEnd)}` : ''}
                                        {periodStatus.nextPredicted && periodStatus.daysUntilNext !== undefined && (
                                            periodStatus.daysUntilNext >= 0
                                                ? ` · 预测下次 ${fmtCN(periodStatus.nextPredicted)}（约 ${periodStatus.daysUntilNext} 天后）`
                                                : ` · 已比预测推迟约 ${-periodStatus.daysUntilNext} 天`
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="text-3xl mb-1">🌸</div>
                                    <div className="text-lg font-bold text-slate-700">还没有记录</div>
                                    <div className="text-[11px] text-slate-400 mt-1">经期来的时候点下面记一笔就好</div>
                                </>
                            )}
                            <button
                                onClick={handlePeriodToggle}
                                className={`mt-4 px-8 py-2.5 rounded-2xl text-sm font-bold text-white shadow-md active:scale-95 transition-transform ${
                                    periodStatus.inPeriod ? 'bg-slate-400' : 'bg-rose-400'
                                }`}
                            >
                                {periodStatus.inPeriod ? '记录结束' : '记录开始'}
                            </button>
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between">
                            <span className="text-[11px] text-slate-400">平均周期（天）· 用于预测</span>
                            <input
                                type="number"
                                defaultValue={settings?.cycleLength || DEFAULT_CYCLE_LENGTH}
                                onBlur={(e) => handleCycleChange(e.target.value)}
                                className="w-16 bg-slate-50 rounded-xl px-2 py-1.5 text-xs text-center border border-slate-100 outline-none focus:border-primary/30"
                            />
                        </div>
                    </Card>
                    {periodHistory.length > 0 && (
                        <Card>
                            <h3 className="text-xs font-bold text-slate-500 mb-3">历史记录</h3>
                            <div className="space-y-2">
                                {periodHistory.map(r => (
                                    <div key={r.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2">
                                        <span className="text-slate-600">
                                            {fmtCN(r.date)} · {r.kind === 'start' ? '开始' : '结束'}
                                            <span className="text-slate-300 ml-1">{recordedByLabel(r)}</span>
                                        </span>
                                        <button onClick={() => removeRecord(r)} className="text-slate-300 hover:text-rose-400 px-1">✕</button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </>
            )}

            {/* ─── 药盒 ─── */}
            {tab === 'med' && (
                <>
                    <Card>
                        <h3 className="text-xs font-bold text-slate-500 mb-3">今日打卡</h3>
                        {plans.filter(p => p.enabled).length === 0 ? (
                            <p className="text-[11px] text-slate-300 text-center py-3">还没有用药计划，先在下面添加一个吧</p>
                        ) : (
                            <div className="space-y-2">
                                {plans.filter(p => p.enabled).map(p => {
                                    const taken = !!planTakenRecord(p);
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={() => handleTogglePlanTaken(p)}
                                            className={`w-full flex items-center gap-3 rounded-2xl px-3.5 py-2.5 border transition-colors text-left ${
                                                taken ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
                                            }`}
                                        >
                                            <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] ${taken ? 'bg-emerald-400' : 'bg-slate-200'}`}>
                                                {taken ? '✓' : ''}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-xs font-bold ${taken ? 'text-emerald-700' : 'text-slate-600'}`}>{p.name}{p.dosage ? ` · ${p.dosage}` : ''}</div>
                                                <div className="text-[10px] text-slate-400">{p.time}</div>
                                            </div>
                                            <span className="text-[10px] text-slate-300">{taken ? '点击取消' : '点击打卡'}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {todayMeds.filter(r => !r.payload.planId).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-50">
                                <div className="text-[10px] text-slate-400 mb-1.5">计划外用药</div>
                                {todayMeds.filter(r => !r.payload.planId).map(r => (
                                    <div key={r.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2 mb-1.5">
                                        <span className="text-slate-600">{r.payload.name}<span className="text-slate-300 ml-1">{recordedByLabel(r)}</span></span>
                                        <button onClick={() => removeRecord(r)} className="text-slate-300 hover:text-rose-400 px-1">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                    <Card>
                        <h3 className="text-xs font-bold text-slate-500 mb-3">用药计划</h3>
                        <div className="space-y-2 mb-3">
                            {plans.map(p => (
                                <div key={p.id} className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${p.enabled ? 'bg-slate-50' : 'bg-slate-50 opacity-50'}`}>
                                    <span className="font-mono text-slate-400">{p.time}</span>
                                    <span className="flex-1 text-slate-600 font-medium truncate">{p.name}{p.dosage ? ` · ${p.dosage}` : ''}</span>
                                    <button
                                        onClick={async () => { await DB.saveMedPlan({ ...p, enabled: !p.enabled }); await reload(); }}
                                        className={`text-[10px] px-2 py-0.5 rounded-full ${p.enabled ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-100 text-slate-400'}`}
                                    >
                                        {p.enabled ? '启用中' : '已停用'}
                                    </button>
                                    <button onClick={async () => { await DB.deleteMedPlan(p.id); await reload(); }} className="text-slate-300 hover:text-rose-400 px-1">✕</button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input type="time" value={planTime} onChange={e => setPlanTime(e.target.value)}
                                className="w-24 bg-slate-50 rounded-xl px-2 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <input value={planName} onChange={e => setPlanName(e.target.value)} placeholder="药名"
                                className="flex-1 min-w-0 bg-slate-50 rounded-xl px-3 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <input value={planDosage} onChange={e => setPlanDosage(e.target.value)} placeholder="剂量"
                                className="w-16 bg-slate-50 rounded-xl px-2 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <button onClick={handleAddPlan} className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold shrink-0 active:scale-95">添加</button>
                        </div>
                    </Card>
                </>
            )}

            {/* ─── 记账 ─── */}
            {tab === 'expense' && (
                <>
                    <Card>
                        <div className="flex items-end justify-between mb-1">
                            <div>
                                <div className="text-[10px] text-slate-400">今日支出</div>
                                <div className="text-2xl font-bold text-slate-700">{todayTotal}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] text-slate-400">本月</div>
                                <div className="text-sm font-bold text-slate-500">{monthTotal}</div>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-300 mb-3">与银行 App 共用一本账，两边都能看到。</p>
                        <div className="flex gap-2">
                            <input value={txAmount} onChange={e => setTxAmount(e.target.value)} inputMode="decimal" placeholder="金额"
                                className="w-20 bg-slate-50 rounded-xl px-3 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <input value={txNote} onChange={e => setTxNote(e.target.value)} placeholder="用途（奶茶 / 午饭…）"
                                className="flex-1 min-w-0 bg-slate-50 rounded-xl px-3 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <button onClick={handleAddTx} className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold shrink-0 active:scale-95">记一笔</button>
                        </div>
                    </Card>
                    <Card>
                        <h3 className="text-xs font-bold text-slate-500 mb-3">今日流水</h3>
                        {todayTxs.length === 0 ? (
                            <p className="text-[11px] text-slate-300 text-center py-3">今天还没有支出记录</p>
                        ) : (
                            <div className="space-y-2">
                                {todayTxs.map(t => (
                                    <div key={t.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2">
                                        <span className="text-slate-600 truncate">{t.note || '未备注'}</span>
                                        <span className="flex items-center gap-2 shrink-0">
                                            <span className="font-bold text-slate-700">{t.amount}</span>
                                            <button
                                                onClick={async () => { await DB.deleteTransaction(t.id); await reload(); addToast('记录已删除', 'success'); }}
                                                className="text-slate-300 hover:text-rose-400 px-1"
                                            >✕</button>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </>
            )}

            {/* ─── 锻炼 ─── */}
            {tab === 'exercise' && (
                <>
                    <Card>
                        <div className="flex items-end justify-between mb-3">
                            <div>
                                <div className="text-[10px] text-slate-400">今日</div>
                                <div className="text-sm font-bold text-slate-700">{todayExercise.length > 0 ? `已锻炼 ${todayExercise.length} 次` : '还没锻炼'}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] text-slate-400">最近 7 天</div>
                                <div className="text-sm font-bold text-emerald-500">{weekDays} 天有锻炼</div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input value={exActivity} onChange={e => setExActivity(e.target.value)} placeholder="项目（跑步 / 瑜伽…）"
                                className="flex-1 min-w-0 bg-slate-50 rounded-xl px-3 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <input value={exDuration} onChange={e => setExDuration(e.target.value)} placeholder="时长"
                                className="w-20 bg-slate-50 rounded-xl px-2 py-2 text-xs border border-slate-100 outline-none focus:border-primary/30" />
                            <button onClick={handleAddExercise} className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold shrink-0 active:scale-95">记录</button>
                        </div>
                    </Card>
                    <Card>
                        <h3 className="text-xs font-bold text-slate-500 mb-3">最近记录</h3>
                        {exerciseRecords.length === 0 ? (
                            <p className="text-[11px] text-slate-300 text-center py-3">还没有锻炼记录</p>
                        ) : (
                            <div className="space-y-2">
                                {exerciseRecords.slice(0, 14).map(r => (
                                    <div key={r.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2">
                                        <span className="text-slate-600 truncate">
                                            {fmtCN(r.date)} · {r.payload.activity}{r.payload.duration ? ` ${r.payload.duration}` : ''}
                                            <span className="text-slate-300 ml-1">{recordedByLabel(r)}</span>
                                        </span>
                                        <button onClick={() => removeRecord(r)} className="text-slate-300 hover:text-rose-400 px-1">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </>
            )}
        </div>
    );
};

export default LifeRecordPanel;

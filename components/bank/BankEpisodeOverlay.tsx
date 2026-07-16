import React, { useState } from 'react';
import { BankEpisode, BankWeather } from '../../types';
import { WEATHER_META } from '../../utils/bank/narrative';
import { FilmSlate, CaretDown, CaretUp } from '@phosphor-icons/react';

interface Props {
    episodes: BankEpisode[];
    /** 今天是否已开演 */
    playedToday: boolean;
    isGenerating: boolean;
    /** 按当前账本实时预报的今晚天气 */
    forecast: { weather: BankWeather; txCount: number };
    onGenerate: () => void;
    onClose: () => void;
}

const WeatherChip: React.FC<{ weather: BankWeather; energy?: number | null }> = ({ weather, energy }) => {
    const meta = WEATHER_META[weather];
    return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-[#EFEBE9] text-[#6D4C41] px-2 py-0.5 rounded-full">
            {meta.emoji} {meta.label}{typeof energy === 'number' ? ` · 元气 ${energy}` : ''}
        </span>
    );
};

const EpisodePaper: React.FC<{ ep: BankEpisode }> = ({ ep }) => {
    const isFog = ep.weather === 'fog';
    return (
        <div className="bg-white rounded-2xl border border-[#E8DCC8] shadow-md overflow-hidden">
            {/* 刊头 */}
            <div className="px-5 pt-4 pb-3 border-b-2 border-[#5D4037]">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] tracking-[0.3em] text-[#A1887F] uppercase">The Daily Cafe</span>
                    <WeatherChip weather={ep.weather} energy={ep.energy} />
                </div>
                <h3 className="font-serif font-black text-lg text-[#3E2723] mt-1">{ep.title}</h3>
                <div className="text-[9px] text-[#BCAAA4] mt-0.5">
                    {ep.date} · {ep.generatedBy === 'llm' ? '特约撰稿' : '本店速记'} · +{ep.coinsEarned} 🪙
                </div>
            </div>
            {/* 正文 */}
            <div className={`px-5 py-4 ${isFog ? 'relative' : ''}`}>
                <p
                    className={`font-serif text-sm text-[#4E342E] leading-relaxed whitespace-pre-wrap ${isFog ? 'blur-[2px] opacity-70 select-none' : ''}`}
                >
                    {ep.body}
                </p>
                {isFog && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-xs font-bold text-[#8D6E63] bg-[#FDF6E3]/90 px-4 py-2 rounded-xl border border-[#E8DCC8] shadow">
                            🌫 没人记账，无人知晓昨夜的故事
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

const BankEpisodeOverlay: React.FC<Props> = ({
    episodes, playedToday, isGenerating, forecast, onGenerate, onClose,
}) => {
    const [showArchive, setShowArchive] = useState(false);
    const latest = episodes[0];
    const archive = episodes.slice(1);
    const fMeta = WEATHER_META[forecast.weather];
    // 早上误开出雾天、之后补了账 → 允许"雾散重演"升级今天这集
    const fogUpgradable = playedToday && latest?.weather === 'fog' && forecast.txCount > 0 && forecast.weather !== 'fog';
    const showGenerateCard = !playedToday || fogUpgradable;

    return (
        <div className="absolute inset-0 z-[100] flex flex-col animate-slide-up" style={{ background: 'linear-gradient(180deg, #FDF6E3 0%, #FFF8E1 100%)' }}>
            {/* Header */}
            <div className="pt-[calc(var(--safe-top)+0.75rem)] pb-3 px-4 shrink-0"
                 style={{ background: 'linear-gradient(180deg, rgba(141, 110, 99, 0.95) 0%, rgba(109, 76, 65, 0.95) 100%)', backdropFilter: 'blur(10px)' }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                            <FilmSlate size={22} weight="fill" className="text-[#FFE0B2]" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-white tracking-wide">今日开演</h2>
                            <p className="text-[10px] text-white/60 uppercase tracking-wider">Tonight at the Cafe</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl bg-white/15 text-white/90 flex items-center justify-center hover:bg-white/25 active:scale-95 transition-all text-lg font-bold"
                    >
                        ×
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 开演 / 预报卡 */}
                {showGenerateCard ? (
                    <div className="bg-white p-5 rounded-2xl shadow-md border border-[#E8DCC8]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="font-bold text-[#5D4037] text-sm">{fogUpgradable ? '雾散了！可以重开今天的戏' : '今晚的天气预报'}</h3>
                                <p className="text-xs text-[#8D6E63] mt-1">
                                    {fMeta.emoji} <b>{fMeta.label}</b>
                                    {forecast.weather === 'fog'
                                        ? ' —— 今天还没记账，雾里什么都看不清'
                                        : `（已记 ${forecast.txCount} 笔）`}
                                </p>
                                <p className="text-[10px] text-[#BCAAA4] mt-1.5">
                                    省得越有分寸，今晚的戏越晴朗。白天记的账都会变成剧情道具。
                                </p>
                            </div>
                            <button
                                onClick={onGenerate}
                                disabled={isGenerating}
                                className={`shrink-0 px-5 py-3 rounded-xl font-bold text-xs shadow-lg transition-all ${
                                    isGenerating
                                        ? 'bg-[#EFEBE9] text-[#BCAAA4]'
                                        : 'bg-gradient-to-r from-[#FF8A65] to-[#FF7043] text-white hover:shadow-xl active:scale-95'
                                }`}
                            >
                                {isGenerating ? (
                                    <span className="flex items-center gap-2">
                                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                        开演中…
                                    </span>
                                ) : fogUpgradable ? '🌤 重新开演' : '🎬 今日开演'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-[10px] text-[#BCAAA4] py-1">
                        今天的戏已经演过了，明天请早 🎫
                    </div>
                )}

                {/* 最新一集 */}
                {latest ? (
                    <EpisodePaper ep={latest} />
                ) : (
                    <div className="text-center py-16">
                        <div className="text-7xl mb-4 opacity-40">🎬</div>
                        <p className="text-sm font-bold text-[#BCAAA4]">舞台已就绪，还没有第一集</p>
                        <p className="text-xs text-[#D7CCC8] mt-1">记几笔账，然后按下「今日开演」</p>
                    </div>
                )}

                {/* 往期存档 */}
                {archive.length > 0 && (
                    <div>
                        <button
                            onClick={() => setShowArchive(!showArchive)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-[#8D6E63] hover:text-[#5D4037] transition-colors"
                        >
                            往期剧集（{archive.length}）
                            {showArchive ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
                        </button>
                        {showArchive && (
                            <div className="space-y-3 mt-2">
                                {archive.map(ep => <EpisodePaper key={ep.id} ep={ep} />)}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BankEpisodeOverlay;

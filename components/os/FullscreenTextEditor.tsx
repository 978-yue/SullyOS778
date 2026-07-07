import React, { useEffect, useRef } from 'react';

/**
 * 全屏文本编辑器 —— 给那些「窗口太小、文本滑不动」的编辑框一个能全屏展开、
 * 大面积输入 + 原生顺畅滚动的空间。跨 App 复用（神经链接角色设定、记忆宫殿记忆编辑等）。
 *
 * 采用「实时回写」策略（onChange 直接写回父级 value），跟本项目其它编辑框
 * 的自动保存行为保持一致——收起时不会丢改动，也没有额外的「保存 / 取消」心智负担。
 */
interface FullscreenTextEditorProps {
    open: boolean;
    title: string;
    value: string;
    placeholder?: string;
    onChange: (next: string) => void;
    onClose: () => void;
}

const FullscreenTextEditor: React.FC<FullscreenTextEditorProps> = ({ open, title, value, placeholder, onChange, onClose }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 打开时聚焦，光标落到末尾，方便接着上次继续写。
    useEffect(() => {
        if (!open) return;
        const ta = textareaRef.current;
        if (!ta) return;
        const id = window.setTimeout(() => {
            ta.focus();
            const len = ta.value.length;
            try { ta.setSelectionRange(len, len); } catch { /* noop */ }
        }, 60);
        return () => window.clearTimeout(id);
    }, [open]);

    if (!open) return null;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                display: 'flex', flexDirection: 'column',
                background: 'linear-gradient(180deg, #faf5ff 0%, #ffffff 45%)',
                // 顶栏自己让开安全区 + SullyOS 状态栏：全屏面板统一用 --chrome-top
                // （= --safe-top + 状态栏高度；状态栏隐藏时自动退化成 --safe-top），
                // 跟 VRWorld / 剧场 / 交换日记等全屏顶栏一致，避免「完成」贴到状态栏太靠上。
                paddingTop: 'var(--chrome-top)', paddingBottom: 'var(--safe-bottom)',
                animation: 'appEnterFade 160ms ease-out both',
            }}
        >
            {/* 顶栏：标题 + 完成 */}
            <div
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', flexShrink: 0,
                    borderBottom: '1px solid rgba(124,58,237,0.1)',
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1f1147', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                </div>
                <button
                    onClick={onClose}
                    style={{
                        flexShrink: 0, marginLeft: 12,
                        padding: '7px 18px', borderRadius: 999, border: 'none',
                        fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
                        boxShadow: '0 4px 10px rgba(124,58,237,0.3)',
                    }}
                >
                    完成
                </button>
            </div>

            {/* 正文：占满剩余空间，原生顺畅滚动 */}
            <textarea
                ref={textareaRef}
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.target.value)}
                className="vr-reader-scroll"
                style={{
                    flex: 1, width: '100%', minHeight: 0,
                    border: 'none', outline: 'none', resize: 'none',
                    padding: '16px', boxSizing: 'border-box',
                    fontSize: 15, lineHeight: 1.7, color: '#1f2937',
                    background: 'transparent', fontFamily: 'inherit',
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain',
                    touchAction: 'pan-y',
                }}
            />
        </div>
    );
};

export default FullscreenTextEditor;

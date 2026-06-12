/**
 * 当前 UI 在哪个 App、对着哪个角色 —— 模块级快照。
 *
 * 给非 React 模块（activeMsgRuntime 等）做行为判断用，由 OSContext 在
 * activeApp / activeCharacterId 变化时写入（与 MusicContext 暴露播放快照
 * 是同一套模式）。
 *
 * 注意：apiCallLog.ts 的 ambientMeta 只是 API 日志的兜底标签，语义上
 * 明确不该拿来当行为依据，所以这里单独建一份，不复用那边。
 */

import { AppID } from '../types';

let current: { appId: AppID | null; charId: string | null } = { appId: null, charId: null };

export function setUiPresence(appId: AppID, charId: string | null): void {
    current = { appId, charId };
}

/** 用户此刻是否正在 DateApp 里和这个角色见面（含选人/peek/会话/历史等所有内部界面）。 */
export function isDatingChar(charId: string): boolean {
    return current.appId === AppID.Date && current.charId === charId;
}

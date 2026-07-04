/**
 * 捏人器 PSD 整批导入（开发模式）。
 *
 * 画师在一个 PSD 里按"图层组 = 一个部件"组织素材，直接把整个 PSD 丢进来，
 * 免去逐张导出 / 重命名 / 上传的流程。约定：
 *
 * - 画布须与捏人器素材同规格（472×472 正方形；过大会自动缩到 944 以内）。
 *   所有图层按其在画布上的位置合成，锚点天然对齐。
 * - 顶层"图层组"= 一个部件；顶层散图层也算一个部件。
 * - 组名 / 图层名格式：`类目 名称`，类目支持中文别名或英文 key，
 *   如 `前发 云朵刘海`、`earhair 长鬓发`、`后发1-马尾`。识别不出的类目在
 *   开发面板里手动选。
 * - 组内 **正片叠底（multiply）图层 = 这个部件投出去的阴影**（如刘海投在
 *   耳发/脸上的影子）。导入时预转成"黑色 + alpha"的普通图层（中性正片叠底
 *   B×g 与 alpha=1-g 的纯黑覆盖数学等价），存进 shadowSrc；渲染时垫在部件
 *   颜色层下方、不参与染色。注意：带颜色的阴影会被中性化（只保留明度）。
 * - 组内其余普通图层合成为部件本体（src）。本体上的自阴影/高光直接画在
 *   颜色层里即可——换色是按像素明度重上色的，明暗关系会保留。
 * - 可换色标记：名字带 `#色` / `#tint` 强制可换色，带 `#原色` / `#notint`
 *   强制不可换色；不标记时头发类目默认可换色，其余默认不可。
 */

export interface ParsedPsdPart {
    /** 猜出来的类目 key；识别不出为 null，由用户在面板里指定 */
    categoryKey: string | null;
    name: string;
    tintable: boolean;
    /** 部件本体（透明 PNG data URL，画布尺寸） */
    src: string;
    /** 正片叠底层预转出来的阴影（黑色+alpha 普通图层）；没有则无 */
    shadowSrc?: string;
    warnings: string[];
}

export interface PsdImportResult {
    parts: ParsedPsdPart[];
    /** 全局提示（画布尺寸不对之类） */
    warnings: string[];
    docWidth: number;
    docHeight: number;
}

/** 类目别名 → key（与 character_creator.html 的 PARTS key 对应） */
const CATEGORY_ALIASES: [string, string[]][] = [
    ['fronthair', ['fronthair', '前发', '前發', '刘海', '瀏海']],
    ['earhair', ['earhair', '耳发', '耳發', '鬓发', '鬓髮']],
    ['back1', ['back1', '后发1', '後發1', '后发一']],
    ['back2', ['back2', '后发2', '後發2', '后发二']],
    ['skin', ['skin', '肤色', '皮肤', '身体', 'body']],
    ['eyes', ['eyes', '眼睛', '眼']],
    ['mouth', ['mouth', '嘴巴', '嘴']],
    ['outfit', ['outfit', '衣服', '服装']],
    ['outer', ['outer', '外套']],
    ['facemark', ['facemark', '面纹', '脸纹', '腮红']],
    ['decor', ['decor', '配饰', '饰品', '装饰']],
];

const HAIR_KEYS = new Set(['fronthair', 'earhair', 'back1', 'back2']);

/** 输出上限：超过就整体缩到 472（数据存 IndexedDB，别塞几千像素的 data URL） */
const MAX_OUT = 944;
const TARGET = 472;

/** 从组名解析 类目 / 显示名 / tintable 标记 */
export function parseLayerName(raw: string, hasCategory = true): { categoryKey: string | null; name: string; tintable: boolean | null } {
    let name = (raw || '').trim();
    let tintable: boolean | null = null;
    // tint 标记（全角井号也认；先匹配否定形，免得 #notint 被 tint 抢走）
    name = name.replace(/[#＃]\s*(原色|notint)/i, () => { tintable = false; return ''; }).trim();
    if (tintable === null) {
        name = name.replace(/[#＃]\s*(色|tint)/i, () => { tintable = true; return ''; }).trim();
    }
    if (!hasCategory) return { categoryKey: null, name, tintable };

    const lower = name.toLowerCase();
    let matched: { key: string; alias: string } | null = null;
    for (const [key, aliases] of CATEGORY_ALIASES) {
        for (const alias of aliases) {
            if (lower.startsWith(alias.toLowerCase()) && (!matched || alias.length > matched.alias.length)) {
                matched = { key, alias };
            }
        }
    }
    if (!matched) return { categoryKey: null, name, tintable };
    const rest = name.slice(matched.alias.length).replace(/^[\s\-_·、:：/｜|]+/, '').trim();
    return { categoryKey: matched.key, name: rest || name, tintable };
}

/**
 * 正片叠底像素 → 普通图层像素（原地改写）：黑色 + alpha = a×(1-明度)。
 * 中性（灰）阴影下两者数学等价：B×g == B×(1-a)，a = 1-g。
 * 返回是否发现带色阴影（会被中性化，只保留深浅）。
 */
export function multiplyPixelsToNormal(px: Uint8ClampedArray): boolean {
    let hadColor = false;
    for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (a === 0) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 24) hadColor = true;
        const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0;
        px[i + 3] = Math.round(a * (1 - gray));
    }
    return hadColor;
}

function multiplyToNormal(canvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; hadColor: boolean } {
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hadColor = multiplyPixelsToNormal(img.data);
    ctx.putImageData(img, 0, 0);
    return { canvas, hadColor };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

function hasInk(canvas: HTMLCanvasElement): boolean {
    const px = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) return true;
    return false;
}

function exportDataUrl(canvas: HTMLCanvasElement, scale: number): string {
    if (scale >= 1) return canvas.toDataURL('image/png');
    const out = makeCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
}

/** 深度优先展平一个组的叶子图层（ag-psd children 从底到顶） */
function flattenLeaves(node: any, acc: any[] = []): any[] {
    for (const child of node.children || []) {
        if (child.children) flattenLeaves(child, acc);
        else acc.push(child);
    }
    return acc;
}

export async function parseCreatorPsd(buffer: ArrayBuffer): Promise<PsdImportResult> {
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(buffer, { skipThumbnail: true, skipCompositeImageData: true });
    const W = psd.width, H = psd.height;
    const warnings: string[] = [];
    if (W !== H) warnings.push(`画布 ${W}×${H} 不是正方形，会和现有素材（472×472）错位`);
    else if (W !== TARGET) warnings.push(`画布 ${W}×${H}（现有素材是 472×472，按比例缩放对齐，锚点一致即可）`);
    const scale = W > MAX_OUT ? TARGET / W : 1;

    const parts: ParsedPsdPart[] = [];
    // 顶层：组 = 部件；散图层也算一个部件
    for (const top of psd.children || []) {
        if (top.hidden) continue;
        const leaves = top.children ? flattenLeaves(top).filter(l => !l.hidden) : [top];
        if (!leaves.length) continue;

        const colorCanvas = makeCanvas(W, H);
        const shadowCanvas = makeCanvas(W, H);
        const colorCtx = colorCanvas.getContext('2d')!;
        const shadowCtx = shadowCanvas.getContext('2d')!;
        const partWarnings: string[] = [];
        let shadowCount = 0;

        for (const layer of leaves) {
            if (!layer.canvas) continue;
            const isMultiply = layer.blendMode === 'multiply';
            const ctx = isMultiply ? shadowCtx : colorCtx;
            if (isMultiply) {
                // 多张正片叠底层之间也按 multiply 叠（等效于各自转 alpha 后普通叠加）
                ctx.globalCompositeOperation = shadowCount === 0 ? 'source-over' : 'multiply';
                shadowCount++;
            } else if (layer.blendMode && layer.blendMode !== 'normal' && layer.blendMode !== 'pass through') {
                partWarnings.push(`图层「${layer.name || '?'}」混合模式 ${layer.blendMode} 不支持，按普通处理`);
            }
            ctx.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity : 1;
            ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
            ctx.globalAlpha = 1;
        }

        if (!hasInk(colorCanvas)) {
            warnings.push(`「${top.name || '?'}」本体图层是空的，跳过`);
            continue;
        }

        const parsed = parseLayerName(top.name || '');
        let shadowSrc: string | undefined;
        if (shadowCount > 0) {
            const { canvas: sh, hadColor } = multiplyToNormal(shadowCanvas);
            if (hadColor) partWarnings.push('阴影带颜色，已中性化（只保留深浅）');
            if (hasInk(sh)) shadowSrc = exportDataUrl(sh, scale);
        }

        parts.push({
            categoryKey: parsed.categoryKey,
            name: parsed.name,
            tintable: parsed.tintable !== null ? parsed.tintable : HAIR_KEYS.has(parsed.categoryKey || ''),
            src: exportDataUrl(colorCanvas, scale),
            shadowSrc,
            warnings: partWarnings,
        });
    }

    if (!parts.length) warnings.push('没解析出任何部件：确认顶层是"图层组=一个部件"的结构');
    return { parts, warnings, docWidth: W, docHeight: H };
}

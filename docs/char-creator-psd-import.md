# 捏人器 · PSD 整批导入 & 部件投影层

> 覆盖 520 / 彼方共用的捏人器（`public/like520/character_creator.html`）、
> 开发面板（`apps/CharCreatorDevApp.tsx`）、解析器（`utils/psdCreatorImport.ts`）。

## 为什么有这个

新画风的素材很吃阴影：刘海投在耳发/脸上的影子必须跟着刘海走（画在刘海的部件里），
但部件又要支持换色——换色是**按像素明度重新上色**的（`applyTint`），如果把投影直接
合并进可换色的本体图层，影子会被染成头发色、且落在皮肤上时颜色不对。

所以部件新增了独立的**投影层**（`CustomCreatorPart.shadowSrc`）：

- 渲染时垫在该部件颜色层**下方**、同一容器内（`mountShadowSub`）——影子只落在
  露出来的下层（耳发/脸）上，部件本体会盖住自己区域内的影子；
- **不参与染色**，换发色影子不变；
- 跟随部件一起翻转/显隐。

## 正片叠底怎么处理的

PSD 里阴影层用正片叠底（multiply）画。导入时**预转成"黑色 + alpha"的普通图层**：

```
中性（灰）正片叠底：结果 = B × g
黑色普通覆盖：      结果 = B × (1 - a)
取 a = 1 - g  →  两者逐像素等价
```

所以运行时不需要 `mix-blend-mode`（html2canvas 导出也不支持它），普通叠层就是
数学上精确的 multiply。代价：**带颜色的阴影会被中性化**（只保留深浅），导入面板
会提示。多张 multiply 层互相叠加时先用 canvas `multiply` 合成再转换，结果仍等价。

部件**自身**的明暗（发丝阴影、高光）不用拆层——直接画在本体里合并即可，
`applyTint` 按明度重上色，明暗关系天然保留。

## PSD 组织约定

- 画布与现有素材同规格：**472×472**（大画布会等比缩到 472，超过 944 触发）；
  所有图层按画布位置合成，锚点天然对齐，一个 PSD 装下整批部件。
- **顶层图层组 = 一个部件**；顶层散图层也算一个部件；隐藏的组/图层跳过。
- 组名格式 `类目 名称`，类目认中文别名或英文 key：
  前发/刘海、耳发/鬓发、后发1、后发2、肤色/皮肤/身体、眼睛、嘴、
  衣服/服装、外套、面纹/腮红、配饰/饰品/装饰。
- 组内 multiply 层 → 投影；其余普通层 → 本体。其他混合模式不支持（按普通处理并提示）。
- 换色标记：名字带 `#色`/`#tint` 强制可换色，`#原色`/`#notint` 强制不可；
  不标时头发四类默认可换色，其余默认不可。解析结果在开发面板里逐个可改。

## 数据流

```
画师 PSD ──(CharCreatorDevApp「PSD 整批导入」)──> parseCreatorPsd
  ├─ 本体层合成 → part.src（透明 PNG dataURL）
  └─ multiply 层合成+预转 → part.shadowSrc
        ↓ 面板确认（类目/名称/可换色）
  DB.saveCustomCreatorPart（IndexedDB）
        ↓ Like520Event 随 like520_init / like520_add_items 注入 extraItems
  character_creator.html mergeExtraItems → item.shadow
        ↓ renderCharacter → mountShadowSub（影下色上）
```

测试：`pnpm vitest run utils/psdCreatorImport.test.ts`（名字解析 + multiply 转换的等价性）。

// 模擬試験のスクリーンショットを解析して、標識の図と「答え」欄の位置を求める。
//
// レイアウト:
//   [Qxx バッジ]  問題文
//                 標識・標示の図
//                 （余白）
//                 中央の「答え」ボタン（オレンジの丸を含む）
//                 解説の囲み
//
// 縦方向の分割では左端のQバッジ（縦に大きく、問題文と図をつないでしまう）と
// 端の枠線を無視する。図の横幅だけは、分割後に全幅から測り直す。

const SEG_LEFT = 0.12;   // 分割に使う左端（Qバッジを避ける）
const EDGE = 0.02;       // 端の枠線を避けるマージン
const GAP = 8;           // これ未満の空き行は同じかたまりとみなす

const isOrange = (r, g, b) => r > 195 && g > 50 && g < 150 && b < 115 && r - b > 90;

function analyze({ width: W, height: H, rgba }) {
  const edge = Math.round(W * EDGE);
  const segLeft = Math.round(W * SEG_LEFT);
  const right = W - edge;

  const rows = [];
  for (let y = 0; y < H; y++) {
    let seg = 0, min = -1, max = -1, orange = 0;
    for (let x = edge; x < right; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      if (a < 20 || (r >= 245 && g >= 245 && b >= 245)) continue;
      if (min < 0) min = x;
      max = x;
      if (x >= segLeft) {
        seg++;
        if (isOrange(r, g, b)) orange++;
      }
    }
    rows.push({ seg, min, max, orange });
  }

  const blocks = [];
  let cur = null;
  for (let y = 0; y < H; y++) {
    if (rows[y].seg > W * 0.004) {
      if (!cur) cur = { top: y, bottom: y, min: W, max: 0, orange: 0 };
      cur.bottom = y;
      cur.orange += rows[y].orange;
    } else if (cur && y - cur.bottom > GAP) {
      blocks.push(cur);
      cur = null;
    }
  }
  if (cur) blocks.push(cur);
  // 横幅はQバッジを除いた全幅から測り直す
  for (const b of blocks) {
    for (let y = b.top; y <= b.bottom; y++) {
      if (rows[y].min < 0) continue;
      b.min = Math.min(b.min, Math.max(rows[y].min, segLeft * 0));
      b.max = Math.max(b.max, rows[y].max);
    }
  }

  const centered = (b) => {
    const w = b.max - b.min;
    return Math.abs((b.min + b.max) / 2 - W / 2) < W * 0.06 && w > W * 0.06 && w < W * 0.45;
  };
  const idx = blocks.findIndex(
    (b) => b.top > H * 0.3 && centered(b) && b.orange > 20 && b.bottom - b.top < H * 0.25,
  );
  return { blocks, idx, W, H };
}

/** 「答え」ボタンの手前（余白の中央）のY座標。見つからなければ null。 */
export function detectAnswerTop(img) {
  const { blocks, idx } = analyze(img);
  if (idx < 0) return null;
  const prev = blocks[idx - 1];
  const gapTop = prev ? prev.bottom + 1 : Math.max(0, blocks[idx].top - 20);
  return Math.round((gapTop + blocks[idx].top) / 2);
}

/** 標識・標示の図の範囲（「答え」ボタンの直前のかたまり）。見つからなければ null。 */
export function detectFigure(img) {
  const { blocks, idx, W, H } = analyze(img);
  if (idx < 1) return null;
  const fig = blocks[idx - 1];
  const pad = Math.round(W * 0.015);
  return {
    top: Math.max(0, fig.top - pad),
    bottom: Math.min(H, fig.bottom + pad),
    left: Math.max(0, fig.min - pad),
    right: Math.min(W, fig.max + pad),
  };
}

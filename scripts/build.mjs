// mistakes.md をパースして静的サイト (_site/) を組み立てる。
// 依存パッケージなし。node scripts/build.mjs で実行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from './lib/png.mjs';
import { detectAnswerTop, detectFigure } from './lib/crop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'docs');

const FIELD = /^-\s+\*\*(.+?)\*\*\s*[:：]\s*(.*)$/;
const SET_HEAD = /^##\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(.+?)\s*$/;
const Q_HEAD = /^###\s+(\S+)\s*(.*)$/;

function parse(md) {
  const sets = [];
  const questions = [];
  const warnings = [];
  let set = null;
  let q = null;
  let field = null;

  const flush = () => {
    if (!q) return;
    const answer = q.正解 === '○' ? true : q.正解 === '×' ? false : null;
    if (answer === null) {
      warnings.push(`${q.id}: 正解が ○/× ではないためスキップ (${q.正解 ?? 'なし'})`);
      q = null;
      return;
    }
    if (!q.問題) {
      warnings.push(`${q.id}: 問題文がないためスキップ`);
      q = null;
      return;
    }
    const img = (q.画像 ?? '').match(/(\S+\.(?:png|jpe?g|gif|webp|svg))\s*(?:[（(]\s*(.*?)\s*[）)])?\s*$/i);
    questions.push({
      id: q.id,
      setId: set?.id ?? 'other',
      title: q.title,
      text: q.問題,
      image: img ? img[1] : null,
      imageNote: img?.[2] || null,
      answer,
      point: q.ポイント ?? '',
    });
    q = null;
  };

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();

    const qh = line.match(Q_HEAD);
    if (qh) {
      flush();
      field = null;
      const title = qh[2].replace(/\s*\(Q\d+\)\s*$/, '').trim();
      q = { id: qh[1], title, tags: [...title.matchAll(/【(.+?)】/g)].map((m) => m[1]) };
      q.title = title.replace(/【.+?】/g, '').trim();
      continue;
    }

    const sh = !qh && line.match(SET_HEAD);
    if (sh) {
      flush();
      field = null;
      set = { id: `s${sets.length + 1}`, date: sh[1] ?? null, title: sh[2] };
      sets.push(set);
      continue;
    }

    if (!q) continue;

    const f = line.match(FIELD);
    if (f) {
      field = f[1];
      q[field] = f[2].trim();
      continue;
    }
    // フィールドの続き行（空行以外）を連結
    if (field && line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
      q[field] = `${q[field]} ${line.trim()}`.trim();
      continue;
    }
    if (!line.trim()) field = null;
  }
  flush();

  const used = new Set(questions.map((x) => x.setId));
  return { sets: sets.filter((s) => used.has(s.id)), questions, warnings };
}

const md = fs.readFileSync(path.join(root, 'mistakes.md'), 'utf8');
const { sets, questions, warnings } = parse(md);

// 画像の存在チェック
for (const q of questions) {
  if (q.image && !fs.existsSync(path.join(root, q.image))) {
    warnings.push(`${q.id}: 画像が見つからない (${q.image})`);
    q.image = null;
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(root, 'web'), OUT, { recursive: true });

// 画像は模擬試験のスクリーンショットで、答えと解説まで写り込んでいる。
// 標識・標示の図だけを切り出して配信する（切り出せなければ「答え」の手前で落とす）。
const cropImage = (img, box) => {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((box.top + y) * img.width + box.left) * 4;
    img.rgba.copy(rgba, y * w * 4, from, from + w * 4);
  }
  return { width: w, height: h, rgba };
};

let cropped = 0;
for (const q of questions) {
  if (!q.image) continue;
  const src = path.join(root, q.image);
  const dst = path.join(OUT, q.image);
  try {
    const img = decode(fs.readFileSync(src));
    const fig = detectFigure(img);
    const w = fig ? fig.right - fig.left : 0;
    const h = fig ? fig.bottom - fig.top : 0;
    let box = null;

    if (fig && h >= 100 && w / h <= 6) {
      box = fig; // 標識・標示の図
    } else if (fig) {
      // 横に細長い＝図がなく問題文だけのスクリーンショット。文章は本文で出るので画像は使わない。
      q.image = null;
      continue;
    } else {
      const y = detectAnswerTop(img);
      if (!y || y < img.height * 0.15) throw new Error('「答え」の位置を検出できなかった');
      box = { left: 0, top: 0, right: img.width, bottom: y };
      warnings.push(`${q.id}: ${q.image} の図を切り出せないため、答えの手前までを表示する`);
    }

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, encode(cropImage(img, box)));
    cropped++;
  } catch (e) {
    // 切り抜けないものは配信しない（答えが見えるくらいなら画像なしのほうがまし）
    warnings.push(`${q.id}: ${q.image} を切り抜けないため画像なしで出題する（${e.message}）`);
    q.image = null;
  }
}

fs.writeFileSync(
  path.join(OUT, 'questions.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), sets, questions }, null, 0),
);

const withImage = questions.filter((q) => q.image).length;
console.log(`✅ ${questions.length}問 (画像 ${withImage}問 / 切り抜き ${cropped}枚) / ${sets.length}セット → docs/`);
for (const w of warnings) console.warn(`⚠️  ${w}`);

'use strict';

const STORE = 'gakka-exam/progress/v1';
const app = document.getElementById('app');

let DATA = { sets: [], questions: [] };
let progress = load();
let filter = { scope: 'all', setId: 'all' };
let quiz = null;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch { /* プライベートブラウズ等 */ }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// **強調** だけ Markdown を活かす
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const setTitle = (id) => DATA.sets.find((s) => s.id === id)?.title ?? '';
// 連続正解数。null は未挑戦。2回連続で正解したら苦手から卒業。
const GRADUATE = 2;
function streakOf(id) {
  const r = progress[id];
  if (!r) return null;
  return r.streak ?? (r.last === 'ok' ? 1 : 0); // streak を持たない旧データからの移行
}
const isWeak = (q) => { const s = streakOf(q.id); return s !== null && s < GRADUATE; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const SCOPES = [
  { key: 'all', label: 'すべて', test: () => true },
  { key: 'wrong', label: '苦手', test: isWeak },
  { key: 'fresh', label: '未挑戦', test: (q) => !progress[q.id] },
  { key: 'sign', label: '標識', test: (q) => !!q.image },
];

function pool(f = filter) {
  const scope = SCOPES.find((s) => s.key === f.scope) ?? SCOPES[0];
  return DATA.questions.filter((q) => (f.setId === 'all' || q.setId === f.setId) && scope.test(q));
}

/* ---------------- ホーム ---------------- */
function renderHome() {
  const total = DATA.questions.length;
  const weak = DATA.questions.filter(isWeak).length;
  const done = DATA.questions.filter((q) => progress[q.id]).length;
  const list = pool();

  app.innerHTML = `
    <h1>学科試験ドリル</h1>
    <p class="sub">模擬試験で間違えた ${total} 問。○×で答えて、解説で確認。</p>
    <div class="stats">
      <div class="stat"><b>${total}</b><span>収録問題</span></div>
      <div class="stat"><b>${done}</b><span>挑戦済み</span></div>
      <div class="stat"><b>${weak}</b><span>苦手</span></div>
    </div>
    <h2>出題範囲</h2>
    <div class="chips" id="scopes">
      ${SCOPES.map((s) => {
        const n = pool({ ...filter, scope: s.key }).length;
        return `<button class="chip" data-scope="${s.key}" aria-pressed="${filter.scope === s.key}" ${n ? '' : 'disabled'}>${s.label}<small>${n}</small></button>`;
      }).join('')}
    </div>
    <h2>模擬試験</h2>
    <div class="chips" id="sets">
      <button class="chip" data-set="all" aria-pressed="${filter.setId === 'all'}">すべて</button>
      ${DATA.sets.map((s) => {
        const n = pool({ ...filter, setId: s.id }).length;
        return `<button class="chip" data-set="${s.id}" aria-pressed="${filter.setId === s.id}" ${n ? '' : 'disabled'}>${esc(s.title)}<small>${n}</small></button>`;
      }).join('')}
    </div>
    <button class="start" id="start" ${list.length ? '' : 'disabled'}>
      ${list.length ? `${list.length}問はじめる` : '該当する問題がありません'}
    </button>
    <button class="textbtn" id="reset">解答履歴をリセット</button>
    <p class="foot">出典: 自分の模擬試験の誤答ノート。正解・解説は自習用メモなので、最終確認は教本で。</p>
  `;

  app.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => { filter.scope = b.dataset.scope; renderHome(); });
  app.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => { filter.setId = b.dataset.set; renderHome(); });
  app.querySelector('#start').onclick = () => startQuiz(list);
  app.querySelector('#reset').onclick = () => {
    if (confirm('挑戦済み・苦手の記録をすべて消します。よろしいですか？')) { progress = {}; save(); renderHome(); }
  };
}

/* ---------------- 出題 ---------------- */
function startQuiz(list) {
  quiz = { items: shuffle([...list]), i: 0, answered: null, log: [] };
  renderQuiz();
}

function renderQuiz() {
  const q = quiz.items[quiz.i];
  const n = quiz.items.length;
  const answered = quiz.answered;

  app.innerHTML = `
    <div class="bar">
      <button class="quit" id="quit">やめる</button>
      <div class="track"><div class="fill" style="width:${(quiz.i / n) * 100}%"></div></div>
      <span class="count">${quiz.i + 1} / ${n}</span>
    </div>
    <div class="card">
      <div class="meta">${q.image ? '<span class="tag">標識</span>' : ''}${esc(setTitle(q.setId))} ${esc(q.id)}</div>
      ${q.image ? `<figure><img src="${esc(q.image)}" alt="${esc(q.imageNote || '問題の標識')}" loading="lazy"></figure>` : ''}
      <p class="qtext">${md(q.text)}</p>
    </div>
    <div class="answers">
      <button class="ans pick-o" data-v="1">○</button>
      <button class="ans pick-x" data-v="0">×</button>
    </div>
    <div id="feedback"></div>
  `;

  app.querySelector('#quit').onclick = () => { quiz = null; renderHome(); };
  app.querySelectorAll('.ans').forEach((b) => b.onclick = () => answer(b.dataset.v === '1'));
  if (answered !== null) showFeedback();
}

function answer(choice) {
  const q = quiz.items[quiz.i];
  const ok = choice === q.answer;
  quiz.answered = choice;
  quiz.log.push({ q, ok });

  const rec = progress[q.id] ?? { ok: 0, ng: 0 };
  rec.streak = ok ? (streakOf(q.id) ?? 0) + 1 : 0;
  rec[ok ? 'ok' : 'ng']++;
  rec.last = ok ? 'ok' : 'ng';
  progress[q.id] = rec;
  save();
  showFeedback();
}

function showFeedback() {
  const q = quiz.items[quiz.i];
  const ok = quiz.answered === q.answer;
  app.querySelectorAll('.ans').forEach((b) => {
    b.disabled = true;
    if ((b.dataset.v === '1') === quiz.answered) b.classList.add('chosen');
  });
  const last = quiz.i === quiz.items.length - 1;
  const streak = streakOf(q.id) ?? 0;
  const note = !ok ? '苦手に入れた'
    : streak >= GRADUATE ? `${GRADUATE}回連続で正解。苦手から卒業`
    : GRADUATE - streak === 1 ? 'あと1回正解すると苦手から卒業'
    : `あと${GRADUATE - streak}回連続で正解すると苦手から卒業`;
  app.querySelector('#feedback').innerHTML = `
    <div class="result ${ok ? 'ok' : 'ng'}">
      <div class="verdict">${ok ? '正解' : '不正解'} ｜ 答えは ${q.answer ? '○' : '×'}</div>
      ${q.point ? `<div class="point">${md(q.point)}</div>` : ''}
      <div class="note">${note}</div>
    </div>
    <button class="next" id="next">${last ? '結果を見る' : '次の問題へ'}</button>
  `;
  const next = app.querySelector('#next');
  next.onclick = () => {
    if (last) return renderResult();
    quiz.i++; quiz.answered = null; renderQuiz();
    window.scrollTo(0, 0);
  };
  next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------------- 結果 ---------------- */
function renderResult() {
  const hits = quiz.log.filter((l) => l.ok).length;
  const n = quiz.log.length;
  const missed = quiz.log.filter((l) => !l.ok).map((l) => l.q);
  const rate = Math.round((hits / n) * 100);

  app.innerHTML = `
    <div class="score">
      <b>${rate}<small style="font-size:1.2rem">%</small></b>
      <span>${n}問中 ${hits}問正解</span>
    </div>
    ${missed.length ? `<h2>間違えた ${missed.length} 問</h2>` : '<h2>全問正解！</h2>'}
    ${missed.map((q) => `
      <div class="review">
        <div class="meta">${esc(setTitle(q.setId))} ${esc(q.id)} ｜ 答え ${q.answer ? '○' : '×'}</div>
        <p>${md(q.text)}</p>
        ${q.point ? `<div class="point">${md(q.point)}</div>` : ''}
      </div>`).join('')}
    <div class="actions">
      ${missed.length ? '<button class="primary" id="again">間違えた問題をもう一度</button>' : ''}
      <button id="home">ホームに戻る</button>
    </div>
  `;
  window.scrollTo(0, 0);
  const again = app.querySelector('#again');
  if (again) again.onclick = () => startQuiz(missed);
  app.querySelector('#home').onclick = () => { quiz = null; renderHome(); };
}

/* ---------------- 起動 ---------------- */
fetch('questions.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then((d) => { DATA = d; renderHome(); })
  .catch(() => { app.innerHTML = '<h1>読み込みに失敗しました</h1><p class="sub">通信状況を確認して、ページを再読み込みしてください。</p>'; });

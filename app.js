// واجهة المحادثة: تعرض رسائل الوكيل وأزرارها، وترسل مدخلات الطالب إلى آلة الحالات (bot.js).
import { createBot, loadData } from './bot.js';
import { STRINGS } from './i18n.js';

const params = new URLSearchParams(location.search);
const TYPING_MS = params.has('delay') ? Number(params.get('delay')) : 550;

const root = document.documentElement;
const chat = document.getElementById('chat');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const langBtn = document.getElementById('lang-toggle');
const themeBtn = document.getElementById('theme-toggle');
const progress = document.getElementById('progress');
let bot;
let busy = false;
let data;

// التفضيلات تُحفظ في المتصفح فقط، والصفحة تعمل بدونها
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* تجاهل */ } }
};

let lang = params.get('lang') === 'en' || params.get('lang') === 'ar' ? params.get('lang') : (store.get('bosla-lang') === 'en' ? 'en' : 'ar');
const ui = () => STRINGS[lang].ui;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const scrollDown = () => { chat.scrollTop = chat.scrollHeight; };

function setBusy(v) {
  busy = v;
  document.body.dataset.busy = v ? '1' : '0';
  sendBtn.disabled = v;
}

// ---------- اللغة ----------
function applyLang() {
  const u = ui();
  root.lang = lang;
  root.dir = STRINGS[lang].dir;
  document.title = u.title;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = u[el.dataset.i18n]; });
  input.placeholder = u.placeholder;
  input.setAttribute('aria-label', u.placeholder);
  sendBtn.setAttribute('aria-label', u.send);
  chat.setAttribute('aria-label', u.brand);
  langBtn.querySelector('.lang-code').textContent = u.langBtn;
  langBtn.setAttribute('aria-label', u.langLabel);
  langBtn.title = u.langLabel;
  updateThemeLabel();
}

// ---------- الوضع الساطع والداكن ----------
const systemDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark());

function updateThemeLabel() {
  const label = isDark() ? ui().themeLight : ui().themeDark;
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
  themeBtn.setAttribute('aria-pressed', String(isDark()));
  document.querySelector('meta[name="theme-color"]').content = isDark() ? '#0A1522' : '#0F2A44';
}

themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  root.dataset.theme = next;
  store.set('bosla-theme', next);
  updateThemeLabel();
});

// ---------- شريط التقدم ----------
function updateProgress(m) {
  if (m.progress) {
    progress.hidden = false;
    progress.querySelector('.progress-fill').style.width = `${(m.progress / 5) * 100}%`;
    progress.querySelector('.progress-text').textContent = ui().progress(m.progress);
  } else if (['results', 'tiebreak', 'resolved', 'welcome'].includes(m.tag)) {
    progress.hidden = true;
  }
}

/** تعطيل أزرار الرسائل السابقة حتى لا تُستخدم بعد تقدّم المحادثة */
function freezeOld() {
  chat.querySelectorAll('.msg.bot.live').forEach(m => {
    m.classList.remove('live');
    m.querySelectorAll('.quick button, .rating-row button').forEach(b => { b.disabled = true; });
  });
}

function addUser(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  el.append(b);
  chat.append(el);
  scrollDown();
}

function renderRatings(el, ratings) {
  const box = document.createElement('div');
  box.className = 'ratings';
  const chosen = {};
  for (const r of ratings) {
    const row = document.createElement('div');
    row.className = 'rating-row';
    row.dataset.crit = r.crit;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = r.label;
    const opts = document.createElement('div');
    opts.className = 'opts';
    opts.setAttribute('role', 'group');
    opts.setAttribute('aria-label', r.label);
    for (let v = 1; v <= 5; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v;
      b.dataset.v = v;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (busy) return;
        chosen[r.crit] = v;
        opts.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        if (Object.keys(chosen).length === ratings.length) {
          const shown = ratings.map(x => `${x.label}: ${chosen[x.crit]}`).join(STRINGS[lang].list);
          send({ action: 'rate', payload: { ...chosen } }, shown);
        }
      });
      opts.append(b);
    }
    row.append(label, opts);
    box.append(row);
  }
  const hint = document.createElement('p');
  hint.className = 'rating-hint';
  hint.textContent = ui().ratingHint;
  box.append(hint);
  el.append(box);
}

function renderButtons(el, buttons) {
  const box = document.createElement('div');
  box.className = 'quick';
  for (const btn of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = btn.label;
    b.dataset.action = btn.action;
    b.addEventListener('click', () => {
      if (busy) return;
      if (btn.append) {
        // اقتراحات المهارات: تُضاف إلى حقل الكتابة ليرسلها الطالب مجتمعة
        b.classList.toggle('selected');
        input.value = [...box.querySelectorAll('button.selected')].map(x => x.textContent).join(STRINGS[lang].list);
        input.focus();
        return;
      }
      send({ action: btn.action }, btn.label);
    });
    box.append(b);
  }
  el.append(box);
}

/** زر نسخ ملخص النتيجة (يستخدم مشاركة الجوال إن توفرت) */
function renderCopy(bubble) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'copy';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg><span></span>';
  const label = b.querySelector('span');
  label.textContent = ui().copy;
  const summary = bot.summary();
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = summary;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* تجاهل */ }
      ta.remove();
    }
    b.classList.add('done');
    label.textContent = ui().copied;
    setTimeout(() => { b.classList.remove('done'); label.textContent = ui().copy; }, 2000);
  });
  bubble.append(b);
}

async function addBot(m) {
  const typing = document.createElement('div');
  typing.className = 'msg bot typing';
  typing.innerHTML = `<div class="bubble"><span class="dots"><i></i><i></i><i></i></span> ${ui().typing}</div>`;
  chat.append(typing);
  scrollDown();
  await sleep(TYPING_MS);
  typing.remove();

  const el = document.createElement('div');
  el.className = 'msg bot live';
  el.dataset.tag = m.tag;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = m.html; // HTML مبني في bot.js مع تهريب كل النصوص
  if (m.ratings && m.ratings.length) renderRatings(bubble, m.ratings);
  if (m.share) renderCopy(bubble);
  el.append(bubble);
  if (m.buttons && m.buttons.length) renderButtons(el, m.buttons);
  chat.append(el);
  updateProgress(m);
  scrollDown();
}

async function show(messages) {
  setBusy(true);
  freezeOld();
  for (const m of messages) await addBot(m);
  setBusy(false);
}

async function send(inp, label) {
  if (busy) return;
  addUser(label ?? inp.text);
  await show(bot.handle(inp));
}

function restart() {
  chat.innerHTML = '';
  input.value = '';
  progress.hidden = true;
  bot = createBot(data, { lang });
  return show(bot.start());
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  send({ text });
});

document.getElementById('new-chat').addEventListener('click', () => { if (!busy) restart(); });

// تبديل اللغة يبدأ محادثة جديدة باللغة المختارة
langBtn.addEventListener('click', () => {
  if (busy) return;
  lang = lang === 'ar' ? 'en' : 'ar';
  store.set('bosla-lang', lang);
  applyLang();
  restart();
});

applyLang();
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeLabel);

try {
  data = await loadData(f => fetch(f).then(r => {
    if (!r.ok) throw new Error(f);
    return r.json();
  }));
  await restart();
  document.body.dataset.ready = '1';
} catch (err) {
  chat.innerHTML = `<div class="msg bot"><div class="bubble"><p>${ui().loadError}</p></div></div>`;
  console.error(err);
}

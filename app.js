// واجهة المحادثة: تعرض رسائل الوكيل وأزرارها، وترسل مدخلات الطالب إلى آلة الحالات (bot.js).
import { createBot, loadData } from './bot.js';

const params = new URLSearchParams(location.search);
const TYPING_MS = params.has('delay') ? Number(params.get('delay')) : 550;

const chat = document.getElementById('chat');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
let bot;
let busy = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const scrollDown = () => { chat.scrollTop = chat.scrollHeight; };

function setBusy(v) {
  busy = v;
  document.body.dataset.busy = v ? '1' : '0';
  sendBtn.disabled = v;
}

/** تعطيل أزرار الرسائل السابقة حتى لا تُستخدم بعد تقدّم المحادثة */
function freezeOld() {
  chat.querySelectorAll('.msg.bot.live').forEach(m => {
    m.classList.remove('live');
    m.querySelectorAll('button').forEach(b => { b.disabled = true; });
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
          const shown = ratings.map(x => `${x.label}: ${chosen[x.crit]}`).join('، ');
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
  hint.textContent = 'اختر درجة لكل معيار، أو اكتب إجابتك بأسلوبك.';
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
        const picked = [...box.querySelectorAll('button.selected')].map(x => x.textContent);
        input.value = picked.join('، ');
        input.focus();
        return;
      }
      send({ action: btn.action }, btn.label);
    });
    box.append(b);
  }
  el.append(box);
}

async function addBot(m) {
  const typing = document.createElement('div');
  typing.className = 'msg bot typing';
  typing.innerHTML = '<div class="bubble"><span class="dots"><i></i><i></i><i></i></span> يكتب…</div>';
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
  el.append(bubble);
  if (m.buttons && m.buttons.length) renderButtons(el, m.buttons);
  chat.append(el);
  scrollDown();
}

async function show(messages) {
  setBusy(true);
  freezeOld();
  for (const m of messages) await addBot(m);
  setBusy(false);
}

async function send(input, label) {
  if (busy) return;
  addUser(label ?? input.text);
  await show(bot.handle(input));
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  send({ text });
});

document.getElementById('new-chat').addEventListener('click', () => {
  if (busy) return;
  chat.innerHTML = '';
  input.value = '';
  bot = createBot(data);
  show(bot.start());
});

let data;
try {
  data = await loadData(f => fetch(f).then(r => {
    if (!r.ok) throw new Error(f);
    return r.json();
  }));
  bot = createBot(data);
  await show(bot.start());
  document.body.dataset.ready = '1';
} catch (err) {
  chat.innerHTML = '<div class="msg bot"><div class="bubble"><p>تعذّر تحميل قاعدة المعرفة. حدّث الصفحة من فضلك.</p></div></div>';
  console.error(err);
}

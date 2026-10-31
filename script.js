/* =========================================================
   Домашняя библиотека — script.js
   Пиксельный редактор заметок: полки-темы, книги-заметки,
   разворот с листанием, подпись «как в Minecraft»,
   localStorage + автосохранение + импорт/экспорт.
   Без зависимостей и сборки — просто подключён в index.html.
   ========================================================= */
'use strict';

/* ================== 1. Константы ================== */

const STORAGE_KEY   = 'pixel-library-v1'; // ключ localStorage всей библиотеки
const AUTHOR_KEY    = 'pixel-library-author'; // запоминаем последнего автора
const AUTOSAVE_MS   = 500;   // задержка автосохранения (debounce)
const FLIP_MS       = 430;   // длительность перелистывания страницы
const OPEN_MS       = 800;   // длительность раскрытия/закрытия книги
const PULL_MS       = 200;   // задержка «снятия книги с полки»

// Палитра переплётов (приглушённые «кожаные» цвета)
const PALETTE = [
  '#8a5a3b', // коричневая кожа
  '#9c3b30', // вишня
  '#37715a', // изумруд
  '#3a5a8c', // лазурит
  '#6b4a96', // аметист
  '#b0842f', // золото
  '#2f7d8c', // бирюза
  '#7a3350', // вино
  '#4c4c56', // графит
  '#6d7a3a', // олива
  '#b05f3a', // терракота
  '#2f3b5c', // полночь
];

// Уважаем настройку «уменьшить анимации»
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================== 2. Утилиты ================== */

const $ = (sel) => document.querySelector(sel);

// Короткий уникальный id
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Классический debounce
function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

// Экранирование HTML (защита от вставки разметки из текста заметок)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function randColor() { return PALETTE[Math.floor(Math.random() * PALETTE.length)]; }

// Простой хеш строки (для детерминированной высоты корешков)
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Русские формы множественного числа: plural(5, ['книга','книги','книг'])
function plural(n, forms) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

// Скачивание файла (Blob + временная ссылка)
function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Безопасное имя файла из заглавия
function safeFileName(name, fallback = 'book') {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 60);
}

/* ================== 3. Состояние приложения ================== */

// Вся библиотека: { version, shelves:[{id,name}], books:[{...}] }
let library = { version: 1, shelves: [], books: [] };

// Переходящее состояние интерфейса (не сохраняется)
const ui = {
  currentBookId: null,  // открытая книга
  mode: 'read',         // 'read' | 'edit'
  contentPages: [],     // страницы текста после пагинации (массив строк)
  totalPages: 0,        // всего страниц в развороте (+1 титул у подписанной)
  spreadCount: 1,       // количество разворотов
  spreadIndex: 0,       // текущий разворот
  flipping: false,      // идёт анимация перелистывания
  closing: false,       // книга закрывается (блокируем повторные вызовы)
  pulledSpine: null,    // элемент корешка, который «сняли» с полки
  query: '',            // строка поиска
  shelfFilter: null,    // фильтр по полке (id) или null = все
};

let saveTimer = null;   // таймер автосохранения
let lastSavedAt = null; // для строки статистики

/* ================== 4. Кэш DOM-элементов ================== */

const els = {};
function cacheDom() {
  Object.assign(els, {
    shelves: $('#shelves'),
    chips: $('#filter-chips'),
    search: $('#search'),
    stats: $('#stats'),
    dust: $('#dust'),
    // оверлей книги
    overlay: $('#book-overlay'),
    book: $('#book'),
    cover: $('#cover'),
    coverTitle: $('#cover-title'),
    coverAuthor: $('#cover-author'),
    pageLeft: $('#page-left'),
    pageRight: $('#page-right'),
    flipSheet: $('#flip-sheet'),
    flipFront: $('#flip-front'),
    flipBack: $('#flip-back'),
    measure: $('#page-measure'),
    // панель книги
    btnRead: $('#btn-mode-read'),
    btnEdit: $('#btn-mode-edit'),
    tbNav: $('#tb-nav'),
    btnPrev: $('#btn-prev'),
    btnNext: $('#btn-next'),
    pageLabel: $('#page-label'),
    btnSign: $('#btn-sign'),
    btnUnsign: $('#btn-unsign'),
    btnMd: $('#btn-md'),
    btnDel: $('#btn-del'),
    btnDone: $('#btn-done'),
    // лист редактирования
    editSheet: $('#edit-sheet'),
    edTitle: $('#ed-title'),
    edAuthor: $('#ed-author'),
    edShelf: $('#ed-shelf'),
    edSwatches: $('#ed-swatches'),
    edText: $('#ed-text'),
    edStatus: $('#ed-status'),
    edPages: $('#ed-pages'),
    // модалка подписи
    signModal: $('#sign-modal'),
    signPreview: $('#sign-book-preview'),
    signTitle: $('#sign-title'),
    signAuthor: $('#sign-author'),
    signOk: $('#sign-ok'),
    signCancel: $('#sign-cancel'),
    // подтверждение
    cfModal: $('#confirm-modal'),
    cfTitle: $('#cf-title'),
    cfText: $('#cf-text'),
    cfOk: $('#cf-ok'),
    cfCancel: $('#cf-cancel'),
    // ввод строки
    prModal: $('#prompt-modal'),
    prTitle: $('#pr-title'),
    prLabel: $('#pr-label'),
    prInput: $('#pr-input'),
    prOk: $('#pr-ok'),
    prCancel: $('#pr-cancel'),
    // прочее
    toast: $('#toast'),
    fileImport: $('#file-import'),
  });
}

/* ================== 5. Хранилище (localStorage) ================== */

function saveLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    lastSavedAt = Date.now();
    updateStats();
  } catch (e) {
    // Переполнение квоты и т.п.
    toast('⚠ Не удалось сохранить: ' + (e.name === 'QuotaExceededError' ? 'хранилище переполнено' : e.message));
  }
}

// Автосохранение с debounce ~500 мс
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveLibrary();
    setSaveState('saved');
    renderLibrary(); // обновить корешки (толщина/название) за оверлеем
    if (ui.mode === 'edit') updateEstimate();
  }, AUTOSAVE_MS);
}

// Немедленное сохранение (Ctrl+S, закрытие книги, уход со страницы)
function flushSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveLibrary();
    setSaveState('saved');
    renderLibrary();
  }
}

// Проверка и нормализация данных библиотеки (защита от битого JSON)
function sanitizeLibrary(data) {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.shelves) || !Array.isArray(data.books)) return null;

  let shelves = data.shelves
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ id: String(s.id || uid()), name: String(s.name || 'Полка').slice(0, 40) }));
  if (!shelves.length) shelves = [{ id: uid(), name: 'Разное' }];

  const ids = new Set(shelves.map((s) => s.id));
  const books = data.books
    .filter((b) => b && typeof b === 'object')
    .map((b) => ({
      id: String(b.id || uid()),
      title: String(b.title ?? '').slice(0, 64),
      author: String(b.author ?? '').slice(0, 48),
      shelfId: ids.has(String(b.shelfId)) ? String(b.shelfId) : shelves[0].id,
      color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : randColor(),
      text: String(b.text ?? ''),
      signed: !!b.signed,
      signedAt: b.signedAt ? +b.signedAt : null,
      createdAt: +b.createdAt || Date.now(),
      updatedAt: +b.updatedAt || Date.now(),
    }));

  return { version: 1, shelves, books };
}

// Загрузка; возвращает true, если данные были
function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = sanitizeLibrary(JSON.parse(raw));
    if (!parsed) return false;
    library = parsed;
    return true;
  } catch {
    return false;
  }
}

function getBook(id) { return library.books.find((b) => b.id === id) || null; }
function getShelf(id) { return library.shelves.find((s) => s.id === id) || null; }
function currentBook() { return ui.currentBookId ? getBook(ui.currentBookId) : null; }

/* ================== 6. Демо-данные при первом запуске ================== */

function seedLibrary() {
  const now = Date.now();
  const sh = (name) => ({ id: uid(), name });
  const shelfNotes = sh('Заметки');
  const shelfIdeas = sh('Идеи');
  const shelfQuotes = sh('Цитаты');

  const mk = (title, author, shelf, color, text, extra = {}) => ({
    id: uid(), title, author, shelfId: shelf.id, color, text,
    signed: false, signedAt: null, createdAt: now, updatedAt: now, ...extra,
  });

  return {
    version: 1,
    shelves: [shelfNotes, shelfIdeas, shelfQuotes],
    books: [
      mk('Добро пожаловать!', 'Библиотекарь', shelfNotes, '#8a5a3b',
`# Добро пожаловать в библиотеку!

Это не просто редактор заметок, а **уютная домашняя библиотека**: каждая заметка — книга на полке, а полка — тема.

## Как это работает
- Клик по корешку — книга *снимается с полки* и раскрывается.
- Пишете текст одним полем со скроллом, а в режиме «Читать» он сам разбивается на страницы разворота.
- Толщина корешка зависит от объёма текста: толстые книги — важные мысли!

## Мини-разметка
Поддерживаются **жирный**, *курсив*, \`код\`, ~~зачёркнутый~~, списки, заголовки, > цитаты, --- разделители и [ссылки](https://example.com).

## Подпись
Кнопка «Подписать» превращает черновик в настоящую книгу: появляется титульная страница, а редактирование блокируется — совсем как written book в Minecraft. Подпись можно снять отдельным подтверждением.

---

Всё хранится локально в браузере (localStorage). Не забудьте сделать «⬇ JSON» — это резервная копия всей библиотеки.`),

      mk('Горячие клавиши', '', shelfNotes, '#3a5a8c',
`# Горячие клавиши

- \`Esc\` — закрыть книгу или окно
- \`←\` / \`→\` — листать страницы разворота
- \`Ctrl+S\` — сохранить немедленно

Автосохранение срабатывает само через 0.5 секунды после паузы в наборе текста.

> Совет: в режиме «Читать» стрелки работают, даже если курсор не в поле ввода.`),

      mk('Идеи для проектов', '', shelfIdeas, '#37715a',
`# Идеи для проектов

## Скоро
- Пиксельный сад на подоконнике (тамагочи для растений)
- Генератор меню на неделю в виде свитка
- Трекер привычек «цепочка факелов»

## Потом
- Каталог домашних растений с фото
- Карта путешествий по комнатам квартиры

## Совсем потом
- Собственный шрифт с засечками
- Игра-бродилка по этой библиотеке`),

      mk('Легенда о библиотеке', 'Библиотекарь', shelfQuotes, '#7a3350',
`Говорят, если поставить на полку достаточно книг, в комнате однажды запахнет старым пергаментом и тёплым светом лампы.

Эта книга подписана, поэтому её нельзя редактировать — как и подобает настоящей библиотеке: написанное пером хранится бережно.

Подпись можно снять, но только с явным подтверждением.`,
        { signed: true, signedAt: now - 86400000 }),

      mk('Любимые цитаты', '', shelfQuotes, '#b0842f',
`# Любимые цитаты

> Дом, в котором есть книги, уже не пуст.

> Заметка, записанная сегодня, — это мысль, спасённая от забвения.

> Каждая полка — это отдельная вселенная, а корешки — её созвездия.

---

Дополняйте коллекцию: создайте книгу кнопкой «＋» на любой полке.`),
    ],
  };
}

/* ================== 7. Мини-разметка (markdown-lite) ================== */

// Инлайн: жирный, курсив, код, зачёркивание, ссылки.
// Сначала экранируем HTML, затем применяем правила к безопасному тексту.
function renderInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Ссылки: только http(s)/mailto — никакой javascript:
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

// Одна строка текста -> один блок <div class="ln ...">.
// Именно блоки измеряются при пагинации (высота блока = высота строки).
function renderLine(line) {
  const t = line.replace(/\s+$/, '');
  let m;
  if (!t.trim()) return '<div class="ln empty">&nbsp;</div>';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t.trim())) return '<div class="ln hr"><span></span></div>';
  if ((m = t.match(/^(#{1,3})\s+(.*)$/))) return `<div class="ln h${m[1].length}">${renderInline(m[2])}</div>`;
  if ((m = t.match(/^\s*>\s?(.*)$/))) return `<div class="ln quote">${renderInline(m[1])}</div>`;
  if ((m = t.match(/^\s*[-*+]\s+(.*)$/))) return `<div class="ln li"><span class="bullet">•</span><span>${renderInline(m[1])}</span></div>`;
  if ((m = t.match(/^\s*(\d+)[.)]\s+(.*)$/))) return `<div class="ln li num"><span class="bullet">${m[1]}.</span><span>${renderInline(m[2])}</span></div>`;
  return `<div class="ln">${renderInline(t)}</div>`;
}

// Текст страницы -> HTML
function renderPage(text) {
  return String(text || '').split('\n').map(renderLine).join('');
}

// Титульная страница подписанной книги
function titlePageHtml(book) {
  return `<div class="title-page">
    <div class="tp-orn">✦ ❦ ✦</div>
    <div class="tp-title">${escapeHtml(book.title || 'Без названия')}</div>
    <div class="tp-line"></div>
    <div class="tp-author">Автор: ${escapeHtml(book.author || 'неизвестен')}</div>
    <div class="tp-date">Подписана ${escapeHtml(formatDate(book.signedAt))}</div>
    <div class="tp-orn">❦</div>
  </div>`;
}

/* ================== 8. Пагинация (разбивка текста на страницы) ==================
   Текст разбивается по строкам-блокам. Каждый блок рендерится в скрытый
   «измеритель» с той же шириной и типографикой, что и страница, и его
   реальная высота складывается в текущую страницу. Как только блоки
   перестают помещаться — начинается новая страница.                      */

function paginate(text) {
  const measure = els.measure;
  const contentLeft = els.pageLeft; // любой .page-half подойдёт как образец
  // Поля страницы берём из CSS-переменных — они меняются в медиазапросах
  const cs = getComputedStyle(document.documentElement);
  const padX = parseFloat(cs.getPropertyValue('--pad-x')) || 34;
  const padTop = parseFloat(cs.getPropertyValue('--pad-top')) || 30;
  const padBottom = parseFloat(cs.getPropertyValue('--pad-bottom')) || 46;
  const contentW = contentLeft.clientWidth - padX * 2;
  const contentH = contentLeft.clientHeight - padTop - padBottom;
  if (contentW <= 0 || contentH <= 0) return [String(text || '')]; // оверлей скрыт — не делим

  measure.style.width = contentW + 'px';

  const lines = String(text || '').split('\n');
  const pages = [];
  let cur = [];
  let h = 0;

  for (const line of lines) {
    measure.innerHTML = renderLine(line);
    const block = measure.firstElementChild;
    const bh = block ? block.offsetHeight : 0;
    // Блок не помещается на текущую страницу — начинаем новую
    if (h + bh > contentH && cur.length) {
      pages.push(cur.join('\n'));
      cur = []; h = 0;
    }
    cur.push(line);
    h += bh;
  }
  if (cur.length || !pages.length) pages.push(cur.join('\n'));
  return pages;
}

// Пересчитать страницы текущей книги и границы разворотов
function refreshPages() {
  const book = currentBook();
  if (!book) return;
  ui.contentPages = paginate(book.text || '');
  // У подписанной книги первая страница — титульная
  ui.totalPages = ui.contentPages.length + (book.signed ? 1 : 0);
  ui.spreadCount = Math.max(1, Math.ceil(ui.totalPages / 2));
  ui.spreadIndex = clamp(ui.spreadIndex, 0, ui.spreadCount - 1);
}

/* ================== 9. Разворот книги (режим чтения) ================== */

// HTML «внутренности» одной страницы разворота (контент + номер)
function pageInner(i) {
  const book = currentBook();
  if (!book) return '';
  const contentIdx = book.signed ? i - 1 : i;
  if (contentIdx < 0) {
    // Титульная страница подписанной книги
    return `<div class="page-content">${titlePageHtml(book)}</div><div class="page-foot">· ${i + 1} ·</div>`;
  }
  const text = ui.contentPages[contentIdx];
  if (text === undefined) {
    // Пустая страница (например, правая половина последнего нечётного разворота)
    return '<div class="page-content blank"><span class="blank-orn">❧</span></div>';
  }
  return `<div class="page-content">${renderPage(text)}</div><div class="page-foot">· ${i + 1} ·</div>`;
}

// Нарисовать текущий разворот (без анимации)
function paintSpread() {
  const li = ui.spreadIndex * 2;
  const ri = li + 1;
  els.pageLeft.innerHTML = pageInner(li);
  els.pageRight.innerHTML = pageInner(ri);

  // Метка «Страница X из Y» / «Страница X–Y из N»
  const l = li + 1;
  const r = Math.min(ri + 1, ui.totalPages);
  els.pageLabel.textContent = (l === r || r < l)
    ? `Страница ${l} из ${ui.totalPages}`
    : `Страница ${l}–${r} из ${ui.totalPages}`;

  els.btnPrev.disabled = ui.spreadIndex <= 0;
  els.btnNext.disabled = ui.spreadIndex >= ui.spreadCount - 1;
}

// Переход к развороту i с анимацией перелистывания (dir: 1 вперёд, -1 назад)
function gotoSpread(i, dir) {
  if (ui.flipping) return;
  i = clamp(i, 0, ui.spreadCount - 1);
  if (i === ui.spreadIndex) return;

  // Запоминаем, что видно сейчас (для «передней стороны» летящего листа)
  const oldLeft = els.pageLeft.innerHTML;
  const oldRight = els.pageRight.innerHTML;

  ui.spreadIndex = i;
  paintSpread(); // под листом уже новый разворот

  if (dir && !reduceMotion) {
    ui.flipping = true;
    const sheet = els.flipSheet;
    // Вперёд: лист лежит на правой половине и вращается вокруг левого края.
    // Назад: лист на левой половине, вращается вокруг правого края.
    sheet.style.left = dir === 1 ? 'var(--half-w)' : '0';
    sheet.style.transformOrigin = dir === 1 ? 'left center' : 'right center';
    els.flipFront.innerHTML = dir === 1 ? oldRight : oldLeft;
    els.flipBack.innerHTML = dir === 1 ? els.pageLeft.innerHTML : els.pageRight.innerHTML;
    sheet.hidden = false;

    const anim = sheet.animate(
      [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${dir === 1 ? -180 : 180}deg)` }],
      { duration: FLIP_MS, easing: 'cubic-bezier(.45,.05,.25,1)' }
    );
    const done = () => { sheet.hidden = true; sheet.style.transform = ''; ui.flipping = false; };
    anim.onfinish = done;
    setTimeout(done, FLIP_MS + 120); // страховка, если onfinish не сработал
  }
}

/* ================== 10. Обложка и режимы книги ================== */

function fillCover(book) {
  els.book.style.setProperty('--cover-c', book.color);
  els.coverTitle.textContent = book.title || 'Без названия';
  els.coverAuthor.textContent = book.author ? '· ' + book.author + ' ·' : '';
}

// Переключение «Читать» / «Править»
function setMode(mode) {
  const book = currentBook();
  if (!book) return;
  if (book.signed && mode === 'edit') mode = 'read'; // подписанная — только чтение
  ui.mode = mode;

  els.book.classList.toggle('mode-edit', mode === 'edit');
  els.btnRead.classList.toggle('active', mode === 'read');
  els.btnEdit.classList.toggle('active', mode === 'edit');
  els.tbNav.hidden = mode !== 'read';

  // Видимость кнопок зависит от подписи
  els.btnEdit.hidden = book.signed;
  els.btnSign.hidden = book.signed;
  els.btnUnsign.hidden = !book.signed;

  if (mode === 'read') {
    // Убрать фокус из полей правки, чтобы стрелки ←/→ листали страницы
    if (document.activeElement && els.editSheet.contains(document.activeElement)) document.activeElement.blur();
    refreshPages();
    paintSpread();
  } else {
    fillEditFields(book);
    setSaveState('saved');
    updateEstimate();
    // Фокус в поле ввода чуть позже, чтобы не конфликтовать с анимацией
    setTimeout(() => { if (ui.mode === 'edit' && !els.overlay.hidden) els.edText.focus(); }, reduceMotion ? 50 : 700);
  }
}

function fillEditFields(book) {
  els.edTitle.value = book.title || '';
  els.edAuthor.value = book.author || '';
  els.edText.value = book.text || '';
  // Выпадающий список полок
  els.edShelf.innerHTML = library.shelves
    .map((s) => `<option value="${s.id}" ${s.id === book.shelfId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
    .join('');
  updateSwatchActive();
}

// Палитра цветов переплёта (строится один раз)
function buildSwatches() {
  els.edSwatches.innerHTML = PALETTE
    .map((c) => `<button class="sw" data-c="${c}" style="--c:${c}" title="Цвет переплёта" aria-label="Цвет ${c}"></button>`)
    .join('');
}
function updateSwatchActive() {
  const book = currentBook();
  els.edSwatches.querySelectorAll('.sw').forEach((b) => {
    b.classList.toggle('active', !!book && b.dataset.c === book.color);
  });
}

// Индикатор автосохранения в листе редактирования
function setSaveState(state) {
  if (state === 'typing') {
    els.edStatus.textContent = '● Печатаю…';
    els.edStatus.classList.add('typing');
  } else {
    els.edStatus.textContent = '✓ Сохранено';
    els.edStatus.classList.remove('typing');
  }
}

// «≈ N стр.» — оценка количества страниц превью
function updateEstimate() {
  const book = currentBook();
  if (!book) return;
  const n = paginate(book.text || '').length;
  els.edPages.textContent = `≈ ${n} ${plural(n, ['страница', 'страницы', 'страниц'])} в превью`;
}

/* ================== 11. Открытие / закрытие книги ================== */

function openBook(id) {
  const book = getBook(id);
  if (!book) return;
  ui.currentBookId = id;
  ui.spreadIndex = 0;
  ui.closing = false;

  fillCover(book);
  els.overlay.hidden = false;
  requestAnimationFrame(() => els.overlay.classList.add('show'));

  // Старт из закрытого состояния -> раскрытие на следующем кадре
  els.book.classList.remove('opened');
  requestAnimationFrame(() => {
    setTimeout(() => els.book.classList.add('opened'), reduceMotion ? 20 : 60);
  });

  setMode(book.signed ? 'read' : 'edit');
}

function closeBook() {
  if (ui.closing || !ui.currentBookId) return;
  ui.closing = true;
  flushSave(); // сохранить несохранённое перед закрытием

  els.book.classList.remove('opened', 'mode-edit');
  els.overlay.classList.remove('show');
  els.flipSheet.hidden = true;
  ui.flipping = false;

  setTimeout(() => {
    els.overlay.hidden = true;
    ui.currentBookId = null;
    ui.closing = false;
    // Вернуть «снятый» корешок на полку и перерисовать зал
    document.querySelectorAll('.spine.pulled').forEach((el) => el.classList.remove('pulled'));
    ui.pulledSpine = null;
    renderLibrary();
  }, reduceMotion ? 30 : OPEN_MS);
}

// Клик по корешку: сначала «тянем» книгу с полки, потом раскрываем
function pullAndOpen(id, spineEl) {
  if (spineEl) {
    spineEl.classList.add('pulled');
    ui.pulledSpine = spineEl;
  }
  setTimeout(() => openBook(id), reduceMotion ? 0 : PULL_MS);
}

/* ================== 12. Рендер зала библиотеки ================== */

// Толщина корешка зависит от объёма текста
function spineWidth(book) {
  const chars = (book.text || '').length;
  return Math.round(clamp(18 + chars / 120, 18, 64));
}
// Высота слегка «гуляет» от id — полка выглядит живой
function spineHeight(book) { return 140 + (hashCode(book.id) % 4) * 7; }

function spineHtml(book, searching) {
  const title = book.title || 'Без названия';
  const hit = searching && ui.query && (
    title.toLowerCase().includes(ui.query) ||
    (book.text || '').toLowerCase().includes(ui.query) ||
    (book.author || '').toLowerCase().includes(ui.query)
  );
  const tip = `«${title}»${book.author ? ' — ' + book.author : ''}\n` +
    `${(book.text || '').length} симв. · обновлено ${formatDate(book.updatedAt)}` +
    `${book.signed ? '\n✒ подписана' : ''}`;
  return `<button class="spine ${book.signed ? 'signed' : ''} ${hit ? 'hit' : ''}"
      data-id="${book.id}"
      style="--c:${book.color};--w:${spineWidth(book)}px;--h:${spineHeight(book)}px"
      title="${escapeHtml(tip)}">
    <span class="sp-title">${escapeHtml(title)}</span>
    ${book.signed ? '<span class="seal" title="Подписана">✒</span>' : ''}
  </button>`;
}

function slotHtml(shelfId) {
  return `<button class="slot-add" data-shelf="${shelfId}" title="Новая книга на этой полке" aria-label="Новая книга">＋</button>`;
}

// Раскладка книг полки по рядам с учётом реальной ширины корешков
function layoutRows(books, rowW, shelfId) {
  const rows = [];
  let cur = [], curW = 0;
  const gap = 6;
  const push = (html, w) => {
    if (cur.length && curW + w + gap > rowW) { rows.push(cur); cur = []; curW = 0; }
    cur.push(html); curW += w + gap;
  };
  for (const b of books) push(spineHtml(b, !!ui.query.trim()), spineWidth(b));
  push(slotHtml(shelfId), 46); // пустой слот «+» всегда в конце
  if (cur.length) rows.push(cur);
  return rows;
}

function buildShelf(shelf, books) {
  const sec = document.createElement('section');
  sec.className = 'shelf';
  sec.dataset.id = shelf.id;

  const rowW = Math.max(300, els.shelves.clientWidth - 34);
  const rows = layoutRows(books, rowW, shelf.id);

  sec.innerHTML = `
    <div class="shelf-head">
      <div class="shelf-sign" data-act="rename-shelf" data-shelf="${shelf.id}" title="Двойной клик — переименовать полку">
        <span class="shelf-name">${escapeHtml(shelf.name)}</span>
        <span class="shelf-count">${books.length}</span>
      </div>
      <div class="shelf-actions">
        <button class="icon-btn" data-act="rename-shelf" data-shelf="${shelf.id}" title="Переименовать полку" aria-label="Переименовать полку">✎</button>
        <button class="icon-btn danger" data-act="del-shelf" data-shelf="${shelf.id}" title="Удалить полку" aria-label="Удалить полку">✕</button>
      </div>
    </div>
    <div class="shelf-rows">
      ${rows.map((r) => `<div class="shelf-row"><div class="books">${r.join('')}</div><div class="plank"></div></div>`).join('')}
      ${books.length === 0 && !ui.query ? '<div class="empty-note">Полка пуста — нажмите «＋», чтобы поставить первую книгу</div>' : ''}
      ${books.length === 0 && ui.query ? '<div class="empty-note">Ничего не найдено на этой полке</div>' : ''}
    </div>`;
  return sec;
}

// Главная функция рендера зала: полки, книги, поиск, фильтр
function renderLibrary() {
  const q = ui.query.trim().toLowerCase();
  const wrap = els.shelves;
  wrap.innerHTML = '';

  let shown = 0;
  for (const shelf of library.shelves) {
    if (ui.shelfFilter && ui.shelfFilter !== shelf.id) continue;

    let books = library.books.filter((b) => b.shelfId === shelf.id);
    if (q) {
      books = books.filter((b) =>
        (b.title || '').toLowerCase().includes(q) ||
        (b.text || '').toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q));
      // При глобальном поиске прячем полки без совпадений
      if (!books.length && !ui.shelfFilter) continue;
    }
    shown += books.length;
    wrap.appendChild(buildShelf(shelf, books));
  }

  if (!wrap.children.length) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = q
      ? `🔍 По запросу «${escapeHtml(ui.query.trim())}» ничего не найдено`
      : '📚 Библиотека пуста.<br>Создайте полку и поставьте первую книгу!';
    wrap.appendChild(div);
  }
  updateStats(shown, q);
}

function updateStats(shown, q) {
  const n = library.books.length;
  const saved = lastSavedAt ? ` · сохранено ${new Date(lastSavedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '';
  els.stats.textContent = q !== undefined && q
    ? `найдено ${shown} из ${n} ${plural(n, ['книги', 'книг', 'книг'])} · ${library.shelves.length} ${plural(library.shelves.length, ['полка', 'полки', 'полок'])}${saved}`
    : `${n} ${plural(n, ['книга', 'книги', 'книг'])} · ${library.shelves.length} ${plural(library.shelves.length, ['полка', 'полки', 'полок'])}${saved}`;
}

// Чипы-теги для фильтра по полкам
function renderChips() {
  els.chips.innerHTML =
    `<button class="chip ${!ui.shelfFilter ? 'active' : ''}" data-shelf="">🏛 Все</button>` +
    library.shelves.map((s) => {
      const count = library.books.filter((b) => b.shelfId === s.id).length;
      return `<button class="chip ${ui.shelfFilter === s.id ? 'active' : ''}" data-shelf="${s.id}">🏷 ${escapeHtml(s.name)} (${count})</button>`;
    }).join('');
}

/* ================== 13. Операции над книгами и полками ================== */

function createBook(shelfId, open = true) {
  const shelf = getShelf(shelfId) || library.shelves[0];
  if (!shelf) { toast('Сначала создайте полку'); return null; }
  const now = Date.now();
  const book = {
    id: uid(), title: '', author: localStorage.getItem(AUTHOR_KEY) || '',
    shelfId: shelf.id, color: randColor(), text: '',
    signed: false, signedAt: null, createdAt: now, updatedAt: now,
  };
  library.books.push(book);
  saveLibrary();
  renderChips();
  renderLibrary();
  if (open) {
    const el = document.querySelector(`.spine[data-id="${book.id}"]`);
    pullAndOpen(book.id, el);
  }
  return book;
}

function deleteBook(id) {
  const book = getBook(id);
  if (!book) return;
  askConfirm({
    title: 'Удалить книгу?',
    text: `«${book.title || 'Без названия'}» будет удалена безвозвратно. Совет: сначала сделайте экспорт в .md или JSON.`,
    ok: '🗑 Удалить', danger: true,
    onOk: () => {
      library.books = library.books.filter((b) => b.id !== id);
      saveLibrary();
      if (ui.currentBookId === id) { ui.currentBookId = null; closeBookQuiet(); }
      renderChips(); renderLibrary();
      toast('Книга удалена');
    },
  });
}

// Быстрое закрытие оверлея (когда книга удалена — смотреть не на что)
function closeBookQuiet() {
  els.book.classList.remove('opened', 'mode-edit');
  els.overlay.classList.remove('show');
  setTimeout(() => { els.overlay.hidden = true; ui.closing = false; }, reduceMotion ? 10 : 300);
}

/* --- Подпись книги (как в Minecraft) --- */
function openSignModal() {
  const book = currentBook();
  if (!book || book.signed) return;
  els.signTitle.value = book.title || '';
  els.signAuthor.value = book.author || localStorage.getItem(AUTHOR_KEY) || '';
  els.signPreview.style.setProperty('--cover-c', book.color);
  showModal(els.signModal);
  setTimeout(() => els.signTitle.focus(), 60);
}

function doSign() {
  const book = currentBook();
  if (!book) return;
  // Переносим поля из модалки в книгу
  book.title = els.signTitle.value.trim() || 'Без названия';
  book.author = els.signAuthor.value.trim();
  book.signed = true;
  book.signedAt = Date.now();
  book.updatedAt = Date.now();
  if (book.author) localStorage.setItem(AUTHOR_KEY, book.author);
  hideModal(els.signModal);
  saveLibrary();
  renderChips(); renderLibrary();
  // Как в Minecraft: после подписания книга закрывается
  closeBook();
  toast('✒ Книга подписана! Теперь она только для чтения.');
}

function unsignBook() {
  const book = currentBook();
  if (!book || !book.signed) return;
  askConfirm({
    title: 'Снять подпись?',
    text: `Книга «${book.title || 'Без названия'}» снова станет редактируемой, а титульная страница исчезнет.`,
    ok: '🔓 Снять подпись', danger: true,
    onOk: () => {
      book.signed = false;
      book.signedAt = null;
      book.updatedAt = Date.now();
      saveLibrary();
      fillCover(book);
      ui.spreadIndex = 0;
      setMode('read');
      renderLibrary();
      toast('Подпись снята — книгу можно редактировать');
    },
  });
}

/* --- Экспорт книги в .md --- */
function exportBookMd() {
  const book = currentBook();
  if (!book) return;
  const shelf = getShelf(book.shelfId);
  const yaml = [
    '---',
    `title: "${(book.title || 'Без названия').replace(/"/g, '\\"')}"`,
    `author: "${(book.author || '').replace(/"/g, '\\"')}"`,
    `shelf: "${(shelf ? shelf.name : '').replace(/"/g, '\\"')}"`,
    `signed: ${book.signed}`,
    `created: ${new Date(book.createdAt).toISOString()}`,
    `updated: ${new Date(book.updatedAt).toISOString()}`,
    '---',
  ].join('\n');
  const body = `# ${book.title || 'Без названия'}\n\n` +
    (book.author ? `*Автор: ${book.author}*\n\n` : '') +
    (book.text || '') + '\n';
  download(safeFileName(book.title, 'book') + '.md', yaml + '\n\n' + body, 'text/markdown;charset=utf-8');
  toast('⬇ Книга сохранена в .md');
}

/* --- Полки --- */
function addShelf() {
  askPrompt({
    title: 'Новая полка', label: 'Название темы', value: '',
    onOk: (name) => {
      name = name.trim();
      if (!name) return;
      library.shelves.push({ id: uid(), name: name.slice(0, 40) });
      saveLibrary(); renderChips(); renderLibrary();
      toast('🏷 Полка добавлена');
    },
  });
}

function renameShelf(id) {
  const shelf = getShelf(id);
  if (!shelf) return;
  askPrompt({
    title: 'Переименовать полку', label: 'Название темы', value: shelf.name,
    onOk: (name) => {
      name = name.trim();
      if (!name) return;
      shelf.name = name.slice(0, 40);
      saveLibrary(); renderChips(); renderLibrary();
      toast('Полка переименована');
    },
  });
}

function deleteShelf(id) {
  const shelf = getShelf(id);
  if (!shelf) return;
  if (library.shelves.length === 1) { toast('Нельзя удалить единственную полку'); return; }
  const booksCount = library.books.filter((b) => b.shelfId === id).length;
  askConfirm({
    title: 'Удалить полку?',
    text: booksCount
      ? `Полка «${shelf.name}» будет удалена, а её книги (${booksCount} шт.) переедут на полку «${library.shelves.find((s) => s.id !== id).name}».`
      : `Полка «${shelf.name}» пуста и будет удалена.`,
    ok: 'Удалить полку', danger: true,
    onOk: () => {
      const target = library.shelves.find((s) => s.id !== id);
      library.books.forEach((b) => { if (b.shelfId === id) b.shelfId = target.id; });
      library.shelves = library.shelves.filter((s) => s.id !== id);
      if (ui.shelfFilter === id) ui.shelfFilter = null;
      saveLibrary(); renderChips(); renderLibrary();
      toast('Полка удалена');
    },
  });
}

/* --- Экспорт/импорт всей библиотеки --- */
function exportLibrary() {
  flushSave();
  const data = { ...library, version: 1, exportedAt: new Date().toISOString(), app: 'pixel-library' };
  const date = new Date().toISOString().slice(0, 10);
  download(`library-${date}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
  toast('⬇ Библиотека экспортирована в JSON');
}

function importLibraryFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed = null;
    try { parsed = JSON.parse(String(reader.result)); } catch { /* остаётся null */ }
    const clean = sanitizeLibrary(parsed);
    if (!clean) { toast('⚠ Это не похоже на файл библиотеки'); return; }
    askConfirm({
      title: 'Импортировать библиотеку?',
      text: `В файле ${clean.shelves.length} ${plural(clean.shelves.length, ['полка', 'полки', 'полок'])} и ${clean.books.length} ${plural(clean.books.length, ['книга', 'книги', 'книг'])}. Текущая библиотека будет ЗАМЕНЕНА. Рекомендуем сначала сделать экспорт.`,
      ok: '⬆ Заменить', danger: true,
      onOk: () => {
        library = clean;
        saveLibrary(); renderChips(); renderLibrary();
        toast('Библиотека импортирована');
      },
    });
  };
  reader.onerror = () => toast('⚠ Не удалось прочитать файл');
  reader.readAsText(file);
}

/* ================== 14. Модальные окна и тост ================== */

function showModal(el) { el.hidden = false; requestAnimationFrame(() => el.classList.add('show')); }
function hideModal(el) {
  el.classList.remove('show');
  setTimeout(() => { el.hidden = true; }, 220);
}
function anyModalOpen() {
  return [els.signModal, els.cfModal, els.prModal].some((m) => !m.hidden && m.classList.contains('show'));
}

// Универсальное подтверждение
function askConfirm({ title, text, ok = 'Да', cancel = 'Отмена', danger = false, onOk }) {
  els.cfTitle.textContent = title;
  els.cfText.textContent = text;
  els.cfOk.textContent = ok;
  els.cfCancel.textContent = cancel;
  els.cfOk.classList.toggle('danger', danger);
  els.cfOk.onclick = () => { hideModal(els.cfModal); onOk && onOk(); };
  els.cfCancel.onclick = () => hideModal(els.cfModal);
  showModal(els.cfModal);
}

// Универсальный ввод строки
function askPrompt({ title, label, value = '', onOk }) {
  els.prTitle.textContent = title;
  els.prLabel.textContent = label;
  els.prInput.value = value;
  els.prOk.onclick = () => { hideModal(els.prModal); onOk(els.prInput.value); };
  els.prCancel.onclick = () => hideModal(els.prModal);
  els.prInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); els.prOk.click(); }
  };
  showModal(els.prModal);
  setTimeout(() => { els.prInput.focus(); els.prInput.select(); }, 60);
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

/* ================== 15. Обработчики событий ================== */

function bindEvents() {
  /* --- Зал: делегирование кликов по полкам и корешкам --- */
  els.shelves.addEventListener('click', (e) => {
    const spine = e.target.closest('.spine');
    if (spine) { pullAndOpen(spine.dataset.id, spine); return; }

    const slot = e.target.closest('.slot-add');
    if (slot) { createBook(slot.dataset.shelf); return; }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'rename-shelf') renameShelf(act.dataset.shelf);
    if (act.dataset.act === 'del-shelf') deleteShelf(act.dataset.shelf);
  });
  // Двойной клик по табличке полки — переименовать
  els.shelves.addEventListener('dblclick', (e) => {
    const sign = e.target.closest('.shelf-sign');
    if (sign) renameShelf(sign.dataset.shelf);
  });

  /* --- Чипы-фильтры --- */
  els.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    ui.shelfFilter = chip.dataset.shelf || null;
    renderChips(); renderLibrary();
  });

  /* --- Поиск (с лёгким debounce) --- */
  const onSearch = debounce(() => { ui.query = els.search.value; renderLibrary(); }, 140);
  els.search.addEventListener('input', onSearch);

  /* --- Верхняя панель --- */
  $('#btn-new-book').addEventListener('click', () => createBook(ui.shelfFilter || (library.shelves[0] || {}).id));
  $('#btn-add-shelf').addEventListener('click', addShelf);
  $('#btn-export-lib').addEventListener('click', exportLibrary);
  $('#btn-import-lib').addEventListener('click', () => els.fileImport.click());
  els.fileImport.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importLibraryFile(f);
    e.target.value = ''; // чтобы можно было выбрать тот же файл снова
  });

  /* --- Оверлей книги --- */
  els.overlay.addEventListener('click', (e) => {
    // Клик по тёмному фону закрывает книгу
    if (e.target === els.overlay || e.target.classList.contains('overlay-backdrop')) closeBook();
  });
  els.btnDone.addEventListener('click', closeBook);
  els.btnRead.addEventListener('click', () => setMode('read'));
  els.btnEdit.addEventListener('click', () => setMode('edit'));
  els.btnPrev.addEventListener('click', () => gotoSpread(ui.spreadIndex - 1, -1));
  els.btnNext.addEventListener('click', () => gotoSpread(ui.spreadIndex + 1, 1));
  els.btnSign.addEventListener('click', openSignModal);
  els.btnUnsign.addEventListener('click', unsignBook);
  els.btnMd.addEventListener('click', exportBookMd);
  els.btnDel.addEventListener('click', () => ui.currentBookId && deleteBook(ui.currentBookId));

  /* --- Модалка подписи --- */
  els.signOk.addEventListener('click', doSign);
  els.signCancel.addEventListener('click', () => hideModal(els.signModal));
  els.signModal.addEventListener('click', (e) => { if (e.target === els.signModal) hideModal(els.signModal); });
  [els.signTitle, els.signAuthor].forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSign(); } });
  });

  /* --- Модалки подтверждения/ввода: клик по фону = отмена --- */
  els.cfModal.addEventListener('click', (e) => { if (e.target === els.cfModal) hideModal(els.cfModal); });
  els.prModal.addEventListener('click', (e) => { if (e.target === els.prModal) hideModal(els.prModal); });

  /* --- Лист редактирования: автосохранение при любом изменении --- */
  const onEdit = () => {
    const book = currentBook();
    if (!book || book.signed || ui.mode !== 'edit') return;
    book.title = els.edTitle.value;
    book.author = els.edAuthor.value;
    book.shelfId = els.edShelf.value || book.shelfId;
    book.text = els.edText.value;
    book.updatedAt = Date.now();
    setSaveState('typing');
    fillCover(book); // обложка обновляется на лету
    scheduleSave();
  };
  [els.edTitle, els.edAuthor, els.edShelf, els.edText].forEach((el) => el.addEventListener('input', onEdit));
  els.edShelf.addEventListener('change', onEdit);

  // Tab в textarea вставляет два пробела (удобно для списков)
  els.edText.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = els.edText.selectionStart, en = els.edText.selectionEnd;
      els.edText.value = els.edText.value.slice(0, s) + '  ' + els.edText.value.slice(en);
      els.edText.selectionStart = els.edText.selectionEnd = s + 2;
      onEdit();
    }
  });

  /* --- Палитра цветов переплёта --- */
  els.edSwatches.addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    const book = currentBook();
    if (!sw || !book || book.signed) return;
    book.color = sw.dataset.c;
    book.updatedAt = Date.now();
    fillCover(book);
    updateSwatchActive();
    scheduleSave();
    renderLibrary();
  });

  /* --- Горячие клавиши --- */
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+S — немедленное сохранение
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const book = currentBook();
      if (book && ui.mode === 'edit' && !book.signed) onEditFromKeyboard();
      flushSave();
      saveLibrary();
      setSaveState('saved');
      toast('💾 Сохранено');
      return;
    }
    // Esc — закрыть верхний слой: модалка -> книга
    if (e.key === 'Escape') {
      if (!els.prModal.hidden) { hideModal(els.prModal); return; }
      if (!els.cfModal.hidden) { hideModal(els.cfModal); return; }
      if (!els.signModal.hidden) { hideModal(els.signModal); return; }
      if (!els.overlay.hidden && ui.currentBookId && !ui.closing) { e.preventDefault(); closeBook(); return; }
      if (document.activeElement === els.search && els.search.value) { els.search.value = ''; ui.query = ''; renderLibrary(); }
      return;
    }
    // ←/→ — листание страниц (только в режиме чтения и без модалок)
    if (!els.overlay.hidden && ui.mode === 'read' && !anyModalOpen() && !ui.flipping) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!inField) {
        if (e.key === 'ArrowRight') { e.preventDefault(); gotoSpread(ui.spreadIndex + 1, 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); gotoSpread(ui.spreadIndex - 1, -1); }
      }
    }
  });

  // Сохранить текст перед Ctrl+S-обработчиком (если фокус в поле)
  function onEditFromKeyboard() {
    const book = currentBook();
    if (!book) return;
    book.title = els.edTitle.value;
    book.author = els.edAuthor.value;
    book.shelfId = els.edShelf.value || book.shelfId;
    book.text = els.edText.value;
    book.updatedAt = Date.now();
  }

  /* --- Ресайз: пересчёт рядов полок и пагинации открытой книги --- */
  const onResize = debounce(() => {
    renderLibrary();
    if (!els.overlay.hidden && ui.currentBookId) {
      if (ui.mode === 'read') { refreshPages(); paintSpread(); }
      else updateEstimate();
    }
  }, 250);
  window.addEventListener('resize', onResize);

  /* --- Сохранить всё при уходе со страницы --- */
  window.addEventListener('beforeunload', flushSave);
}

/* ================== 16. Декор: пылинки ================== */

function buildDust() {
  const n = 14;
  let html = '';
  for (let i = 0; i < n; i++) {
    const left = Math.random() * 100;
    const dur = 14 + Math.random() * 18;
    const delay = -Math.random() * dur;
    const size = 2 + Math.floor(Math.random() * 2);
    html += `<i style="left:${left.toFixed(1)}%;width:${size}px;height:${size}px;animation-duration:${dur.toFixed(1)}s;animation-delay:${delay.toFixed(1)}s"></i>`;
  }
  els.dust.innerHTML = html;
}

/* ================== 17. Инициализация ================== */

function init() {
  cacheDom();
  buildSwatches();
  buildDust();
  bindEvents();

  // Загружаем библиотеку или создаём демо-набор при первом запуске
  if (!loadLibrary()) {
    library = seedLibrary();
    saveLibrary();
  }

  renderChips();
  renderLibrary();
}

init();

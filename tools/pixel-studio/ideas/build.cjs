#!/usr/bin/env node
// Список идей для «Пиксельной студии 3011» → ../IDEAS.md и ideas.html (страница с фильтрами).
'use strict';
const fs = require('fs'), path = require('path');

const COST = { S: { w: 1, t: 'S — небольшая правка, полдня' }, M: { w: 2, t: 'M — одна итерация, как «ключи + MP4»' }, L: { w: 3, t: 'L — две итерации' }, XL: { w: 5, t: 'XL — три и больше, с перестройкой' } };
const CATS = { color: 'Пиксели и цвет', light: 'Свет и глубина', motion: 'Движение', screen: 'Эффекты экрана', shore: 'Shore и подача', flow: 'Процесс и экспорт', claude: 'Claude' };
const SRC = {
  lospec: ['Lospec: палитры и JSON по ссылке', 'https://lospec.com/palettes/api'],
  pixelorama: ['Pixelorama: эффекты слоёв, палитры .gpl/.pal', 'https://github.com/orama-interactive/pixelorama'],
  aseprite: ['Aseprite: shading ink, обводка, onion skin', 'https://www.aseprite.org/docs/shading/'],
  okshift: ['OKShift: hue-shift в OKLab для Aseprite', 'https://github.com/WangleLine/OKShift'],
  ditherboy: ['Dither Boy 6.0: 63 алгоритма, полутон, временной шум', 'https://80.lv/articles/dither-boy-6-0-adds-animation-features-better-video-support'],
  bluenoise: ['Синий шум для дизеринга (Moments in Graphics)', 'https://momentsingraphics.de/BlueNoise.html'],
  riemersma: ['Дизеринг Римерсмы по кривой Гильберта', 'https://compuphase.com/riemer.htm'],
  cycle: ['Color cycling, Mark Ferrari', 'https://wikipedia.com/wiki/Color_cycling'],
  canvascycle: ['Canvas Cycle — палитровая анимация в браузере', 'https://experiments.withgoogle.com/canvas-cycle'],
  slk: ['SLK img2pixel: затемнение сильных краёв', 'https://captain4lk.itch.io/slk-img2pixel/devlog/284327/slk-img2pixel-v12'],
  glitchfx: ['Glitch Fx: сортировка пикселей с маской', 'https://apps.apple.com/app/id1556558042'],
  composer: ['Pixel Composer: ноды, частицы, 2D-свет, анимация любого параметра', 'https://store.steampowered.com/app/2299600'],
  composer07: ['Pixel Composer 0.7: свет — точка, линия, конус', 'https://makham.itch.io/pixel-composer/devlog/313070/07-updates'],
  heos: ['Heos Camera: параллакс по глубине слоёв в Aseprite', 'https://heosphorus.itch.io/heos-camera'],
  upsampler: ['3D Parallax: глубина нейросетью → MP4/GIF', 'https://upsampler.com/free-3d-parallax-generator-no-signup'],
  laigter: ['Laigter: нормали и свет для 2D-спрайтов', 'https://azagaya.itch.io/laigter'],
  crt: ['crt-royale: маски люминофора, свечение, изгиб', 'https://docs.libretro.com/shader/crt_royale/'],
  modul8: ['MODUL8: Feedback, RGB Split, Corruption', 'https://apps.apple.com/us/app/id6755617539'],
  photomosh: ['PhotoMosh: WebGL-глитч, экспорт GIF и видео', 'https://photomosh.com/help'],
  imageshift: ['Image Shift: спиральный сдвиг, калейдоскоп', 'https://apps.apple.com/us/app/image-shift/id6759228540'],
  pixelover: ['PixelOver: спрайт-листы, индексация палитры', 'https://store.steampowered.com/app/1762550/PixelOver/'],
  retrodiff: ['Retro Diffusion: палитра по тексту', 'https://astropulse.itch.io/retrodiffusion/devlog/903094/retro-diffusion-update-qol-and-palettes'],
  pixlab: ['PixelLab: ИИ-генерация ассетов', 'https://www.speakrj.com/?p=28545']
};

const IDEAS = [
  { id: 'shoreanim', cat: 'shore', title: 'Живой интерфейс Shore', cost: 'M', diff: 2, impact: 5, src: [],
    what: 'Анимации интерфейса очков: аннотации печатаются по буквам, уведомление «всплывает», рамка-прицел сканирует объект, таймер бежит, HUD сам иногда сбоит.',
    gives: 'Сторис выглядит как запись с настоящих очков 3011. Опирается на уже готовые таймлайн и аннотации.' },
  { id: 'cycle', cat: 'motion', title: 'Палитровая анимация (color cycling)', cost: 'M', diff: 3, impact: 5, src: ['cycle', 'canvascycle'],
    what: 'Пиксели стоят на месте, а цвета в выбранных диапазонах палитры бегут по кругу: вода, огонь, мерцание экрана, неон, дождь в окне.',
    gives: 'Классическая магия Марка Феррари: сцена оживает без единого сдвинутого пикселя, GIF остаётся крошечным. У нас уже есть индексы палитры — идеальная база.' },
  { id: 'particles', cat: 'motion', title: 'Частицы на сетке: дождь, снег, пыль, пар, искры', cost: 'M', diff: 3, impact: 5, src: ['composer'],
    what: 'Слой частиц, рисуемый пиксель-в-пиксель на сетке и зацикленный по таймлайну: капли по стеклу, пар из чашки, пылинки в луче, искры от лампы.',
    gives: 'Самый заметный «вау» в анимации. Сочетается с лучами и туманом, работает и в GIF, и в MP4.' },
  { id: 'variants', cat: 'flow', title: '«Варианты»: сетка мини-превью', cost: 'M', diff: 2, impact: 5, src: ['ditherboy'],
    what: 'Кнопка показывает 6–9 маленьких вариантов кадра с разными палитрами, дизерингом, светом и глитчем; щелчок применяет вариант, ещё щелчок — «похожие на этот».',
    gives: 'Найти лук за секунды вместо прокрутки десятков ползунков. Главный ускоритель работы.' },
  { id: 'gradmap', cat: 'color', title: 'Градиентная карта', cost: 'S', diff: 1, impact: 4, src: ['pixelorama'],
    what: 'Яркость кадра раскладывается по рампе из 2–6 цветов: двухтон, «ночное видение Shore», тепловизор, сепия, кислотный неон.',
    gives: 'Мгновенная сильная стилизация одной кнопкой. Ложится между светом и палитрой, не ломая пиксели.' },
  { id: 'palettes', cat: 'color', title: 'Библиотека палитр и импорт файлов', cost: 'S', diff: 1, impact: 4, src: ['lospec', 'pixelorama'],
    what: '20–30 известных палитр внутри студии (PICO-8, Endesga 32, Sweetie 16, Resurrect 64…) плюс перетаскивание файлов .gpl/.pal/.hex и вставка из буфера.',
    gives: 'Узнаваемые ретро-стили в один щелчок. Загружать с сайта Lospec напрямую артефакт не может (сеть закрыта), поэтому — встроенный набор и файлы.' },
  { id: 'clpalette', cat: 'claude', title: 'Палитра словами', cost: 'S', diff: 1, impact: 4, src: ['retrodiff'],
    what: 'Поле «опишите настроение»: «ржавый закат», «больница 3011», «неон под дождём» — Claude возвращает 8–24 HEX-цвета, студия применяет их как ручную палитру.',
    gives: 'Новые цветовые миры без подбора вручную. Вызов Claude уже подключён.' },
  { id: 'rampgen', cat: 'color', title: 'Рампы с hue-shift по ключевым цветам', cost: 'M', diff: 2, impact: 4, src: ['aseprite', 'okshift'],
    what: 'Выбираете 2–4 базовых цвета — студия строит рампы, где тени уходят в холодное, а света в тёплое (в OKLab, без грязи).',
    gives: 'Цвет «как у пиксель-художника», а не механическое затемнение. Особенно заметно на коже, ткани, дереве.' },
  { id: 'lights', cat: 'light', title: 'Несколько ламп и их типы', cost: 'M', diff: 3, impact: 4, src: ['composer07'],
    what: 'До 3–4 источников: точка, конус, полоса-неон, окно. У каждого цвет, сила, мерцание; позиции тянутся по кадру и анимируются ключами.',
    gives: 'Драматичный свет: лампа над столом плюс холодный экран плюс неон с улицы.' },
  { id: 'crt', cat: 'screen', title: 'CRT-набор', cost: 'M', diff: 3, impact: 4, src: ['crt'],
    what: 'Маски люминофора (апертурная, щелевая, теневая), свечение строк, мерцание, бегущая полоса, «плохой кабель». Изгиб экрана — только как отдельная подача, он нарушает квадратность.',
    gives: 'Ощущение настоящего экрана очков или старого монитора. Развитие уже готовой «подачи пикселя».' },
  { id: 'feedback', cat: 'screen', title: 'Шлейфы и «датамош» в анимации', cost: 'M', diff: 3, impact: 4, src: ['modul8', 'photomosh'],
    what: 'Кадр смешивается с предыдущими: хвосты за движением, «застывшие» блоки при глитче, тянущиеся пиксели.',
    gives: 'Тот самый сломанный видеопоток, когда очки сбоят. Особенно мощно с параллаксом и частицами.' },
  { id: 'parallax', cat: 'light', title: 'Глубина и камера 2.5D', cost: 'L', diff: 4, impact: 5, src: ['heos', 'upsampler'],
    what: 'В режиме текста глубина берётся из слоёв плана (точно), для фото — из яркости и ручной кисти глубины. Камера наезжает, плывёт, качается — с параллаксом.',
    gives: 'Сцена «оживает» как 3D. Для сторис это один из самых эффектных приёмов. Нейросетевая глубина для фото в артефакте недоступна, поэтому для фото — упрощённая.' },
  { id: 'mask', cat: 'flow', title: 'Маска-кисть для эффектов', cost: 'L', diff: 3, impact: 5, src: ['glitchfx'],
    what: 'Рисуете кистью по кадру, где работают глитч, свет, дизеринг, другая палитра или тонировка. Несколько масок, мягкие края, инверсия.',
    gives: 'Точечный контроль: глитч только на экране телевизора, тёплый свет только на столе. Резко поднимает качество кадров.' },
  { id: 'video', cat: 'flow', title: 'Видео как источник', cost: 'L', diff: 4, impact: 5, src: ['ditherboy', 'photomosh'],
    what: 'Загружаете свой ролик — студия пикселизует каждый кадр с теми же настройками, глитчем и Shore, и собирает MP4/GIF.',
    gives: 'Свои кадры превращаются в «записи 3011». Ограничения: длина ролика и память, поэтому — короткие клипы и уменьшение до сетки.' },
  { id: 'ditherplus', cat: 'color', title: 'Новые дизеринги: синий шум, Римерсма, полутон', cost: 'M', diff: 2, impact: 3, src: ['ditherboy', 'bluenoise', 'riemersma'],
    what: 'Синий шум (без решётки), Римерсма (по кривой Гильберта), полутон точками и линиями, штриховка.',
    gives: 'Мягкие плёночные градиенты без узора и «печатный» вид для плакатов и мерча.' },
  { id: 'tempdither', cat: 'motion', title: 'Кипящий дизеринг', cost: 'S', diff: 2, impact: 3, src: ['ditherboy'],
    what: 'Порог дизеринга чуть меняется от кадра к кадру по одной из нескольких шумовых схем.',
    gives: 'Живая «плёнка» в анимации, даже если в кадре ничего не движется.' },
  { id: 'glitchplus', cat: 'screen', title: 'Новые глитчи', cost: 'S', diff: 2, impact: 3, src: ['imageshift', 'photomosh'],
    what: 'Зеркала и калейдоскоп, спиральный сдвиг, «битый PNG», дрожь и качание кадра, разрыв кадра по диагонали.',
    gives: 'Больше разнообразия сбоев, особенно в анимации.' },
  { id: 'selout', cat: 'color', title: 'Выборочная обводка (sel-out)', cost: 'M', diff: 3, impact: 3, src: ['aseprite', 'slk'],
    what: 'Цвет контура зависит от соседних цветов и света: на светлой стороне светлее, в тени темнее; режимы «внешняя», «внутренняя», «только у объектов».',
    gives: 'Чище и «профессиональнее» силуэты, меньше грязи от сплошной тёмной обводки.' },
  { id: 'normals', cat: 'light', title: 'Нормали и блики', cost: 'M', diff: 3, impact: 3, src: ['laigter'],
    what: 'Нормали по картинке, зеркальные блики, контровой свет по краю, ступенчатый (toon) свет в 2–4 тона.',
    gives: 'Объём и «материал» у предметов. Развитие уже готового «Объёма».' },
  { id: 'clkeys', cat: 'claude', title: 'Анимация словами', cost: 'M', diff: 3, impact: 4, src: [],
    what: '«Лампа мигает, штора качается, камера медленно наезжает» — Claude возвращает ключи для ползунков, студия ставит их на таймлайн.',
    gives: 'Сложная анимация без ручной расстановки ключей.' },
  { id: 'clsuggest', cat: 'claude', title: 'Claude смотрит на фото и предлагает лук', cost: 'M', diff: 2, impact: 4, src: [],
    what: 'Claude получает уменьшенную картинку и возвращает 2–3 набора настроек с пояснением («ночь, одна лампа, VHS»).',
    gives: 'Быстрый старт для своих фото. Нужно разрешение просмотрщика на отправку картинок Claude.' },
  { id: 'clnotes', cat: 'claude', title: 'Подписи Shore голосом очков', cost: 'S', diff: 1, impact: 3, src: [],
    what: 'Claude по описанию или кадру предлагает 3–5 коротких надписей в стиле интерфейса Shore и где их поставить.',
    gives: 'Сюжет и атмосфера в кадре за один клик.' },
  { id: 'export', cat: 'flow', title: 'APNG, спрайт-лист, SVG', cost: 'M', diff: 2, impact: 3, src: ['pixelover', 'ditherboy'],
    what: 'APNG — анимация без ограничения в 256 цветов; спрайт-лист для игр; SVG из квадратов — для печати и мерча любого размера.',
    gives: 'Анимация в полном цвете для «Цветов оригинала», файлы для игр и печати.' },
  { id: 'safezones', cat: 'shore', title: 'Безопасные зоны сторис', cost: 'S', diff: 1, impact: 3, src: [],
    what: 'Полупрозрачные рамки интерфейсов Instagram, TikTok и Telegram поверх холста (только на экране).',
    gives: 'Подписи и детали не уйдут под кнопки и ник в соцсетях.' },
  { id: 'batch', cat: 'flow', title: 'Пакетная обработка', cost: 'M', diff: 2, impact: 3, src: [],
    what: 'Перетаскиваете сразу много фото — один пресет применяется ко всем, результат одним ZIP.',
    gives: 'Серия кадров в едином стиле для поста-карусели.' },
  { id: 'stack', cat: 'flow', title: 'Стек эффектов с порядком', cost: 'XL', diff: 5, impact: 4, src: ['pixelorama', 'composer'],
    what: 'Эффекты как список: перетаскиваете, меняете порядок, выключаете, дублируете (например, два глитча до и после палитры). Как неразрушающие эффекты слоёв.',
    gives: 'Гибкость уровня Pixel Composer. Но это перестройка всего конвейера — делать после остального.' }
];
const EXCLUDED = [
  ['Веб-камера в реальном времени', 'Артефакту не выдаются камера и микрофон — только загрузка файлов.'],
  ['ИИ-генерация пиксель-арта (как Retro Diffusion, PixelLab)', 'Встроенный Claude отвечает только текстом, а внешние сервисы из артефакта недоступны. Наш аналог — план сцены от Claude, он уже есть.'],
  ['Прямая загрузка палитр с Lospec', 'Сеть артефакта закрыта для сторонних сайтов. Обходим встроенным набором и импортом файлов.'],
  ['Нейросетевая карта глубины для фото', 'Модели вроде Depth Anything слишком тяжёлые для страницы. Для фото — глубина по яркости и ручной кисти.']
];
const FIRST = ['shoreanim', 'cycle', 'particles', 'variants', 'gradmap', 'palettes', 'clpalette'];
const DONE = new Set(['shoreanim', 'cycle', 'particles', 'variants']);

const value = i => +(i.impact / COST[i.cost].w).toFixed(2);
const stars = n => '●'.repeat(n) + '○'.repeat(5 - n);

// ---------- Markdown ----------
let md = `# Идеи для «Пиксельной студии 3011»\n\nИсследование похожих программ: Aseprite, Pixelorama, PixelOver, Pixel Composer, Dither Boy, PhotoMosh и мобильные глитч-приложения, CRT-шейдеры, Laigter, Lospec, палитровая анимация Марка Феррари, ИИ-генераторы. Ниже — что из этого стоит перенести к нам.\n\n`;
md += `**Затраты:** ${Object.values(COST).map(c => c.t).join('; ')}.  \n**Сложность** и **польза** — от 1 до 5. **Выгода** = польза ÷ вес затрат (S=1, M=2, L=3, XL=5).\n\n`;
md += `## С чего начать\n\n${FIRST.map((id, n) => { const i = IDEAS.find(x => x.id === id); return `${n + 1}. ${DONE.has(id) ? '✅ ' : ''}**${i.title}** — ${i.gives}`; }).join('\n')}\n\n`;
md += `## Все идеи\n\n| Идея | Раздел | Затраты | Сложность | Польза | Выгода |\n| --- | --- | --- | --- | --- | --- |\n`;
for (const i of [...IDEAS].sort((a, b) => value(b) - value(a) || b.impact - a.impact)) md += `| ${DONE.has(i.id) ? '✅ ' : ''}${i.title} | ${CATS[i.cat]} | ${i.cost} | ${i.diff}/5 | ${i.impact}/5 | ${value(i)} |\n`;
md += `\n## Подробно\n`;
for (const [k, v] of Object.entries(CATS)) {
  const list = IDEAS.filter(i => i.cat === k); if (!list.length) continue;
  md += `\n### ${v}\n`;
  for (const i of list) md += `\n**${i.title}** · затраты ${i.cost} · сложность ${i.diff}/5 · польза ${i.impact}/5\n\n- Что это: ${i.what}\n- Что даст: ${i.gives}\n${i.src.length ? `- Где видели: ${i.src.map(s => `[${SRC[s][0]}](${SRC[s][1]})`).join(', ')}\n` : ''}`;
}
md += `\n## Чего не делаем и почему\n\n${EXCLUDED.map(([a, b]) => `- **${a}.** ${b}`).join('\n')}\n`;
fs.writeFileSync(path.join(__dirname, '..', 'IDEAS.md'), md);

// ---------- HTML ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const data = IDEAS.map(i => ({ ...i, done: DONE.has(i.id), value: value(i), srcs: i.src.map(s => SRC[s]) }));
const html = `<title>Идеи для студии 3011</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Unbounded:wght@500&display=swap">
<style>
/* Тёмная, как сама студия: сверху «с чего начать», ниже вся таблица с фильтрами и сортировкой, в конце — чего не делаем */
:root{
  color-scheme:dark;
  --bg:#0c100f; --surface:#121816; --raise:#19201d; --line:#252e2a; --line-2:#33403a;
  --fg:#d8ddd2; --muted:#89948a; --accent:#b4bb72; --warm:#cf9f58; --cool:#7fa7c9;
  --f-body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
  --f-disp:"Unbounded","IBM Plex Sans",system-ui,sans-serif;
}
body{background:var(--bg);color:var(--fg);font:15px/1.55 var(--f-body);margin:0}
.wrap{max-width:1080px;margin:0 auto;padding-block:30px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:32px}
h1{font:500 clamp(22px,3.6vw,32px)/1.2 var(--f-disp);margin:0;text-wrap:balance}
h1 b{font-weight:500;color:var(--accent)}
h2{font:600 13px/1 var(--f-body);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 14px}
.lead{color:var(--muted);margin:10px 0 0;max-width:72ch}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted);margin-top:14px}
.legend b{color:var(--fg);font-weight:500}
.first{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;counter-reset:f}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;counter-increment:f;position:relative}
.card::before{content:counter(f);position:absolute;top:12px;right:14px;font:500 13px var(--f-mono);color:var(--muted)}
.card h3{margin:0;font-size:15px;padding-right:22px}
.card p{margin:0;font-size:13.5px;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;gap:6px;font:12px var(--f-mono)}
.pill{padding:2px 7px;border-radius:5px;background:var(--raise);border:1px solid var(--line-2);white-space:nowrap}
.pill.okp{color:var(--bg);background:var(--accent);border-color:transparent;font-size:11px;vertical-align:2px}
.card.done{border-color:var(--accent)}
.pill.c-S{color:var(--accent)} .pill.c-M{color:var(--fg)} .pill.c-L{color:var(--warm)} .pill.c-XL{color:#e07a62}
.bar{display:inline-flex;gap:2px;vertical-align:middle}
.bar i{width:7px;height:7px;border-radius:2px;background:var(--line-2)}
.bar.imp i.on{background:var(--accent)} .bar.dif i.on{background:var(--cool)}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.chip{all:unset;cursor:pointer;padding:5px 10px;border:1px solid var(--line-2);border-radius:999px;font-size:12.5px;color:var(--muted)}
.chip[aria-pressed="true"]{background:var(--accent);border-color:transparent;color:var(--bg)}
.chip:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
select{background:var(--bg);color:var(--fg);border:1px solid var(--line-2);border-radius:7px;padding:6px 9px;font:13px var(--f-body);margin-left:auto}
.list{display:flex;flex-direction:column;gap:6px}
.idea{background:var(--surface);border:1px solid var(--line);border-radius:10px}
.idea>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:center;padding:12px 16px}
.idea>summary::-webkit-details-marker{display:none}
.idea>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:10px}
.ttl{font-weight:500}
.ttl small{display:block;color:var(--muted);font-size:12px;font-weight:400}
.scores{display:grid;grid-template-columns:auto auto auto auto;gap:4px 12px;align-items:center;font:12px var(--f-mono);color:var(--muted);justify-items:start}
.scores b{color:var(--fg);font-weight:500}
.body{padding:0 16px 14px;display:flex;flex-direction:column;gap:8px;font-size:14px;max-width:80ch}
.body p{margin:0}
.body p b{color:var(--muted);font-weight:500}
.body a{color:var(--accent)}
.excl{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 18px}
.excl ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px}
.src{columns:2 320px;gap:24px;font-size:13px;padding-left:18px;margin:0}
.src li{break-inside:avoid;margin-bottom:4px}
.src a{color:var(--accent)}
@media (max-width:640px){.idea>summary{grid-template-columns:minmax(0,1fr)} .scores{grid-template-columns:auto auto} select{margin-left:0}}
</style>

<div class="wrap">
  <header>
    <h1>Идеи для <b>Пиксельной студии 3011</b></h1>
    <p class="lead">Посмотрел, как устроены Aseprite, Pixelorama, PixelOver, Pixel Composer, Dither Boy, PhotoMosh и мобильные глитч-приложения, CRT-шейдеры, Laigter, Lospec и палитровая анимация Марка Феррари. Здесь — ${IDEAS.length} идей, которые стоит перенести к нам, с оценкой затрат, сложности и пользы. Сделано: ${DONE.size}.</p>
    <div class="legend">
      <span><b>Затраты:</b> S — полдня · M — одна итерация, как «ключи + MP4» · L — две · XL — три и больше</span>
      <span><b>Сложность</b> <span class="bar dif"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i></span> и <b>польза</b> <span class="bar imp"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span> — от 1 до 5</span>
      <span><b>Выгода</b> = польза ÷ вес затрат (S=1, M=2, L=3, XL=5)</span>
    </div>
  </header>

  <section>
    <h2>С чего начать</h2>
    <div class="first">${FIRST.map(id => { const i = IDEAS.find(x => x.id === id); return `<article class="card${DONE.has(id) ? ' done' : ''}"><h3>${esc(i.title)}${DONE.has(id) ? ' <span class="pill okp">сделано</span>' : ''}</h3><p>${esc(i.gives)}</p><div class="meta"><span class="pill c-${i.cost}">затраты ${i.cost}</span><span class="pill">сложность ${i.diff}/5</span><span class="pill">польза ${i.impact}/5</span></div></article>`; }).join('')}</div>
  </section>

  <section>
    <h2>Все идеи</h2>
    <div class="controls" role="group" aria-label="Фильтр по разделам">
      <button class="chip" data-cat="" aria-pressed="true">Все</button>
      ${Object.entries(CATS).map(([k, v]) => `<button class="chip" data-cat="${k}" aria-pressed="false">${v}</button>`).join('')}
      <select id="sort" aria-label="Сортировка"><option value="value">по выгоде</option><option value="impact">по пользе</option><option value="cost">сначала дешёвые</option><option value="diff">сначала простые</option></select>
    </div>
    <div class="list" id="list"></div>
  </section>

  <section>
    <h2>Чего не делаем и почему</h2>
    <div class="excl"><ul>${EXCLUDED.map(([a, b]) => `<li><b>${esc(a)}.</b> ${esc(b)}</li>`).join('')}</ul></div>
  </section>

  <section>
    <h2>Источники</h2>
    <ul class="src">${Object.values(SRC).map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul>
  </section>
</div>

<script>
'use strict';
const IDEAS = ${JSON.stringify(data)};
const CATS = ${JSON.stringify(CATS)};
const W = { S: 1, M: 2, L: 3, XL: 5 };
let cat = '', sort = 'value';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bar = (n, cls) => '<span class="bar ' + cls + '" aria-hidden="true">' + [1, 2, 3, 4, 5].map(k => '<i' + (k <= n ? ' class="on"' : '') + '></i>').join('') + '</span>';
function render() {
  const list = IDEAS.filter(i => !cat || i.cat === cat).sort((a, b) =>
    sort === 'impact' ? b.impact - a.impact || b.value - a.value :
    sort === 'cost' ? W[a.cost] - W[b.cost] || b.impact - a.impact :
    sort === 'diff' ? a.diff - b.diff || b.impact - a.impact :
    b.value - a.value || b.impact - a.impact);
  document.getElementById('list').innerHTML = list.map(i => '<details class="idea"><summary><span class="ttl">' + esc(i.title) + (i.done ? ' <span class="pill okp">сделано</span>' : '') + '<small>' + esc(CATS[i.cat]) + '</small></span>' +
    '<span class="scores"><span class="pill c-' + i.cost + '">' + i.cost + '</span><span>сложность ' + bar(i.diff, 'dif') + '</span><span>польза ' + bar(i.impact, 'imp') + '</span><span>выгода <b>' + i.value.toString().replace('.', ',') + '</b></span></span></summary>' +
    '<div class="body"><p><b>Что это.</b> ' + esc(i.what) + '</p><p><b>Что даст.</b> ' + esc(i.gives) + '</p>' +
    (i.srcs.length ? '<p><b>Где видели.</b> ' + i.srcs.map(s => '<a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(s[0]) + '</a>').join(', ') + '</p>' : '') + '</div></details>').join('');
}
document.querySelector('.controls').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; cat = b.dataset.cat; document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b))); render(); });
document.getElementById('sort').addEventListener('change', e => { sort = e.target.value; render(); });
render();
</script>
`;
fs.writeFileSync(path.join(__dirname, 'ideas.html'), html);
console.log('IDEAS.md и ideas.html:', IDEAS.length, 'идей');

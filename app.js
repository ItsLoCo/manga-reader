document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const WORKER_URL = 'https://api.locomanga.pro/';
    const startScreen = $('start-screen'), readerScreen = $('reader-screen'), reader = $('reader');
    const settingsMenu = $('settings-menu'), navPanel = $('reader-navigation'), chapterSelect = $('chapter-select');
    const progressBar = $('progress-bar'), searchInput = $('search-input'), toggle = $('autoscroll-toggle');
    const mode = () => $('scroll-mode').value;

    const ls = {
        get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    };
    let lib = ls.get('rd_lib', {}), history = ls.get('rd_hist', {}), token = ls.get('rd_token', ''), user = ls.get('rd_user', '');
    let manga = null, chapters = [], curIdx = 0, restoring = false, restoreTimer, contRow, planRow, doneRow, dm = null;
    let auto = false, raf = 0, fpos = 0, touching = false, touchTimer, sx = 0, sy = 0, st, syncT;

    // ---------- API ----------
    async function call(params, opts = {}) {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
        try {
            const r = await fetch(WORKER_URL + '?' + new URLSearchParams(params), { ...opts, signal: ctl.signal });
            const d = await r.json();
            if (d.error) throw new Error(d.error);
            return d;
        } catch (e) {
            if (e.name === 'AbortError') throw new Error('сервер не отвечает (таймаут 20 секунд)');
            throw e;
        } finally { clearTimeout(timer); }
    }
    const post = (action, body) => call({ action }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body),
    });

    // ---------- Прогресс и синхронизация ----------
    const curPos = () => mode() === 'paged-horizontal' ? reader.scrollLeft : reader.scrollTop;
    function saveProgress(pos) {
        if (!manga || !chapters[curIdx]) return;
        history[manga.id] = { id: manga.id, title: manga.title, cover: manga.cover, ch: chapters[curIdx].id,
            chTitle: chapters[curIdx].title, pos: pos ?? curPos(), ts: Date.now() };
        ls.set('rd_hist', history);
        if (token) { clearTimeout(syncT); syncT = setTimeout(syncNow, 4000); }
    }
    async function syncNow() {
        if (!token) return;
        try { const d = await post('sync', { history, lib }); history = d.history; lib = d.lib; ls.set('rd_hist', history); ls.set('rd_lib', lib); }
        catch (e) { if (/войти/i.test(e.message)) logout(); }
    }

    // ---------- Аккаунт ----------
    const renderAuth = () => { $('auth-btn').textContent = user ? '👤 ' + user : 'Войти'; };
    function logout() { token = ''; user = ''; ls.set('rd_token', ''); ls.set('rd_user', ''); renderAuth(); }
    async function authDo(kind) {
        const m = $('auth-msg'); m.textContent = '…';
        try {
            const d = await post(kind, { username: $('auth-user').value.trim(), password: $('auth-pass').value });
            token = d.token; user = d.username; ls.set('rd_token', token); ls.set('rd_user', user);
            $('auth-modal').classList.add('hidden'); $('auth-pass').value = ''; m.textContent = '';
            renderAuth(); await syncNow(); renderContinue(); renderLists();
        } catch (e) { m.textContent = e.message; }
    }
    $('auth-btn').onclick = () => {
        if (user) { if (confirm('Выйти из аккаунта? Прогресс останется на сервере.')) logout(); }
        else $('auth-modal').classList.remove('hidden');
    };
    $('auth-login').onclick = () => authDo('login');
    $('auth-register').onclick = () => authDo('register');
    $('auth-close').onclick = () => $('auth-modal').classList.add('hidden');

    // ---------- Главная ----------
    const norm = x => ({ id: x.url, title: x.title, cover: x.cover, ru: x.ru, ch: x.ch, lang: x.lang });
    const proxy = u => WORKER_URL + '?action=img&url=' + encodeURIComponent(u);
    function setCover(i, url) {
        i.onerror = null;
        if (!url) { i.removeAttribute('src'); return; }
        i.src = proxy(url); i.onerror = () => { i.onerror = null; i.src = url; };
    }
    function card(m, sub, direct, badge) {
        const d = document.createElement('div'); d.className = 'card';
        const i = new Image(); i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.alt = '';
        setCover(i, m.cover);
        const p = document.createElement('p'); p.textContent = m.title;
        d.append(i, p);
        if (sub) { const s = document.createElement('small'); s.textContent = sub; d.append(s); }
        if (badge) {
            const t = document.createElement('span'); t.className = 'tag' + (m.ru ? '' : ' no'); t.textContent = m.ru ? 'RU' : 'нет RU'; d.append(t);
            if (m.ch) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = m.ch + ' гл.'; d.append(c); }
        }
        d.onclick = () => { const x = { id: m.id, title: m.title, cover: m.cover }; if (direct) openManga(x); else showDetail(x); };
        return d;
    }
    function section(title) {
        const s = document.createElement('section');
        s.innerHTML = '<h2></h2><div class="row"></div>';
        s.firstChild.textContent = title; $('home').append(s);
        return s.lastChild;
    }
    function renderContinue() {
        if (!contRow) return;
        const items = Object.values(history).filter(h => lib[h.id]?.st !== 'done').sort((a, b) => b.ts - a.ts).slice(0, 12);
        contRow.parentNode.classList.toggle('hidden', !items.length);
        contRow.textContent = '';
        items.forEach(h => contRow.append(card(h, h.chTitle, true)));
    }
    function renderLists() {
        [[planRow, 'plan'], [doneRow, 'done']].forEach(([row, st]) => {
            if (!row) return;
            const items = Object.values(lib).filter(l => l.st === st).sort((a, b) => b.ts - a.ts);
            row.parentNode.classList.toggle('hidden', !items.length);
            row.textContent = '';
            items.forEach(l => row.append(card(l)));
        });
    }
    function loadHome() {
        $('home').innerHTML = '';
        contRow = section('Продолжить чтение'); planRow = section('Хочу прочитать'); renderContinue();
        [['updated', 'Обновления'], ['top', 'Рекомендуем'], ['popular', 'Популярное'], ['new', 'Новинки']].forEach(async ([type, title]) => {
            const row = section(title); row.textContent = 'Загрузка…';
            try {
                const d = await call({ action: 'feed', type });
                row.textContent = '';
                // прочитанное не показываем в рекомендациях, популярном и новинках
                d.entries.filter(x => type === 'updated' || lib[x.url]?.st !== 'done').forEach(x => row.append(card(norm(x))));
            } catch (e) { row.textContent = 'Не удалось загрузить: ' + e.message; }
        });
        doneRow = section('Прочитано'); renderLists();
    }

    // ---------- Страница тайтла ----------
    const detail = $('detail-screen');
    function renderDetailBtns() {
        const st = lib[dm.id]?.st || '', h = history[dm.id];
        $('d-read').textContent = h ? 'Продолжить: ' + h.chTitle : 'Читать';
        $('d-plan').textContent = st === 'plan' ? '✓ В списке' : 'Хочу прочитать';
        $('d-done').textContent = st === 'done' ? '✓ Прочитано' : 'Прочитано';
        $('d-plan').classList.toggle('on', st === 'plan'); $('d-done').classList.toggle('on', st === 'done');
    }
    function setStatus(st) {
        const cur = lib[dm.id]?.st || '';
        lib[dm.id] = { id: dm.id, title: dm.title, cover: dm.cover, st: cur === st ? '' : st, ts: Date.now() };
        ls.set('rd_lib', lib); renderDetailBtns(); renderLists(); renderContinue();
        if (token) { clearTimeout(syncT); syncT = setTimeout(syncNow, 1500); }
    }
    async function showDetail(m) {
        dm = m; startScreen.classList.add('hidden'); detail.classList.remove('hidden'); detail.scrollTop = 0;
        $('d-title').textContent = m.title; setCover($('d-cover'), m.cover);
        $('d-meta').textContent = ''; $('d-tags').textContent = ''; $('d-ru').className = 'd-ru'; $('d-ru').textContent = ''; $('d-desc').textContent = 'Загрузка описания…';
        renderDetailBtns();
        try {
            const d = await call({ action: 'info', id: m.id });
            if (dm !== m) return;
            $('d-desc').textContent = d.description || 'Описание отсутствует.';
            const lang = { ja: 'Манга', ko: 'Манхва', zh: 'Маньхуа', 'zh-hk': 'Маньхуа' }[d.lang];
            $('d-meta').textContent = [lang, d.status, d.year, d.ch ? d.ch + ' гл.' : ''].filter(Boolean).join(', ');
            const r = $('d-ru');
            if (d.ruRead > 0) { r.className = 'd-ru yes'; r.textContent = 'Русский перевод: ' + d.ruRead + ' гл. в читалке'; }
            else if (d.ruExt > 0) { r.className = 'd-ru no'; r.textContent = 'Русские главы недоступны в читалке (внешний сайт или удалены)'; }
            else { r.className = 'd-ru no'; r.textContent = d.ru ? 'Русский перевод заявлен, но глав пока нет' : 'Русского перевода пока нет'; }
            d.tags.forEach(t => { const s = document.createElement('span'); s.textContent = t; $('d-tags').append(s); });
        } catch (e) { if (dm === m) $('d-desc').textContent = 'Не удалось загрузить описание: ' + e.message; }
    }
    $('d-back').onclick = () => { detail.classList.add('hidden'); startScreen.classList.remove('hidden'); renderContinue(); renderLists(); };
    $('d-read').onclick = () => { detail.classList.add('hidden'); openManga(dm); };
    $('d-plan').onclick = () => setStatus('plan');
    $('d-done').onclick = () => setStatus('done');

    // ---------- Поиск и фильтры ----------
    const F = { order: 'rel', ru: false, status: new Set(), origin: new Set(), rating: new Set(), ch: '', tags: new Map() };
    const OPT = {
        order: [['rel', 'Релевантность'], ['pop', 'Популярность'], ['rate', 'Рейтинг'], ['upd', 'Обновления'], ['new', 'Новинки'], ['az', 'По названию']],
        status: [['ongoing', 'Выходит'], ['completed', 'Завершён'], ['hiatus', 'Перерыв'], ['cancelled', 'Отменён']],
        origin: [['ja', 'Манга'], ['ko', 'Манхва'], ['zh', 'Маньхуа']],
        rating: [['safe', 'Для всех'], ['suggestive', '16+'], ['erotica', '18+']],
        ch: [['', 'Любое'], ['s', 'До 50'], ['m', '50–150'], ['l', '150+']],
    };
    let tagData = null, nextOffset = 0, searching = false, shown = 0;
    const resBox = $('results'), grid = $('grid');
    const activeCount = () => (F.order !== 'rel') + F.ru + F.status.size + F.origin.size + F.rating.size + (F.ch ? 1 : 0) + F.tags.size;
    function updateBadge() { const n = activeCount(), b = $('f-badge'); b.textContent = n; b.classList.toggle('hidden', !n); }

    function chip(label, on, onTap, extra) {
        const b = document.createElement('button'); b.className = 'chip' + (on ? ' on' : '') + (extra ? ' ' + extra : '');
        b.textContent = label; b.onclick = () => onTap(b); return b;
    }
    function group(title, els) {
        const g = document.createElement('div'); g.className = 'fg';
        const h = document.createElement('h4'); h.textContent = title;
        const w = document.createElement('div'); w.className = 'chips'; w.append(...els);
        g.append(h, w); return g;
    }
    const multiChips = (set, items) => items.map(([k, l]) => chip(l, set.has(k), b => {
        if (set.has(k)) set.delete(k); else set.add(k); b.classList.toggle('on', set.has(k));
    }));
    function singleChips(items, get, setv) {
        const els = items.map(([k, l]) => chip(l, get() === k, b => { setv(k); els.forEach(e => e.classList.toggle('on', e === b)); }));
        return els;
    }
    const tagChips = list => list.map(t => chip(t.name, F.tags.get(t.id) === 1, b => {
        const v = F.tags.get(t.id);
        if (!v) F.tags.set(t.id, 1); else if (v === 1) F.tags.set(t.id, -1); else F.tags.delete(t.id);
        const nv = F.tags.get(t.id); b.classList.toggle('on', nv === 1); b.classList.toggle('ex', nv === -1);
    }, F.tags.get(t.id) === -1 ? 'ex' : ''));

    async function buildFilters() {
        const body = $('fs-body'); body.textContent = 'Загрузка…';
        if (!tagData) { try { tagData = (await call({ action: 'tags' })).tags; } catch {} }
        const tags = tagData || [], by = g => tags.filter(t => t.group === g);
        body.textContent = '';
        body.append(
            group('Сортировка', singleChips(OPT.order, () => F.order, v => { F.order = v; })),
            group('Русский перевод', [chip('Только с русским переводом', F.ru, b => { F.ru = !F.ru; b.classList.toggle('on', F.ru); })]),
            group('Формат', [...multiChips(F.origin, OPT.origin), ...tagChips(by('format'))]),
            group('Статус', multiChips(F.status, OPT.status)),
            group('Возрастной рейтинг', multiChips(F.rating, OPT.rating)),
            group('Количество глав', singleChips(OPT.ch, () => F.ch, v => { F.ch = v; }))
        );
        const note = document.createElement('p'); note.className = 'fs-hint';
        note.textContent = 'Число глав известно в основном у завершённых тайтлов: при выбранном фильтре выходящие без итогового числа скрываются.';
        body.append(note);
        if (tags.length) {
            body.append(group('Жанры', tagChips(by('genre'))), group('Темы', tagChips(by('theme'))));
            const hint = document.createElement('p'); hint.className = 'fs-hint';
            hint.textContent = 'Нажми на жанр или тему повторно, чтобы исключить её из поиска.'; body.append(hint);
        } else { const e = document.createElement('p'); e.textContent = 'Не удалось загрузить жанры. Закрой и открой фильтры ещё раз.'; body.append(e); }
    }
    const openFilters = () => { $('filter-sheet').classList.add('open'); $('sheet-bg').classList.remove('hidden'); buildFilters(); };
    const closeFilters = () => { $('filter-sheet').classList.remove('open'); $('sheet-bg').classList.add('hidden'); };
    $('filter-btn').onclick = openFilters; $('sheet-bg').onclick = closeFilters;
    $('f-apply').onclick = () => { closeFilters(); updateBadge(); search(); };
    $('f-reset').onclick = () => {
        F.order = 'rel'; F.ru = false; F.status.clear(); F.origin.clear(); F.rating.clear(); F.ch = ''; F.tags.clear();
        updateBadge(); buildFilters();
    };

    function searchParams(offset) {
        const p = { action: 'search', query: searchInput.value.trim(), order: F.order, offset };
        if (F.ru) p.ru = '1';
        if (F.status.size) p.status = [...F.status].join(',');
        if (F.origin.size) p.origin = [...F.origin].join(',');
        if (F.rating.size) p.rating = [...F.rating].join(',');
        if (F.ch) p.ch = F.ch;
        const inc = [], exc = [];
        F.tags.forEach((v, id) => (v === 1 ? inc : exc).push(id));
        if (inc.length) p.inc = inc.join(',');
        if (exc.length) p.exc = exc.join(',');
        return p;
    }
    const gmsg = t => { grid.textContent = ''; const d = document.createElement('div'); d.className = 'gmsg'; d.textContent = t; grid.append(d); };
    async function search(more) {
        if (searching) return;
        if (!more && !searchInput.value.trim() && !activeCount()) return;
        searching = true;
        resBox.classList.remove('hidden'); $('home').classList.add('hidden');
        if (!more) { shown = 0; gmsg('Ищу…'); $('rcount').textContent = ''; $('more').classList.add('hidden'); }
        try {
            const d = await call(searchParams(more ? nextOffset : 0));
            if (!more) grid.textContent = '';
            if (!more && !d.entries.length) gmsg('Ничего не найдено. Попробуй изменить фильтры.');
            d.entries.forEach(x => grid.append(card(norm(x), null, false, true)));
            shown += d.entries.length; nextOffset = d.offset + d.limit;
            $('more').classList.toggle('hidden', nextOffset >= d.total);
            $('rcount').textContent = d.filtered ? 'Показано: ' + shown : 'Найдено: ' + d.total;
        } catch (e) { if (!more) gmsg('Ошибка: ' + e.message); }
        finally { searching = false; }
    }
    $('search-btn').onclick = () => search();
    $('more').onclick = () => search(true);
    $('rclose').onclick = () => { resBox.classList.add('hidden'); $('home').classList.remove('hidden'); searchInput.value = ''; };
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') search(); });

    // ---------- Чтение ----------
    const msg = (t, bad) => { reader.innerHTML = ''; const d = document.createElement('div'); d.className = 'msg' + (bad ? ' bad' : ''); d.textContent = t; reader.append(d); };

    function noChapters(x = {}) {
        reader.innerHTML = '';
        const w = document.createElement('div'); w.className = 'msg';
        const t = document.createElement('p');
        t.textContent = x.ru > 0 ? 'Русские главы этого тайтла размещены на внешнем сайте, внутри читалки их открыть нельзя.'
            : x.url ? 'Главы этого тайтла размещены на внешних сайтах.'
            : (x.empty?.ru || x.empty?.en) ? 'Главы этого тайтла удалены с MangaDex (так бывает у лицензированных тайтлов), читать их здесь нельзя.'
            : 'Для этого тайтла нет глав, доступных для чтения.';
        w.append(t);
        if (x.total !== undefined && x.total !== null) {
            const s = document.createElement('p'); s.style.fontSize = '12px'; s.textContent = 'Ответ MangaDex: записей о главах — ' + x.total; w.append(s);
        }
        if (/^https?:\/\//.test(x.url || '')) {
            const l = document.createElement('a'); l.href = x.url; l.target = '_blank'; l.rel = 'noopener noreferrer';
            l.className = 'pill'; l.textContent = 'Открыть на внешнем сайте'; w.append(l);
        }
        const b = document.createElement('button'); b.className = 'pill'; b.textContent = '← Назад';
        b.onclick = () => { readerScreen.classList.add('hidden'); showDetail(manga); };
        w.append(b); reader.append(w);
    }

    async function openManga(m) {
        manga = m; chapters = [];
        startScreen.classList.add('hidden'); readerScreen.classList.remove('hidden'); navPanel.classList.add('nav-hidden');
        msg('Загрузка списка глав…');
        try {
            const d = await call({ action: 'details', mangaUrl: m.id });
            chapters = d.chapters.map(c => ({ id: c.url, title: `${c.title} ${c.number}` }));
            if (!chapters.length) return noChapters(d.external);
            chapterSelect.innerHTML = '';
            chapters.forEach((c, i) => chapterSelect.add(new Option(c.title, i)));
            const h = history[m.id], i = h ? chapters.findIndex(c => c.id === h.ch) : -1;
            await openChapter(i < 0 ? 0 : i, i < 0 ? 0 : h.pos);
        } catch (e) { msg('Ошибка: ' + e.message, true); }
    }

    async function openChapter(i, pos = 0) {
        if (i < 0 || i >= chapters.length) return;
        const wasAuto = auto;
        cancelAnimationFrame(raf); clearInterval(restoreTimer);
        curIdx = i; chapterSelect.value = i; closeSettings(); navPanel.classList.add('nav-hidden');
        restoring = true;
        await loadPages(chapters[i].id);
        saveProgress(pos); restore(pos);
        if (wasAuto) setTimeout(startAutoscroll, 1000);
    }

    async function loadPages(id) {
        msg('Загрузка страниц…'); progressBar.style.width = '0%';
        try {
            const d = await call({ action: 'pages', chapterUrl: id });
            if (!d.pages.length) throw new Error('В главе нет страниц');
            reader.textContent = '';
            d.pages.forEach((p, n) => {
                const b = document.createElement('div'); b.className = 'page-block';
                const img = new Image(); img.alt = 'Страница ' + (n + 1); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
                img.onload = () => b.classList.add('ok');
                let direct = false;
                img.onerror = () => {
                    if (!direct) { direct = true; img.src = p.url; return; }
                    b.className = 'page-block err'; b.textContent = `Не загрузилась стр. ${n + 1}. Нажми, чтобы повторить`;
                    b.onclick = ev => { ev.stopPropagation(); b.onclick = null; b.className = 'page-block'; b.textContent = ''; b.append(img); direct = false; img.src = proxy(p.url); };
                };
                img.src = proxy(p.url); b.append(img); reader.append(b);
            });
        } catch (e) { msg('Ошибка загрузки страниц: ' + e.message, true); }
    }

    function restore(pos) {
        let tries = 0;
        restoreTimer = setInterval(() => {
            tries++;
            const h = mode() === 'paged-horizontal';
            const max = h ? reader.scrollWidth - reader.clientWidth : reader.scrollHeight - reader.clientHeight;
            if (pos <= max || tries > 25) {
                clearInterval(restoreTimer);
                if (h) reader.scrollLeft = pos; else reader.scrollTop = pos;
                setTimeout(() => { restoring = false; progress(); }, 250);
            }
        }, 150);
    }

    function progress() {
        const h = mode() === 'paged-horizontal';
        const max = h ? reader.scrollWidth - reader.clientWidth : reader.scrollHeight - reader.clientHeight;
        const pct = max > 0 ? Math.min(100, Math.round(curPos() / max * 100)) : 0;
        progressBar.style.width = pct + '%'; $('chapter-pct').textContent = pct + '%';
        if (chapters.length) $('manga-pct').textContent = Math.round((curIdx + 1) / chapters.length * 100) + '%';
        $('nav-prev').disabled = curIdx <= 0; $('nav-next').disabled = curIdx >= chapters.length - 1;
    }
    reader.addEventListener('scroll', () => {
        progress(); if (restoring) return;
        clearTimeout(st); st = setTimeout(() => saveProgress(), 400);
    });

    // Тап по центру показывает панель, свайп в конце главы открывает следующую
    reader.addEventListener('click', e => {
        const x = e.clientX / innerWidth, y = e.clientY / innerHeight;
        if (x > .25 && x < .75 && y > .25 && y < .75) {
            if (settingsMenu.classList.contains('open')) closeSettings(); else navPanel.classList.toggle('nav-hidden');
        }
    });
    reader.addEventListener('touchstart', e => { touching = true; clearTimeout(touchTimer); sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY; }, { passive: true });
    reader.addEventListener('touchend', e => {
        touchTimer = setTimeout(() => { touching = false; }, 1200);
        if (restoring) return;
        const dx = sx - e.changedTouches[0].clientX, dy = sy - e.changedTouches[0].clientY, h = mode() === 'paged-horizontal';
        const end = h ? reader.scrollLeft >= reader.scrollWidth - reader.clientWidth - 5 : reader.scrollTop >= reader.scrollHeight - reader.clientHeight - 5;
        const swipe = h ? dx > 60 && Math.abs(dx) > Math.abs(dy) : dy > 60 && Math.abs(dy) > Math.abs(dx);
        if (end && swipe && curIdx < chapters.length - 1) openChapter(curIdx + 1);
    }, { passive: true });

    // ---------- Автоскролл ----------
    function startAutoscroll() {
        cancelAnimationFrame(raf); fpos = reader.scrollTop;
        const loop = () => {
            if (!auto || mode() === 'paged-horizontal') return;
            if (touching) fpos = reader.scrollTop;
            else {
                fpos += parseFloat($('autoscroll-speed').value) * 0.4; reader.scrollTop = fpos;
                if (reader.scrollTop >= reader.scrollHeight - reader.clientHeight - 2) {
                    if (curIdx < chapters.length - 1) { openChapter(curIdx + 1); return; }
                    auto = false; toggle.checked = false; return;
                }
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
    }
    toggle.onchange = () => { auto = toggle.checked; if (auto) startAutoscroll(); else cancelAnimationFrame(raf); };

    // ---------- Меню и настройки ----------
    function openSettings() { settingsMenu.classList.add('open'); navPanel.classList.add('nav-hidden'); }
    function closeSettings() { settingsMenu.classList.remove('open'); }
    $('nav-settings').onclick = e => { e.stopPropagation(); openSettings(); };
    $('close-menu').onclick = closeSettings;
    $('nav-prev').onclick = () => openChapter(curIdx - 1);
    $('nav-next').onclick = () => openChapter(curIdx + 1);
    $('nav-top').onclick = () => reader.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    chapterSelect.onchange = () => openChapter(+chapterSelect.value);
    $('home-btn').onclick = () => {
        saveProgress(); syncNow(); auto = false; toggle.checked = false; cancelAnimationFrame(raf);
        closeSettings(); readerScreen.classList.add('hidden'); startScreen.classList.remove('hidden');
        renderContinue();
    };
    const setMode = v => { reader.className = 'mode-' + v; ls.set('rd_mode', v); };
    $('scroll-mode').onchange = e => {
        setMode(e.target.value); auto = false; toggle.checked = false; cancelAnimationFrame(raf);
        reader.scrollTo(0, 0); setTimeout(progress, 50);
    };
    const setBg = v => { document.documentElement.style.setProperty('--page-bg', v); ls.set('rd_bg', v); };
    $('bg-color').onchange = e => setBg(e.target.value);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && manga && !restoring && !readerScreen.classList.contains('hidden')) { saveProgress(); syncNow(); }
    });

    // ---------- Запуск ----------
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
    const savedMode = ls.get('rd_mode', 'webtoon'); $('scroll-mode').value = savedMode; setMode(savedMode);
    const savedBg = ls.get('rd_bg', '#000000'); $('bg-color').value = savedBg; setBg(savedBg);
    renderAuth(); loadHome();
    if (token) syncNow().then(() => { renderContinue(); renderLists(); });
});

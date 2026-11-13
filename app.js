document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const WORKER_URL = 'https://api.locomanga.pro/';
    const startScreen = $('start-screen'), readerScreen = $('reader-screen'), reader = $('reader'), readerTop = $('reader-top');
    const settingsMenu = $('settings-menu'), navPanel = $('reader-navigation'), chapterSelect = $('chapter-select');
    const progressBar = $('progress-bar'), searchInput = $('search-input'), toggle = $('autoscroll-toggle');
    const mode = () => $('scroll-mode').value;
    // реальная высота экрана (работает и при сворачивании панелей браузера, и на старых телефонах)
    const setH = () => {
        let h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        // iPhone в режиме «На экран Домой»: браузер может сообщать высоту на высоту статус-бара меньше реальной
        const app = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
        if (app && window.innerHeight >= window.innerWidth && window.screen && screen.height > h && screen.height - h < 140) h = screen.height;
        let adj = 0; try { adj = parseInt(localStorage.getItem('rd_hadj')) || 0; } catch {}
        document.documentElement.style.setProperty('--app-h', (h + adj) + 'px');
    };
    setH(); window.addEventListener('resize', setH);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setH);

    const ls = {
        get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    };
    let lib = ls.get('rd_lib', {}), history = ls.get('rd_hist', {}), token = ls.get('rd_token', ''), user = ls.get('rd_user', '');
    let me = null, manga = null, chapters = [], curIdx = 0, restoring = false, restoreTimer, contRow, planRow, doneRow, dm = null;
    let auto = false, raf = 0, fpos = 0, touching = false, touchTimer, sx = 0, sy = 0, st, syncT;

    // ---------- Полный экран (Android и десктоп; на iPhone — через «На экран Домой») ----------
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const fsOK = !!document.documentElement.requestFullscreen && !isIOS;
    const inFs = () => !!document.fullscreenElement;
    const enterFs = () => { if (fsOK && ls.get('rd_fs', true) && !inFs()) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); };
    const leaveFs = () => { if (inFs()) document.exitFullscreen().catch(() => {}); };

    // ---------- Экраны и история (свайп назад не выбрасывает с сайта) ----------
    let view = 'home', lastPop = 0;
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
    function ui(show) { navPanel.classList.toggle('nav-hidden', !show); readerTop.classList.toggle('nav-hidden', !show); }
    function setView(v) {
        const prev = view; view = v;
        startScreen.classList.toggle('hidden', v !== 'home');
        detail.classList.toggle('hidden', v !== 'detail');
        readerScreen.classList.toggle('hidden', v !== 'reader');
        if (prev === 'reader' && v !== 'reader') {
            if (!restoring) saveProgress();
            syncNow(); auto = false; toggle.checked = false; cancelAnimationFrame(raf); closeSettings(); ui(false); leaveFs();
        }
        document.documentElement.classList.toggle('reading', v === 'reader');
        if (v === 'home') { renderContinue(); renderLists(); }
        if (v === 'detail' && dm) renderDetailBtns();
    }
    function go(v) { window.history.pushState({ v }, ''); setView(v); }
    window.addEventListener('popstate', e => {
        lastPop = Date.now();
        let v = (e.state && e.state.v) || 'home';
        if (v === 'detail' && !dm) v = 'home';
        if (v === 'reader' && !manga) v = 'home';
        setView(v);
    });
    window.history.replaceState({ v: 'home' }, '');

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
    const renderAuth = () => {
        $('auth-btn').textContent = user ? '👤 ' + user + (me && me.role && me.role !== 'user' ? ' · ' + me.role : '') : 'Войти';
        const staff = !!(me && ['moderator', 'admin'].includes(me.role));
        $('tb-mod').classList.toggle('hidden', !staff);
        if (!staff && tab === 'mod') showTab('home');
        if (tab === 'profile') renderProfile();
        if (tab === 'submit') initSubmit();
    };
    async function loadMe() {
        if (!token) { me = null; renderAuth(); return; }
        try { me = await call({ action: 'me' }, { headers: { Authorization: 'Bearer ' + token } }); } catch { me = null; }
        renderAuth();
    }
    function logout() { token = ''; user = ''; me = null; ls.set('rd_token', ''); ls.set('rd_user', ''); renderAuth(); }
    async function authDo(kind) {
        const m = $('auth-msg'); m.textContent = '…';
        try {
            const d = await post(kind, { username: $('auth-user').value.trim(), password: $('auth-pass').value });
            token = d.token; user = d.username; ls.set('rd_token', token); ls.set('rd_user', user);
            $('auth-modal').classList.add('hidden'); $('auth-pass').value = ''; m.textContent = '';
            renderAuth(); await syncNow(); renderContinue(); renderLists(); loadMe();
        } catch (e) { m.textContent = e.message; }
    }
    $('auth-btn').onclick = () => {
        if (user) showTab('profile');
        else $('auth-modal').classList.remove('hidden');
    };
    $('auth-login').onclick = () => authDo('login');
    $('auth-register').onclick = () => authDo('register');
    $('auth-close').onclick = () => $('auth-modal').classList.add('hidden');

    // ---------- Главная ----------
    const norm = x => ({ id: x.url, title: x.title, cover: x.cover, ru: x.ru, ch: x.ch, lang: x.lang });
    const proxy = u => u.indexOf(WORKER_URL) === 0 ? u : WORKER_URL + '?action=img&url=' + encodeURIComponent(u);
    function setCover(i, url) {
        i.onerror = null;
        if (!url) { i.removeAttribute('src'); return; }
        if (url.indexOf(WORKER_URL) === 0) { i.src = url; return; }
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
    function showDetail(m) { renderDetail(m); go('detail'); }
    async function renderDetail(m) {
        dm = m; detail.scrollTop = 0;
        $('d-title').textContent = m.title; setCover($('d-cover'), m.cover);
        $('d-meta').textContent = ''; $('d-tags').textContent = ''; $('d-ru').className = 'd-ru'; $('d-ru').textContent = ''; $('d-desc').textContent = 'Загрузка описания…';
        renderDetailBtns();
        $('d-block').classList.toggle('hidden', !(me && ['moderator', 'admin'].includes(me.role)) || String(m.id).indexOf('rd-') === 0);
        if (String(m.id).indexOf('rd-') === 0) loadSocial(m); else $('d-social').classList.add('hidden');
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
    $('d-back').onclick = () => window.history.back();
    $('d-read').onclick = () => openManga(dm);
    $('d-plan').onclick = () => setStatus('plan');
    $('d-done').onclick = () => setStatus('done');

    // ---------- Поиск и фильтры ----------
    const F = { order: 'rel', ru: false, status: new Set(), origin: new Set(), rating: new Set(), ch: '', tags: new Map() };
    const OPT = {
        order: [['rel', 'Релевантность'], ['pop', 'Популярность'], ['rate', 'Рейтинг'], ['upd', 'Обновления'], ['new', 'Новинки'], ['az', 'По названию']],
        status: [['ongoing', 'Выходит'], ['completed', 'Завершён'], ['hiatus', 'Перерыв'], ['cancelled', 'Отменён']],
        origin: [['ja', 'Манга'], ['ko', 'Манхва'], ['zh', 'Маньхуа']],
        rating: [['safe', 'Для всех'], ['suggestive', '16+']],
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
        b.onclick = () => window.history.back();
        w.append(b); reader.append(w);
    }

    async function openManga(m) {
        enterFs(); manga = m; chapters = [];
        if (view === 'home') { renderDetail(m); window.history.pushState({ v: 'detail' }, ''); view = 'detail'; }
        go('reader'); ui(false);
        $('rt-title').textContent = m.title; $('rt-chap').textContent = '';
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
        curIdx = i; $('report-ch').classList.toggle('hidden', String(manga.id).indexOf('rd-') !== 0); chapterSelect.value = i; $('rt-chap').textContent = chapters[i].title; closeSettings(); ui(false);
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

    // Тап по экрану показывает/прячет плашку с названием и нижнюю панель
    reader.addEventListener('click', () => {
        if (settingsMenu.classList.contains('open')) { closeSettings(); return; }
        ui(navPanel.classList.contains('nav-hidden'));
    });
    readerTop.onclick = () => window.history.back();
    reader.addEventListener('touchstart', e => { touching = true; clearTimeout(touchTimer); sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY; }, { passive: true });
    reader.addEventListener('touchend', e => {
        touchTimer = setTimeout(() => { touching = false; }, 1200);
        if (restoring) return;
        const dx = sx - e.changedTouches[0].clientX, dy = sy - e.changedTouches[0].clientY, h = mode() === 'paged-horizontal';
        if (standalone && sx < 28 && dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - lastPop > 700) { window.history.back(); return; }
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
    function diagText() {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0';
        document.body.append(probe);
        const cs = getComputedStyle(probe), st = cs.paddingTop, sb = cs.paddingBottom; probe.remove();
        const vv = window.visualViewport;
        return 'inner ' + innerWidth + 'x' + innerHeight + '; visual ' + (vv ? Math.round(vv.height) : '-') + '; screen ' + screen.width + 'x' + screen.height +
            '; safe top ' + st + ' bottom ' + sb + '; app-h ' + getComputedStyle(document.documentElement).getPropertyValue('--app-h') +
            '; standalone ' + standalone + '; ' + navigator.userAgent;
    }
    function openSettings() { settingsMenu.classList.add('open'); ui(false); try { $('diag').textContent = diagText(); } catch {} }
    function closeSettings() { settingsMenu.classList.remove('open'); }
    $('nav-settings').onclick = e => { e.stopPropagation(); openSettings(); };
    $('close-menu').onclick = closeSettings;
    $('nav-prev').onclick = () => openChapter(curIdx - 1);
    $('nav-next').onclick = () => openChapter(curIdx + 1);
    $('nav-top').onclick = () => reader.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    chapterSelect.onchange = () => openChapter(+chapterSelect.value);
    $('home-btn').onclick = () => { closeSettings(); window.history.go(-2); };
    const setMode = v => { reader.className = 'mode-' + v; ls.set('rd_mode', v); };
    $('scroll-mode').onchange = e => {
        setMode(e.target.value); auto = false; toggle.checked = false; cancelAnimationFrame(raf);
        reader.scrollTo(0, 0); setTimeout(progress, 50);
    };
    const setBg = v => { document.documentElement.style.setProperty('--page-bg', v); ls.set('rd_bg', v); };
    $('bg-color').onchange = e => setBg(e.target.value);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && manga && !restoring && view === 'reader') { saveProgress(); syncNow(); }
    });

    // ---------- Разделы: каталог, предложить, профиль, модерация ----------
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const api = (params, opts = {}) => call(params, { ...opts, headers: { ...(opts.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    const postForm = (action, fd) => call({ action }, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
    async function blobUrl(url) {
        const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return URL.createObjectURL(await r.blob());
    }
    const ST_RU = { pending: 'На проверке', approved: 'Одобрено', rejected: 'Отклонено', revision: 'Нужны правки' };
    const ROLE_RU = { user: 'Читатель', moderator: 'Модератор', admin: 'Администратор' };
    let tab = 'home', subMode = 1, catOff = 0, catQ = '';

    function showTab(t) {
        tab = t;
        ['home', 'catalog', 'submit', 'profile', 'mod'].forEach(n => {
            $('tab-' + n).classList.toggle('hidden', n !== t);
            $('tb-' + n).classList.toggle('on', n === t);
        });
        startScreen.scrollTop = 0;
        if (t === 'catalog') loadCatalog(true);
        if (t === 'submit') initSubmit();
        if (t === 'profile') renderProfile();
        if (t === 'mod') loadQueue();
    }
    [...document.querySelectorAll('.tabbtn')].forEach(b => { b.onclick = () => showTab(b.dataset.tab); });

    // каталог библиотеки Reader
    async function loadCatalog(reset) {
        const g = $('cat-grid');
        if (reset) { catOff = 0; g.textContent = 'Загрузка…'; $('cat-more').classList.add('hidden'); }
        try {
            const d = await call({ action: 'lib_list', offset: catOff, q: catQ });
            if (reset) g.textContent = '';
            if (reset && !d.entries.length) { const m = el('div', 'gmsg', catQ ? 'Ничего не найдено' : 'Пока нет произведений. Предложи первое!'); g.append(m); }
            d.entries.forEach(x => g.append(card(norm(x))));
            catOff += d.entries.length; $('cat-more').classList.toggle('hidden', d.entries.length < 30);
        } catch (e) { if (reset) g.textContent = 'Ошибка: ' + e.message; }
    }
    $('cat-btn').onclick = () => { catQ = $('cat-q').value.trim(); loadCatalog(true); };
    $('cat-q').addEventListener('keypress', e => { if (e.key === 'Enter') $('cat-btn').click(); });
    $('cat-more').onclick = () => loadCatalog(false);

    // предложить произведение или главу
    function initSubmit() {
        const out = !token;
        $('sub-gate').classList.toggle('hidden', !out);
        $('sub-title-form').classList.toggle('hidden', out || subMode !== 1);
        $('sub-chap-form').classList.toggle('hidden', out || subMode !== 2);
        $('sub-t1').classList.toggle('on', subMode === 1); $('sub-t2').classList.toggle('on', subMode === 2);
        if (!out && subMode === 2) loadTitleOptions();
    }
    $('sub-t1').onclick = () => { subMode = 1; initSubmit(); };
    $('sub-t2').onclick = () => { subMode = 2; initSubmit(); };
    $('sub-login').onclick = () => $('auth-modal').classList.remove('hidden');

    async function loadTitleOptions() {
        const sel = $('sc-title'); sel.innerHTML = '';
        const add = (label, items) => {
            if (!items.length) return;
            const g = document.createElement('optgroup'); g.label = label;
            items.forEach(t => g.append(new Option(t.title + (t.status && t.status !== 'published' ? ' (на проверке)' : ''), t.id)));
            sel.append(g);
        };
        try {
            const [mine, lib] = await Promise.all([api({ action: 'my_titles' }), call({ action: 'lib_list', offset: 0 })]);
            add('Мои произведения', mine.titles);
            add('Библиотека', lib.entries.filter(x => !mine.titles.some(t => 'rd-' + t.id === x.url)).map(x => ({ id: x.url, title: x.title })));
        } catch (e) { $('sc-msg').textContent = e.message; }
        if (!sel.options.length) sel.add(new Option('Пока нет произведений', ''));
    }

    $('st-send').onclick = async () => {
        const m = $('st-msg'), t = $('st-title').value.trim();
        m.className = 'fmsg';
        if (t.length < 2) { m.textContent = 'Введи название'; return; }
        if (!$('st-rules').checked) { m.textContent = 'Подтверди соблюдение правил'; return; }
        const fd = new FormData(); fd.append('title', t); fd.append('description', $('st-desc').value.trim());
        const f = $('st-cover').files[0]; if (f) fd.append('cover', f);
        $('st-send').disabled = true; m.textContent = 'Отправляю…';
        try {
            await postForm('lib_submit', fd);
            m.className = 'fmsg ok'; m.textContent = 'Отправлено на проверку. Статус смотри в профиле.';
            $('st-title').value = ''; $('st-desc').value = ''; $('st-cover').value = '';
        } catch (e) { m.textContent = e.message; }
        finally { $('st-send').disabled = false; }
    };

    // распаковка ZIP/CBZ выполняется в браузере (на бесплатном плане Cloudflare сервер этого не потянет)
    let fflatePromise;
    const loadFflate = () => fflatePromise || (fflatePromise = new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
        s.onload = () => res(window.fflate);
        s.onerror = () => { fflatePromise = null; rej(new Error('Не удалось загрузить модуль распаковки. Загрузи картинки по отдельности.')); };
        document.head.append(s);
    }));
    const IMG_RE = /\.(jpe?g|png|webp)$/i;
    async function collectPages(files) {
        const pages = [];
        for (const f of files) {
            if (/\.(zip|cbz)$/i.test(f.name)) {
                const ff = await loadFflate();
                const out = ff.unzipSync(new Uint8Array(await f.arrayBuffer()), {
                    filter: e => IMG_RE.test(e.name) && !/(^|\/)(\.|__MACOSX)/.test(e.name) && e.originalSize <= 8 * 1048576 });
                Object.keys(out).forEach(n => pages.push({ name: n, blob: new Blob([out[n]]) }));
            } else if (IMG_RE.test(f.name)) pages.push({ name: f.name, blob: f });
        }
        pages.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
        return pages;
    }
    async function uploadPage(id, n, blob) {
        for (let attempt = 0; ; attempt++) {
            try {
                const r = await fetch(WORKER_URL + '?' + new URLSearchParams({ action: 'chapter_page', id, n }),
                    { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: blob });
                const d = await r.json(); if (d.error) throw new Error(d.error); return;
            } catch (e) {
                if (attempt >= 1) throw new Error('Страница ' + n + ': ' + e.message);
                await new Promise(r => setTimeout(r, 800));
            }
        }
    }
    $('sc-send').onclick = async () => {
        const m = $('sc-msg'), btn = $('sc-send'), prog = $('sc-prog');
        const tid = $('sc-title').value, num = $('sc-num').value.trim().replace(',', '.'), files = [...$('sc-files').files];
        m.className = 'fmsg';
        if (!tid) { m.textContent = 'Выбери произведение'; return; }
        if (!num || isNaN(parseFloat(num))) { m.textContent = 'Введи номер главы'; return; }
        if (!files.length) { m.textContent = 'Выбери файлы'; return; }
        if (!$('sc-rules').checked) { m.textContent = 'Подтверди соблюдение правил'; return; }
        btn.disabled = true; prog.classList.remove('hidden'); prog.value = 0;
        try {
            m.textContent = 'Подготавливаю страницы…';
            const pages = await collectPages(files);
            if (!pages.length) throw new Error('Не нашёл ни одной картинки (JPG, PNG, WebP)');
            if (pages.length > 200) throw new Error('Слишком много страниц: максимум 200');
            const { id } = await post('chapter_start', { title_id: tid, number: num, name: $('sc-name').value.trim() });
            for (let i = 0; i < pages.length; i++) {
                m.textContent = 'Загружаю страницу ' + (i + 1) + ' из ' + pages.length + '…';
                await uploadPage(id, i + 1, pages[i].blob);
                prog.value = Math.round((i + 1) / pages.length * 100);
            }
            await post('chapter_finish', { id });
            m.className = 'fmsg ok'; m.textContent = 'Готово: ' + pages.length + ' стр. отправлено на проверку.';
            $('sc-files').value = ''; $('sc-num').value = ''; $('sc-name').value = '';
        } catch (e) { m.textContent = e.message; }
        finally { btn.disabled = false; prog.classList.add('hidden'); }
    };

    // профиль
    async function renderProfile() {
        const box = $('prof-body'); box.textContent = '';
        if (!token) {
            box.append(el('p', 'note', 'Войди, чтобы сохранять прогресс, предлагать произведения и главы.'));
            const b = el('button', 'btn', 'Войти или зарегистрироваться'); b.onclick = () => $('auth-modal').classList.remove('hidden'); box.append(b);
            return;
        }
        const head = el('div', 'pcard'); head.append(el('h3', '', user), el('p', 'note', ROLE_RU[(me && me.role) || 'user']));
        const out = el('button', 'btn ghost', 'Выйти'); out.onclick = () => { if (confirm('Выйти из аккаунта? Прогресс останется на сервере.')) logout(); };
        head.append(out); box.append(head);
        const favs = el('div', 'grid'); box.append(el('h4', 'sh', 'Избранное'), favs);
        api({ action: 'fav_list' }).then(d => { favs.textContent = d.entries.length ? '' : 'Пока пусто: добавляй произведения Reader в избранное на их странице.'; d.entries.forEach(x => favs.append(card(norm(x)))); }).catch(() => {});
        box.append(el('h4', 'sh', 'Мои заявки'));
        const list = el('div', 'pcard', 'Загрузка…'); box.append(list);
        try {
            const d = await api({ action: 'my_subs' });
            list.textContent = d.subs.length ? '' : 'Заявок пока нет';
            d.subs.forEach(s => {
                const r = el('div', 'srow'), t = el('div');
                t.append(el('b', '', s.type === 'chapter' ? (s.title || 'Произведение') + ', глава ' + (s.chapter_number ?? '') : (s.title || 'Произведение')));
                if (s.moderator_note) t.append(el('div', 'note', 'Комментарий модератора: ' + s.moderator_note));
                r.append(t, el('span', 'st st-' + s.status, ST_RU[s.status] || s.status)); list.append(r);
            });
        } catch (e) { list.textContent = 'Ошибка: ' + e.message; }
    }

    // модерация
    async function decide(id, decision, note) {
        for (;;) { const d = await post('mod_decide', { id, decision, note }); if (!d.moving) return; }
    }
    function queueItem(q) {
        const c = el('div', 'pcard'), chap = q.type === 'chapter';
        c.append(el('h3', '', chap ? (q.title || 'Произведение') + ', глава ' + (q.chapter_number ?? '') : (q.title || 'Без названия')));
        c.append(el('p', 'note', (chap ? 'Новая глава' + (q.page_count ? ' · ' + q.page_count + ' стр.' : '') : 'Новое произведение') + ' · автор: ' + (q.author || '—')));
        if (!chap && q.description) c.append(el('p', '', q.description));
        const pv = el('div', 'pv'); c.append(pv);
        if (q.cover_url) blobUrl(q.cover_url).then(u => { const i = new Image(); i.src = u; i.className = 'pvc'; pv.append(i); }).catch(() => {});
        if (chap) {
            const b = el('button', 'btn ghost', 'Посмотреть страницы');
            b.onclick = async () => {
                b.disabled = true; b.textContent = 'Загружаю…';
                try {
                    const d = await api({ action: 'mod_pages', id: q.chapter_id });
                    for (const p of d.pages) { const i = new Image(); i.src = await blobUrl(p.url); i.className = 'pvp'; pv.append(i); }
                    b.remove();
                } catch (e) { b.textContent = 'Ошибка: ' + e.message; b.disabled = false; }
            };
            c.append(b);
        }
        const row = el('div', 'arow'), msg = el('p', 'fmsg'), btns = [];
        [['approve', 'Одобрить', ''], ['revision', 'На доработку', ' ghost'], ['reject', 'Отклонить', ' ghost']].forEach(([dec, label, cls]) => {
            const b = el('button', 'btn' + cls, label); btns.push(b);
            b.onclick = async () => {
                let note = '';
                if (dec !== 'approve') { note = prompt('Причина (необязательно):'); if (note === null) return; }
                btns.forEach(x => { x.disabled = true; }); msg.textContent = 'Сохраняю…';
                try { await decide(q.id, dec, note); c.remove(); }
                catch (e) { msg.textContent = e.message; btns.forEach(x => { x.disabled = false; }); }
            };
            row.append(b);
        });
        c.append(row, msg);
        return c;
    }
    async function loadQueue() {
        const box = $('mod-list'); box.textContent = 'Загрузка…';
        $('mod-admin').classList.toggle('hidden', !(me && me.role === 'admin'));
        try {
            const d = await api({ action: 'mod_queue' });
            box.textContent = d.queue.length ? '' : 'Заявок на проверку нет';
            d.queue.forEach(q => box.append(queueItem(q)));
        } catch (e) { box.textContent = 'Ошибка: ' + e.message; }
        loadReports(); loadBlocked();
    }
    function reportItem(r) {
        const c = el('div', 'pcard');
        c.append(el('h3', '', ({ title: 'Произведение', chapter: 'Глава', comment: 'Комментарий' })[r.target_type] + (r.ctx ? ': ' + String(r.ctx).slice(0, 120) : '')));
        c.append(el('p', 'note', 'Причина: ' + r.reason + ' · от ' + (r.reporter || '—')));
        const row = el('div', 'arow'), msg = el('p', 'fmsg'), btns = [];
        [['hide', 'Скрыть контент', ''], ['dismiss', 'Отклонить жалобу', ' ghost']].forEach(([dec, label, cls]) => {
            const b = el('button', 'btn' + cls, label); btns.push(b);
            b.onclick = async () => {
                if (dec === 'hide' && !confirm('Скрыть этот контент для всех пользователей?')) return;
                btns.forEach(x => { x.disabled = true; });
                try { await post('mod_report_decide', { id: r.id, decision: dec }); c.remove(); }
                catch (e) { msg.textContent = e.message; btns.forEach(x => { x.disabled = false; }); }
            };
            row.append(b);
        });
        c.append(row, msg);
        return c;
    }
    async function loadReports() {
        const box = $('mod-reports'); box.textContent = 'Загрузка…';
        try {
            const d = await api({ action: 'mod_reports' });
            box.textContent = d.reports.length ? '' : 'Жалоб нет';
            d.reports.forEach(r => box.append(reportItem(r)));
        } catch (e) { box.textContent = 'Ошибка: ' + e.message; }
    }
    $('d-block').onclick = async () => {
        if (!dm || !confirm('Скрыть это произведение на сайте для всех?')) return;
        try { await post('block_title', { id: dm.id, title: dm.title }); alert('Произведение скрыто.'); window.history.back(); }
        catch (e) { alert(e.message); }
    };
    async function loadBlocked() {
        const box = $('mb-list'); box.textContent = '';
        try {
            const d = await api({ action: 'blocklist' });
            d.blocked.slice().reverse().forEach(b => {
                const r = el('div', 'srow'), t = el('div', '', b.title);
                const u = el('button', 'link', 'Вернуть');
                u.onclick = async () => { try { await post('unblock_title', { id: b.id }); loadBlocked(); } catch (e) { alert(e.message); } };
                r.append(t, u); box.append(r);
            });
        } catch (e) { box.textContent = 'Ошибка: ' + e.message; }
    }
    $('mb-add').onclick = async () => {
        const m = $('mb-msg'); m.className = 'fmsg'; m.textContent = '…';
        try { await post('block_title', { id: $('mb-id').value.trim(), title: '' }); m.className = 'fmsg ok'; m.textContent = 'Скрыто'; $('mb-id').value = ''; loadBlocked(); }
        catch (e) { m.textContent = e.message; }
    };
    $('ma-diag').onclick = async () => {
        const pre = $('ma-pre'); pre.classList.remove('hidden'); pre.textContent = '…';
        try { const d = await api({ action: 'status' }); pre.textContent = JSON.stringify(d.schema || d, null, 1); }
        catch (e) { pre.textContent = e.message; }
    };
    $('ma-send').onclick = async () => {
        const m = $('ma-msg'); m.className = 'fmsg'; m.textContent = '…';
        try { await post('setrole', { username: $('ma-user').value.trim(), role: $('ma-role').value }); m.className = 'fmsg ok'; m.textContent = 'Роль изменена'; }
        catch (e) { m.textContent = e.message; }
    };

    // ---------- Оценки, избранное, комментарии, жалобы (произведения Reader) ----------
    const needLogin = () => { $('auth-modal').classList.remove('hidden'); };
    let rpTarget = null;
    function openReport(type, id) {
        if (!token) { needLogin(); return; }
        rpTarget = { type, id }; $('rp-msg').textContent = ''; $('rp-text').value = '';
        $('report-modal').classList.remove('hidden');
    }
    $('rp-close').onclick = () => $('report-modal').classList.add('hidden');
    $('rp-send').onclick = async () => {
        const m = $('rp-msg'), extra = $('rp-text').value.trim(); m.className = 'fmsg'; m.textContent = '…';
        try {
            await post('report', { target_type: rpTarget.type, target_id: rpTarget.id, reason: $('rp-cat').value + (extra ? ': ' + extra : '') });
            m.className = 'fmsg ok'; m.textContent = 'Жалоба отправлена модераторам.';
            setTimeout(() => $('report-modal').classList.add('hidden'), 1200);
        } catch (e) { m.textContent = e.message; }
    };
    $('report-ch').onclick = () => { if (chapters[curIdx]) openReport('chapter', chapters[curIdx].id); };

    async function loadSocial(m) {
        const box = $('d-social'); box.classList.remove('hidden'); box.textContent = '';
        let s;
        try { s = await api({ action: 'social', id: m.id }); }
        catch (e) { box.textContent = 'Не удалось загрузить отзывы: ' + e.message; return; }
        if (dm !== m) return;
        const act = fn => async () => { if (!token) { needLogin(); return; } try { await fn(); loadSocial(m); } catch (e) { alert(e.message); } };

        const rate = el('div', 'pcard');
        rate.append(el('h3', '', s.votes ? 'Оценка читателей: ' + s.avg + ' (' + s.votes + ')' : 'Оценок пока нет'));
        rate.append(el('p', 'note', s.mine ? 'Твоя оценка: ' + s.mine + '. Её можно изменить.' : 'Поставь оценку от 1 до 10'));
        const nums = el('div', 'rates');
        for (let i = 1; i <= 10; i++) {
            const b = el('button', 'rate' + (s.mine === i ? ' on' : ''), String(i));
            b.onclick = act(() => post('rating_set', { id: m.id, score: i })); nums.append(b);
        }
        const row = el('div', 'arow');
        const fav = el('button', 'btn ghost' + (s.fav ? ' on' : ''), (s.fav ? '♥ В избранном' : '♡ В избранное') + ' · ' + s.favs);
        fav.onclick = act(() => post('fav_set', { id: m.id, on: !s.fav }));
        const rep = el('button', 'btn ghost', 'Пожаловаться'); rep.onclick = () => openReport('title', m.id);
        row.append(fav, rep); rate.append(nums, row); box.append(rate);

        box.append(el('h4', 'sh', 'Комментарии (' + s.comments + ')'));
        const form = el('div', 'pcard'), ta = el('textarea');
        ta.maxLength = 1000; ta.rows = 3; ta.placeholder = token ? 'Напиши комментарий…' : 'Войди, чтобы комментировать';
        const send = el('button', 'btn', 'Отправить');
        send.onclick = async () => {
            if (!token) { needLogin(); return; }
            const t = ta.value.trim(); if (!t) return; send.disabled = true;
            try { await post('comment_add', { id: m.id, body: t }); loadSocial(m); } catch (e) { alert(e.message); send.disabled = false; }
        };
        form.append(ta, send); box.append(form);
        const list = el('div'); box.append(list);
        try {
            const d = await api({ action: 'comments_list', id: m.id });
            if (!d.comments.length) list.append(el('p', 'note', 'Комментариев пока нет.'));
            d.comments.forEach(c => {
                const r = el('div', 'pcard'), top = el('div', 'ctop'), crow = el('div', 'crow');
                top.append(el('b', '', c.user || 'Пользователь'), el('span', 'note', new Date(c.created_at).toLocaleDateString('ru-RU') + (c.edited ? ' · изменено' : '')));
                r.append(top, el('p', 'cbody', c.body));
                const mk = (label, fn) => { const b = el('button', 'link', label); b.onclick = fn; crow.append(b); };
                if (c.mine) {
                    mk('Изменить', act(async () => { const t = prompt('Изменить комментарий:', c.body); if (t && t.trim()) await post('comment_edit', { id: c.id, body: t.trim() }); }));
                    mk('Удалить', act(async () => { if (confirm('Удалить комментарий?')) await post('comment_delete', { id: c.id }); }));
                } else mk('Пожаловаться', () => openReport('comment', c.id));
                if (d.staff && !c.mine) mk('Скрыть', act(async () => { await post('comment_hide', { id: c.id }); }));
                r.append(crow); list.append(r);
            });
        } catch (e) { list.append(el('p', 'note', 'Ошибка: ' + e.message)); }
    }

    // подгонка высоты экрана
    try { $('h-adj').value = parseInt(localStorage.getItem('rd_hadj')) || 0; } catch {}
    $('h-adj').oninput = e => { try { localStorage.setItem('rd_hadj', e.target.value); } catch {} setH(); try { $('diag').textContent = diagText(); } catch {} };

    // ---------- Полный экран в настройках ----------
    if (!fsOK) $('fs-row').classList.add('hidden');
    $('fs-toggle').checked = ls.get('rd_fs', true);
    $('fs-toggle').onchange = e => { ls.set('rd_fs', e.target.checked); if (e.target.checked) enterFs(); else leaveFs(); };
    if (isIOS && !standalone) $('fs-hint').textContent = 'Для полного экрана на iPhone: «Поделиться» → «На экран «Домой»», затем открывай читалку с иконки.';

    // ---------- Диагностика экрана: 5 быстрых нажатий на логотип ----------
    (function () {
        let taps = 0, last = 0, box = null, timer = 0;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
        document.body.append(probe);
        const text = () => {
            const cs = getComputedStyle(probe), vv = window.visualViewport, r = el => { const b = el.getBoundingClientRect(); return Math.round(b.top) + '..' + Math.round(b.bottom); };
            return ['innerHeight: ' + innerHeight + '  innerWidth: ' + innerWidth,
                'visualViewport: ' + (vv ? Math.round(vv.height) + ' (top ' + Math.round(vv.offsetTop) + ')' : 'нет'),
                'screen: ' + screen.width + 'x' + screen.height + '  dpr ' + devicePixelRatio,
                'clientHeight html: ' + document.documentElement.clientHeight,
                'safe top/bottom: ' + cs.paddingTop + ' / ' + cs.paddingBottom,
                '--app-h: ' + getComputedStyle(document.documentElement).getPropertyValue('--app-h'),
                'standalone: ' + navigator.standalone + ' / mq ' + matchMedia('(display-mode: standalone)').matches + ' / fs ' + matchMedia('(display-mode: fullscreen)').matches,
                'view: ' + view + '  start ' + r(startScreen) + '  reader ' + r(readerScreen),
                navigator.userAgent].join('\n');
        };
        const show = () => {
            if (box) { box.remove(); box = null; clearInterval(timer); return; }
            box = document.createElement('div'); box.id = 'dbg'; document.body.append(box);
            box.onclick = show; const upd = () => { box.textContent = text() + '\n\n(нажми, чтобы закрыть)'; }; upd(); timer = setInterval(upd, 1000);
        };
        $('logo').onclick = () => { const n = Date.now(); taps = n - last < 700 ? taps + 1 : 1; last = n; if (taps >= 5) { taps = 0; show(); } };
    })();

    // ---------- Запуск ----------
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
    const savedMode = ls.get('rd_mode', 'webtoon'); $('scroll-mode').value = savedMode; setMode(savedMode);
    const savedBg = ls.get('rd_bg', '#000000'); $('bg-color').value = savedBg; setBg(savedBg);
    renderAuth(); loadHome();
    if (token) { syncNow().then(() => { renderContinue(); renderLists(); }); loadMe(); }
});

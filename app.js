document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const WORKER_URL = 'https://empty-firefly-874a.niko-rad3.workers.dev/';
    const startScreen = $('start-screen'), readerScreen = $('reader-screen'), reader = $('reader');
    const settingsMenu = $('settings-menu'), navPanel = $('reader-navigation'), chapterSelect = $('chapter-select');
    const progressBar = $('progress-bar'), searchInput = $('search-input'), toggle = $('autoscroll-toggle');
    const mode = () => $('scroll-mode').value;

    const ls = {
        get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    };
    let history = ls.get('rd_hist', {}), token = ls.get('rd_token', ''), user = ls.get('rd_user', '');
    let manga = null, chapters = [], curIdx = 0, restoring = false, restoreTimer, contRow;
    let auto = false, raf = 0, fpos = 0, touching = false, touchTimer, sx = 0, sy = 0, st, syncT;

    // ---------- API ----------
    async function call(params, opts = {}) {
        const r = await fetch(WORKER_URL + '?' + new URLSearchParams(params), opts);
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        return d;
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
        try { const d = await post('sync', { history }); history = d.history; ls.set('rd_hist', history); }
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
            renderAuth(); await syncNow(); renderContinue();
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
    const norm = x => ({ id: x.url, title: x.title, cover: x.cover });
    function card(m, sub) {
        const d = document.createElement('div'); d.className = 'card';
        const i = new Image(); i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.alt = '';
        if (m.cover) i.src = m.cover;
        const p = document.createElement('p'); p.textContent = m.title;
        d.append(i, p);
        if (sub) { const s = document.createElement('small'); s.textContent = sub; d.append(s); }
        d.onclick = () => openManga({ id: m.id, title: m.title, cover: m.cover });
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
        const items = Object.values(history).sort((a, b) => b.ts - a.ts).slice(0, 12);
        contRow.parentNode.classList.toggle('hidden', !items.length);
        contRow.textContent = '';
        items.forEach(h => contRow.append(card(h, h.chTitle)));
    }
    function loadHome() {
        $('home').innerHTML = '';
        contRow = section('Продолжить чтение'); renderContinue();
        [['updated', 'Обновления'], ['top', 'Рекомендуем'], ['popular', 'Популярное'], ['new', 'Новинки']].forEach(async ([type, title]) => {
            const row = section(title); row.textContent = 'Загрузка…';
            try {
                const d = await call({ action: 'feed', type });
                row.textContent = '';
                d.entries.forEach(x => row.append(card(norm(x))));
            } catch (e) { row.textContent = 'Не удалось загрузить: ' + e.message; }
        });
    }
    async function search(q) {
        q = q.trim(); if (!q) return;
        const box = $('search-results');
        box.className = 'grid'; box.textContent = 'Ищу…'; $('home').classList.add('hidden');
        try {
            const d = await call({ action: 'search', query: q });
            box.textContent = d.entries.length ? '' : 'Ничего не найдено';
            d.entries.forEach(x => box.append(card(norm(x))));
        } catch (e) { box.textContent = 'Ошибка: ' + e.message; }
    }
    $('search-btn').onclick = () => search(searchInput.value);
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') search(searchInput.value); });
    searchInput.addEventListener('input', () => {
        if (!searchInput.value) { $('search-results').className = 'hidden'; $('home').classList.remove('hidden'); }
    });

    // ---------- Чтение ----------
    const msg = (t, bad) => { reader.innerHTML = ''; const d = document.createElement('div'); d.className = 'msg' + (bad ? ' bad' : ''); d.textContent = t; reader.append(d); };

    async function openManga(m) {
        manga = m; chapters = [];
        startScreen.classList.add('hidden'); readerScreen.classList.remove('hidden'); navPanel.classList.add('nav-hidden');
        msg('Загрузка списка глав…');
        try {
            const d = await call({ action: 'details', mangaUrl: m.id });
            chapters = d.chapters.map(c => ({ id: c.url, title: `${c.title} ${c.number}` }));
            if (!chapters.length) throw new Error('Для этого тайтла нет глав, доступных для чтения');
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
                img.onerror = () => {
                    b.className = 'page-block err'; b.textContent = `Не загрузилась стр. ${n + 1}. Нажми, чтобы повторить`;
                    b.onclick = ev => { ev.stopPropagation(); b.onclick = null; b.className = 'page-block'; b.textContent = ''; b.append(img); img.src = p.url; };
                };
                img.src = p.url; b.append(img); reader.append(b);
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
    if (token) syncNow().then(renderContinue);
});

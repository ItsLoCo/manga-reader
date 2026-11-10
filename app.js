document.addEventListener('DOMContentLoaded', async () => {
    // --- ЭЛЕМЕНТЫ ИНТЕРФЕЙСА ---
    const startScreen = document.getElementById('start-screen');
    const readerScreen = document.getElementById('reader-screen');
    const reader = document.getElementById('reader');
    const menuTrigger = document.getElementById('menu-trigger');
    const settingsMenu = document.getElementById('settings-menu');
    const closeMenu = document.getElementById('close-menu');
    const scrollModeSelect = document.getElementById('scroll-mode');
    const bgColorSelect = document.getElementById('bg-color');
    const chapterSelect = document.getElementById('chapter-select');
    const progressBar = document.getElementById('progress-bar');
    const chapterPctText = document.getElementById('chapter-pct');
    const mangaPctText = document.getElementById('manga-pct');
    
    const navNavigationPanel = document.getElementById('reader-navigation');
    const navPrevBtn = document.getElementById('nav-prev');
    const navTopBtn = document.getElementById('nav-top');
    const navNextBtn = document.getElementById('nav-next');
    const navSettingsBtn = document.getElementById('nav-settings');

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const searchResults = document.getElementById('search-results');
    const autoscrollToggle = document.getElementById('autoscroll-toggle');
    const autoscrollSpeed = document.getElementById('autoscroll-speed');

    // --- СОСТОЯНИЕ ---
    let chaptersList = []; 
    let currentMangaId = null;
    let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
    const SWIPE_THRESHOLD = 60; 
    let isAutoscrollActive = false, autoscrollInterval = null, userInteracting = false, userInteractionTimeout = null;
    
    // --- КОНСТАНТЫ ---
    // 🔑 СЮДА ВСТАВЬ СВОЮ ЗАШИФРОВАННУЮ СТРОКУ (из шага 1)
    const ENCODED_KEYS = 'cGVyc29uYWwtY2xpZW50LTc5NDYyYmFiLTk1ODEtNGU2ZC05MzJlLTI3YjdiOGI2NDk5Zi04NGYzYzQ4ZiUzQWlFNmFxRUliVFY2WDc0MDVRRHRHN0NHQmMyeTlTMkFJJTNBbG9jbzY3JTNBa2hhcmJhbGFraA==';

    // --- ИНИЦИАЛИЗАЦИЯ MANGADEX SDK ---
    let client;
    try {
        // Подключаем библиотеку (она должна быть добавлена в index.html)
        client = new MangaDexClient();
        
        // Расшифровываем ключи
        const decoded = decodeURIComponent(atob(ENCODED_KEYS));
        const [clientId, clientSecret, username, password] = decoded.split(':');

        // Логинимся
        await client.login({
            clientId: clientId,
            clientSecret: clientSecret,
            username: username,
            password: password
        });
        console.log('Успешная авторизация в MangaDex');
    } catch (err) {
        console.error('Ошибка авторизации:', err);
        searchResults.innerHTML = '<div class="search-item" style="color:red;">Ошибка входа. Проверьте ключи.</div>';
        return; // Прерываем выполнение, если не смогли войти
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    // (Оставляем без изменений, копируем из прошлого кода)
    function updateProgressIndicators() { /* ... код без изменений ... */ }
    function startAutoscroll() { /* ... код без изменений ... */ }
    function stopAutoscroll() { /* ... код без изменений ... */ }
    function handleTouchStart(e) { /* ... код без изменений ... */ }
    function handleTouchEnd(e) { /* ... код без изменений ... */ }
    function handleTouchGestures() { /* ... код без изменений ... */ }
    async function switchChapter(index) { /* ... код без изменений ... */ }
    function restoreScrollPosition() { /* ... код без изменений ... */ }
    function openSettings() { /* ... код без изменений ... */ }
    function closeSettings() { /* ... код без изменений ... */ }

    // --- УПРАВЛЕНИЕ НАВИГАЦИЕЙ ---
    navTopBtn.addEventListener('click', () => { 
        reader.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); 
        localStorage.setItem('reader_last_position', 0); 
        setTimeout(updateProgressIndicators, 300); 
    });
    navPrevBtn.addEventListener('click', () => switchChapter(chapterSelect.selectedIndex - 1));
    navNextBtn.addEventListener('click', () => switchChapter(chapterSelect.selectedIndex + 1));

    // ==================== ЛОГИКА MANGADEX С БИБЛИОТЕКОЙ ====================

    // 1. ПОИСК
    async function searchManga(query) {
        if (!query.trim()) return;
        searchBtn.textContent = "Ищу...";
        searchBtn.disabled = true;
        searchResults.innerHTML = "";
        searchResults.classList.remove('hidden');
        
        try {
            // Используем метод search из библиотеки
            const mangaList = await client.manga.search({
                title: query,
                limit: 15
            });

            searchResults.innerHTML = '';
            if (mangaList.results.length === 0) {
                searchResults.innerHTML = '<div class="search-item">Ничего не найдено</div>';
            } else {
                mangaList.results.forEach(manga => {
                    const title = getMangaTitle(manga);
                    const item = document.createElement('div');
                    item.className = 'search-item';
                    item.textContent = title;
                    item.addEventListener('click', () => {
                        searchResults.classList.add('hidden');
                        searchInput.value = "";
                        currentMangaId = manga.id;
                        loadChaptersForManga(manga.id);
                    });
                    searchResults.appendChild(item);
                });
            }
        } catch (err) { 
            console.error("Search error:", err);
            searchResults.innerHTML = `<div class="search-item" style="color: #ff5555; font-size: 12px;">Ошибка: ${err.message}</div>`;
        } finally {
            searchBtn.textContent = "Найти 🔍"; 
            searchBtn.disabled = false;
        }
    }

    function getMangaTitle(manga) {
        const attrs = manga.attributes;
        if (attrs.title.ru) return attrs.title.ru;
        if (attrs.title.en) return attrs.title.en;
        const titleKeys = Object.keys(attrs.title);
        if (titleKeys.length > 0) return attrs.title[titleKeys[0]];
        return 'Без названия';
    }

    // 2. ЗАГРУЗКА ГЛАВ
    async function loadChaptersForManga(mangaId) {
        startScreen.classList.add('hidden');
        readerScreen.classList.remove('hidden');
        reader.innerHTML = `<div style="color:gray; text-align:center; padding:20px;">Загрузка списка глав...</div>`;

        try {
            // Получаем главы через библиотеку
            const feed = await client.manga.getFeed(mangaId, {
                translatedLanguage: ['ru', 'en'],
                order: { chapter: 'asc' },
                limit: 500
            });

            if (!feed.results || feed.results.length === 0) {
                throw new Error("Главы не найдены");
            }

            chaptersList = feed.results.map(ch => {
                const lang = ch.attributes.translatedLanguage === 'ru' ? '[RU]' : '[EN]';
                const chapterNum = ch.attributes.chapter || '?';
                return {
                    id: ch.id,
                    title: `${lang} Глава ${chapterNum}`
                };
            });

            chapterSelect.innerHTML = '';
            chaptersList.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = ch.title;
                chapterSelect.appendChild(opt);
            });

            const savedCh = localStorage.getItem('reader_last_chapter');
            let savedIndex = chaptersList.findIndex(c => c.id === savedCh);
            if (savedIndex === -1) savedIndex = 0;

            chapterSelect.selectedIndex = savedIndex;
            await switchChapter(savedIndex);

        } catch (err) {
            console.error("Chapters error:", err);
            reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка загрузки глав: ${err.message}</div>`;
        }
    }

    // 3. ЗАГРУЗКА СТРАНИЦ
    async function loadChapterPages(chapterId) {
        reader.innerHTML = `<div style="color:gray; text-align:center; padding:20px;">Загрузка страниц...</div>`;
        progressBar.style.width = '0%';

        try {
            // Получаем страницы через библиотеку
            const chapter = await client.chapter.get(chapterId);
            const pages = await client.chapter.getPages(chapterId);

            if (!pages || pages.length === 0) throw new Error("В главе нет страниц");

            reader.innerHTML = '';
            const observer = new IntersectionObserver((entries) => { 
                entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fade-in'); observer.unobserve(e.target); } }); 
            }, { root: reader, threshold: 0.05 });

            pages.forEach((pageUrl, index) => {
                const pageBlock = document.createElement('div');
                pageBlock.className = 'page-block';
                pageBlock.style.width = '100vw';
                pageBlock.style.display = 'flex';
                pageBlock.style.justifyContent = 'center';
                pageBlock.style.alignItems = 'flex-start';
                pageBlock.style.background = '#0d0d11';
                pageBlock.style.borderBottom = '2px solid #262636';
                pageBlock.style.opacity = '0';
                pageBlock.style.transition = 'opacity 0.4s ease';

                const img = document.createElement('img');
                img.src = pageUrl;
                img.alt = `Страница ${index + 1}`;
                img.style.width = '100%';
                img.style.maxWidth = '100vw';
                img.style.height = 'auto';
                img.style.display = 'block';
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';

                pageBlock.appendChild(img);
                reader.appendChild(pageBlock);
                observer.observe(pageBlock);

                img.onload = () => { pageBlock.style.opacity = '1'; };
            });

            reader.scrollTo(0, 0);
            setTimeout(updateProgressIndicators, 100);
            setTimeout(() => restoreScrollPosition(), 50);

        } catch (err) { 
            console.error("Pages error:", err);
            reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка загрузки страниц: ${err.message}</div>`; 
        }
    }

    // ... (остальной код для управления интерфейсом и слушателей остаётся без изменений) ...
    
    // Инициализация
    if ('serviceWorker' in navigator) { 
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed:', err)); 
    }
    const savedMode = localStorage.getItem('reader_scroll_mode') || 'webtoon';
    scrollModeSelect.value = savedMode;
    setScrollMode(savedMode);
    closeSettings();
});

document.addEventListener('DOMContentLoaded', () => {
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
    
    // --- КОНСТАНТЫ API ---
    // ИСПРАВЛЕНО: Заменен нерабочий corsproxy.io на бесплатный proxy.cors.dev
    const CORS_PROXY = 'tight-sea-1b3c.niko-rad3.workers.dev'; 
    const MANGADEX_API = 'https://api.mangadex.org';

    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

    function updateProgressIndicators() {
        const currentMode = scrollModeSelect.value;
        let scrolled = 0, totalScrollable = 0;

        if (currentMode === 'paged-horizontal') {
            scrolled = reader.scrollLeft;
            totalScrollable = reader.scrollWidth - reader.clientWidth;
        } else {
            scrolled = reader.scrollTop;
            totalScrollable = reader.scrollHeight - reader.clientHeight;
        }

        const chapterPercent = totalScrollable > 0 ? Math.round((scrolled / totalScrollable) * 100) : 0;
        progressBar.style.width = `${chapterPercent}%`;
        chapterPctText.textContent = `${chapterPercent}%`;

        if (chapterSelect.options.length > 0) {
            const currentChapterIndex = chapterSelect.selectedIndex + 1;
            const totalChaptersCount = chapterSelect.options.length;
            mangaPctText.textContent = `${Math.round((currentChapterIndex / totalChaptersCount) * 100)}%`;
        }
        
        navPrevBtn.disabled = chapterSelect.selectedIndex === 0;
        navNextBtn.disabled = chapterSelect.selectedIndex === chapterSelect.options.length - 1;
    }

    function startAutoscroll() {
        if (autoscrollInterval) cancelAnimationFrame(autoscrollInterval);
        function scrollLoop() {
            if (scrollModeSelect.value === 'paged-horizontal' || !isAutoscrollActive) return;
            if (!userInteracting) {
                reader.scrollTop += parseFloat(autoscrollSpeed.value) * 0.4;
                if (reader.scrollTop >= reader.scrollHeight - reader.clientHeight - 2) {
                    stopAutoscroll();
                    autoscrollToggle.checked = false;
                    if (chapterSelect.selectedIndex < chapterSelect.options.length - 1) switchChapter(chapterSelect.selectedIndex + 1);
                    return;
                }
            }
            autoscrollInterval = requestAnimationFrame(scrollLoop);
        }
        autoscrollInterval = requestAnimationFrame(scrollLoop);
    }

    function stopAutoscroll() {
        isAutoscrollActive = false;
        if (autoscrollInterval) cancelAnimationFrame(autoscrollInterval);
    }

    // --- СВАЙПЫ ---
    function handleTouchStart(e) {
        userInteracting = true; 
        clearTimeout(userInteractionTimeout);
        const t = e.changedTouches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
    }
    function handleTouchEnd(e) {
        userInteractionTimeout = setTimeout(() => { userInteracting = false; }, 1500);
        const t = e.changedTouches[0];
        touchEndX = t.clientX;
        touchEndY = t.clientY;
        handleTouchGestures();
    }

    readerScreen.addEventListener('touchstart', handleTouchStart, { passive: true });
    readerScreen.addEventListener('touchend', handleTouchEnd, { passive: true });

    function handleTouchGestures() {
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;
        const currentMode = scrollModeSelect.value;

        if (currentMode === 'paged-horizontal' && Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > SWIPE_THRESHOLD) {
            reader.scrollBy({ left: diffX > 0 ? reader.clientWidth : -reader.clientWidth, behavior: 'smooth' });
            return;
        }
        if (diffY > SWIPE_THRESHOLD && Math.abs(diffY) > Math.abs(diffX)) {
            const isAtEnd = currentMode === 'paged-horizontal' ? (reader.scrollLeft >= reader.scrollWidth - reader.clientWidth - 5) : (reader.scrollTop >= reader.scrollHeight - reader.clientHeight - 5);
            if (isAtEnd && chapterSelect.selectedIndex < chapterSelect.options.length - 1) switchChapter(chapterSelect.selectedIndex + 1);
        }
    }

    // --- ПЕРЕКЛЮЧЕНИЕ ГЛАВ ---
    async function switchChapter(index) {
        if (index < 0 || index >= chapterSelect.options.length) return;
        chapterSelect.selectedIndex = index;
        localStorage.setItem('reader_last_chapter', chapterSelect.value);
        localStorage.setItem('reader_last_position', 0);
        
        const wasAutoscroll = isAutoscrollActive;
        stopAutoscroll();
        
        closeSettings();
        navNavigationPanel.classList.add('nav-hidden');

        await loadChapterPages(chapterSelect.value);
        if (wasAutoscroll) setTimeout(startAutoscroll, 1000);
    }

    // --- УПРАВЛЕНИЕ НАВИГАЦИЕЙ ---
    navTopBtn.addEventListener('click', () => { 
        reader.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); 
        localStorage.setItem('reader_last_position', 0); 
        setTimeout(updateProgressIndicators, 300); 
    });
    navPrevBtn.addEventListener('click', () => switchChapter(chapterSelect.selectedIndex - 1));
    navNextBtn.addEventListener('click', () => switchChapter(chapterSelect.selectedIndex + 1));

    // ==================== ОСНОВНАЯ ЛОГИКА API ====================

    // 1. ПОИСК МАНГИ
         // Функция для поиска названия (сначала ищем русское, потом английское)
    function getMangaTitle(manga) {
        const attrs = manga.attributes;
        
        // 1. В первую очередь ищем русское название в альтернативных названиях
        if (attrs.altTitles && attrs.altTitles.length > 0) {
            for (const alt of attrs.altTitles) {
                if (alt.ru) return alt.ru;
            }
        }
        // 2. Если нет, смотрим в основном названии
        if (attrs.title.ru) return attrs.title.ru;
        
        // 3. Если русского нигде нет, берем английское
        if (attrs.title.en) return attrs.title.en;
        
        // 4. Если вообще ничего нет
        const titleKeys = Object.keys(attrs.title);
        if (titleKeys.length > 0) return attrs.title[titleKeys[0]];
        return 'Без названия';
    }

        // 1. ПОИСК МАНГИ (С ОТЛАДКОЙ)
    async function searchManga(query) {
        if (!query.trim()) return;
        searchBtn.textContent = "Ищу...";
        searchBtn.disabled = true;
        searchResults.innerHTML = "";
        searchResults.classList.remove('hidden');
        
        try {
            // Убрал order[relevance]=desc, чтобы уменьшить шанс ошибки 400
            const targetUrl = `${MANGADEX_API}/manga?title=${encodeURIComponent(query)}&limit=15&includes[]=cover_art`;
            const finalUrl = CORS_PROXY + encodeURIComponent(targetUrl);
            
            console.log("Отправляем на:", finalUrl);

            const response = await fetch(finalUrl);
            
            // Если сервер вернул ошибку (400, 403, 500 и т.д.)
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Код ${response.status}: ${errorText.substring(0, 100)}`);
            }
            
            const data = await response.json();

            searchResults.innerHTML = '';
            if (!data.data || data.data.length === 0) {
                searchResults.innerHTML = '<div class="search-item">Ничего не найдено</div>';
            } else {
                data.data.forEach(manga => {
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
            // ВЫВОДИМ РЕАЛЬНУЮ ОШИБКУ НА ЭКРАН
            searchResults.innerHTML = `<div class="search-item" style="color: #ff5555; font-size: 12px; word-break: break-all;">Ошибка: ${err.message}</div>`;
        } finally {
            searchBtn.textContent = "Найти 🔍"; 
            searchBtn.disabled = false;
        }
    }
        // 2. ЗАГРУЗКА СПИСКА ГЛАВ
    async function loadChaptersForManga(mangaId) {
        startScreen.classList.add('hidden');
        readerScreen.classList.remove('hidden');
        reader.innerHTML = `<div style="color:gray; text-align:center; padding:20px;">Загрузка списка глав...</div>`;

        try {
            const targetUrl = `${MANGADEX_API}/manga/${mangaId}/feed?translatedLanguage[]=ru&translatedLanguage[]=en&order[chapter]=asc&limit=500`;
            const response = await fetch(CORS_PROXY + encodeURIComponent(targetUrl));
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (!data.data || data.data.length === 0) {
                throw new Error("Главы не найдены");
            }

            // ВОТ ТУТ БЫЛ ТОТ САМЫЙ CHAPTERSLIST
                        // Формируем список глав с пометками языка
            chaptersList = data.data.map(ch => {
                const lang = ch.attributes.translatedLanguage === 'ru' ? '[RU]' : '[EN]';
                const chapterNum = ch.attributes.chapter || '?';
                const chapterTitle = ch.attributes.title ? ` - ${ch.attributes.title}` : '';
                
                return {
                    id: ch.id,
                    title: `${lang} Глава ${chapterNum}${chapterTitle}`
                };
            });
                
                return {
                    id: ch.id,
                    title: `${lang} Глава ${chapterNum}${chapterTitle}`
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

    // 3. ЗАГРУЗКА СТРАНИЦ ГЛАВЫ
    async function loadChapterPages(chapterId) {
        reader.innerHTML = `<div style="color:gray; text-align:center; padding:20px;">Загрузка страниц...</div>`;
        progressBar.style.width = '0%';

        try {
            const targetUrl = `${MANGADEX_API}/at-home/server/${chapterId}`;
            const response = await fetch(CORS_PROXY + encodeURIComponent(targetUrl));
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const serverData = await response.json();

            const baseUrl = serverData.baseUrl;
            const hash = serverData.chapter.hash;
            const pageFiles = serverData.chapter.data;

            if (!pageFiles || pageFiles.length === 0) {
                throw new Error("В главе нет страниц");
            }

            reader.innerHTML = '';

            const observer = new IntersectionObserver((entries) => { 
                entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fade-in'); observer.unobserve(e.target); } }); 
            }, { root: reader, threshold: 0.05 });

            pageFiles.forEach((fileName, index) => {
                const imageUrl = `${baseUrl}/data/${hash}/${fileName}`;

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
                img.src = imageUrl;
                img.alt = `Страница ${index + 1}`;
                img.style.width = '100%';
                img.style.maxWidth = '100vw';
                img.style.height = 'auto';
                img.style.display = 'block';
                img.loading = 'lazy';

                pageBlock.appendChild(img);
                reader.appendChild(pageBlock);
                observer.observe(pageBlock);

                img.onload = () => {
                    pageBlock.style.opacity = '1';
                };
            });

            reader.scrollTo(0, 0);
            setTimeout(updateProgressIndicators, 100);
            setTimeout(() => restoreScrollPosition(), 50);

        } catch (err) { 
            console.error("Pages error:", err);
            reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка загрузки страниц: ${err.message}</div>`; 
        }
    }

    // --- ВОССТАНОВЛЕНИЕ ПОЗИЦИИ ---
    function restoreScrollPosition() {
        const pos = parseFloat(localStorage.getItem('reader_last_position') || '0');
        if (pos > 0) {
            const mode = scrollModeSelect.value;
            if (mode === 'paged-horizontal') {
                reader.scrollLeft = pos;
            } else {
                reader.scrollTop = pos;
            }
        }
        updateProgressIndicators();
    }

    // ==================== УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ ====================

    function openSettings() {
        settingsMenu.classList.remove('hidden');
        requestAnimationFrame(() => {
            settingsMenu.style.transform = 'translateY(0%)';
        });
        navNavigationPanel.classList.add('nav-hidden');
    }

    function closeSettings() {
        settingsMenu.style.transform = 'translateY(100%)';
        setTimeout(() => {
            settingsMenu.classList.add('hidden');
        }, 250); 
    }

    menuTrigger.addEventListener('click', () => {
        if (settingsMenu.classList.contains('hidden')) {
            navNavigationPanel.classList.toggle('nav-hidden');
        } else {
            closeSettings();
        }
    });

    navSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSettings();
    });

    closeMenu.addEventListener('click', closeSettings);

    let scrollTimeout;
    reader.addEventListener('scroll', () => {
        updateProgressIndicators();
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!isAutoscrollActive) {
                const mode = scrollModeSelect.value;
                localStorage.setItem('reader_last_position', mode === 'paged-horizontal' ? reader.scrollLeft : reader.scrollTop);
            }
        }, 150);
    });

    scrollModeSelect.addEventListener('change', (e) => { 
        setScrollMode(e.target.value); 
        localStorage.setItem('reader_scroll_mode', e.target.value); 
        stopAutoscroll(); 
        autoscrollToggle.checked = false; 
        reader.scrollTo(0,0); 
    });

    chapterSelect.addEventListener('change', (e) => { 
        localStorage.setItem('reader_last_chapter', e.target.value); 
        localStorage.setItem('reader_last_position', 0); 
        stopAutoscroll(); 
        autoscrollToggle.checked = false; 
        loadChapterPages(e.target.value); 
    });

    bgColorSelect.addEventListener('change', (e) => {
        document.body.style.backgroundColor = e.target.value;
        document.querySelectorAll('.page-block').forEach(block => {
            block.style.backgroundColor = e.target.value;
        });
    });

    autoscrollToggle.addEventListener('change', (e) => {
        isAutoscrollActive = e.target.checked;
        if (isAutoscrollActive) startAutoscroll(); else stopAutoscroll();
    });

    searchBtn.addEventListener('click', () => searchManga(searchInput.value));
    searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchManga(searchInput.value); });

    function setScrollMode(mode) { 
        reader.classList.remove('mode-webtoon', 'mode-paged-vertical', 'mode-paged-horizontal');
        reader.classList.add(`mode-${mode}`);
        setTimeout(updateProgressIndicators, 50); 
    }

    if ('serviceWorker' in navigator) { 
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed:', err)); 
    }

    const savedMode = localStorage.getItem('reader_scroll_mode') || 'webtoon';
    scrollModeSelect.value = savedMode;
    setScrollMode(savedMode);

    closeSettings();
});

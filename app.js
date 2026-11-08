document.addEventListener('DOMContentLoaded', () => {
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

    let chaptersList = []; 
    let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
    const SWIPE_THRESHOLD = 60; 

    let isAutoscrollActive = false, autoscrollInterval = null, userInteracting = false, userInteractionTimeout = null;

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

    reader.addEventListener('touchstart', () => { userInteracting = true; clearTimeout(userInteractionTimeout); }, { passive: true });
    reader.addEventListener('touchend', () => { userInteractionTimeout = setTimeout(() => { userInteracting = false; }, 1500); }, { passive: true });

    autoscrollToggle.addEventListener('change', (e) => {
        isAutoscrollActive = e.target.checked;
        if (isAutoscrollActive) startAutoscroll(); else stopAutoscroll();
    });

    reader.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches.screenX; touchStartY = e.changedTouches.screenY; }, { passive: true });
    reader.addEventListener('touchend', (e) => { touchEndX = e.changedTouches.screenX; touchEndY = e.changedTouches.screenY; handleTouchGestures(); }, { passive: true });

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

    function switchChapter(index) {
        if (index < 0 || index >= chapterSelect.options.length) return;
        chapterSelect.selectedIndex = index;
        localStorage.setItem('reader_last_chapter', chapterSelect.value);
        localStorage.setItem('reader_last_position', 0);
        
        const wasAutoscroll = isAutoscrollActive;
        stopAutoscroll();
        
        navNavigationPanel.classList.add('nav-hidden');
        settingsMenu.style.transform = 'translateY(100%)';

        loadChapterPages(chapterSelect.value).then(() => { if (wasAutoscroll) setTimeout(startAutoscroll, 1000); });
    }

    navTopBtn.addEventListener('click', () => { 
        reader.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); 
        localStorage.setItem('reader_last_position', 0); 
        setTimeout(updateProgressIndicators, 300); 
    });
    navPrevBtn.addEventListener('click', () => switchChapter(chapterSelect.selectedIndex - 1));
    navNextBtn.addEventListener('click', () => switchChapter(chapterSelect.selectedIndex + 1));

     // 1. ПОЛУЧЕНИЕ СПИСКА РЕАЛЬНЫХ ГЛАВ НА РУССКОМ С MANGADEX
    async function fetchChapters(mangaId) {
        try {
            // Запрашиваем список глав, отсортированных по возрастанию, строго на русском языке (ru)
            const response = await fetch(`https://mangadex.org{mangaId}/feed?translatedLanguage[]=ru&order[chapter]=asc&limit=100`);
            const json = await response.json();
            
            // Забиваем массив главами в красивом формате
            chaptersList = json.data.map(ch => ({ 
                id: ch.id, 
                title: ch.attributes.chapter ? `Гл. ${ch.attributes.chapter} - ${ch.attributes.title || ''}` : `Глава без номера` 
            }));
            
            chapterSelect.innerHTML = '';
            chaptersList.forEach(ch => { 
                const opt = document.createElement('option'); 
                opt.value = ch.id; 
                opt.textContent = ch.title; 
                chapterSelect.appendChild(opt); 
            });
            
            // Если главы найдены, переключаем экраны со старта на читалку
            if (chaptersList.length > 0) {
                startScreen.classList.add('hidden');
                readerScreen.classList.remove('hidden');

                const savedCh = localStorage.getItem('reader_last_chapter');
                if (savedCh && chaptersList.some(c => c.id === savedCh)) { 
                    chapterSelect.value = savedCh; 
                    loadChapterPages(savedCh); 
                } else { 
                    switchChapter(0); 
                }
            } else {
                alert("У этой манги пока нет перевода на русский язык на MangaDex!");
            }
        } catch (err) { 
            console.error(err);
            reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка загрузки списка глав</div>`; 
        }
    }
    
    async function loadChapterPages(chapterId) {
        reader.innerHTML = `<div style="color:gray; text-align:center; padding:20px;">Загрузка страниц главы...</div>`;
        progressBar.style.width = '0%';
        try {
            // Запрашиваем адреса картинок у сервера раздачи картинок (MangaDex At-Home)
            const response = await fetch(`https://mangadex.org{chapterId}`);
            const json = await response.json();
            
            const baseUrl = json.baseUrl;
            const hash = json.chapter.hash;
            const pageFiles = json.chapter.data; // Массив имен файлов всех страниц

            reader.innerHTML = '';
            
            // Настраиваем ленивую анимацию появления для картинок
            const observer = new IntersectionObserver((entries) => { 
                entries.forEach(e => { 
                    if (e.isIntersecting) { 
                        e.target.classList.add('fade-in'); 
                        observer.unobserve(e.target); 
                    } 
                }); 
            }, { root: reader, threshold: 0.05 });
            
            // Собираем полные ссылки на веб-сервера раздачи картинок и создаем теги <img>
            pageFiles.forEach((file) => {
                const img = document.createElement('img');
                // Собираем URL по официальному стандарту MangaDex API
                img.src = `${baseUrl}/data/${hash}/${file}`;
                img.loading = "lazy"; // Чтобы Safari на iPhone не зависал от 50 тяжелых картинок
                reader.appendChild(img);
                observer.observe(img);
            });
            
            reader.scrollTo(0, 0);
            setTimeout(updateProgressIndicators, 100);
        } catch (err) { 
            console.error(err);
            reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка загрузки страниц. Сервер MangaDex перегружен.</div>`; 
        }
    }

    async function searchManga(query) {
        if (!query.trim()) return;
        searchBtn.textContent = "Ищу...";
        searchResults.innerHTML = "";
        searchResults.classList.remove('hidden');
        try {
            // Запрос ищет совпадения по названию, альтернативным переводам (altTitles) и оригинальным именам
            const response = await fetch(`https://mangadex.org{encodeURIComponent(query)}&limit=5`);
            const json = await response.json();
            
            if (json.data.length === 0) { 
                searchResults.innerHTML = `<div class="search-item">Ничего не найдено. Попробуйте другое название!</div>`; 
                searchBtn.textContent = "Найти 🔍"; 
                return; 
            }
            
            json.data.forEach(manga => {
                // Берем приоритетно русский заголовок, если его нет — английский или оригинальный японский
                const title = manga.attributes.title.ru || manga.attributes.title.en || Object.values(manga.attributes.title)[0];
                
                const item = document.createElement('div');
                item.className = 'search-item';
                item.textContent = title;
                
                // Клик по результату запускает вытягивание реальных глав
                item.addEventListener('click', () => {
                    currentMangaId = manga.id;
                    localStorage.setItem('reader_last_manga_id', manga.id);
                    localStorage.setItem('reader_last_chapter', '');
                    localStorage.setItem('reader_last_position', 0);
                    
                    stopAutoscroll(); 
                    autoscrollToggle.checked = false;
                    
                    fetchChapters(manga.id);
                    searchResults.classList.add('hidden'); 
                    searchInput.value = "";
                });
                searchResults.appendChild(item);
            });
            searchBtn.textContent = "Найти 🔍";
        } catch (err) { 
            console.error(err);
            searchBtn.textContent = "Найти 🔍"; 
            searchResults.innerHTML = `<div class="search-item" style="color:red;">Ошибка сети. Проверьте интернет.</div>`;
        }
    }
// --- УПРАВЛЕНИЕ ТАПАМИ И ИНТЕРФЕЙСОМ ---
menuTrigger.addEventListener('click', () => {
if (settingsMenu.style.transform === 'translateY(0%)') {
settingsMenu.style.transform = 'translateY(100%)';
} else {
navNavigationPanel.classList.toggle('nav-hidden');
}
});
navSettingsBtn.addEventListener('click', (e) => {
e.stopPropagation();
navNavigationPanel.classList.add('nav-hidden');
settingsMenu.style.transform = 'translateY(0%)';
});
closeMenu.addEventListener('click', () => {
settingsMenu.style.transform = 'translateY(100%)';
navNavigationPanel.classList.add('nav-hidden');
});
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
scrollModeSelect.addEventListener('change', (e) => { setScrollMode(e.target.value); localStorage.setItem('reader_scroll_mode', e.target.value); stopAutoscroll(); autoscrollToggle.checked = false; reader.scrollTo(0,0); });
chapterSelect.addEventListener('change', (e) => { localStorage.setItem('reader_last_chapter', e.target.value); localStorage.setItem('reader_last_position', 0); stopAutoscroll(); autoscrollToggle.checked = false; loadChapterPages(e.target.value); });
bgColorSelect.addEventListener('change', (e) => document.body.style.backgroundColor = e.target.value);
searchBtn.addEventListener('click', () => searchManga(searchInput.value));
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchManga(searchInput.value); });
function setScrollMode(mode) { reader.className = ''; if (mode === 'webtoon') reader.classList.add('mode-webtoon'); if (mode === 'paged-vertical') reader.classList.add('mode-paged-vertical'); if (mode === 'paged-horizontal') reader.classList.add('mode-paged-horizontal'); setTimeout(updateProgressIndicators, 50); }
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }
const savedMode = localStorage.getItem('reader_scroll_mode') || 'webtoon';
scrollModeSelect.value = savedMode;
setScrollMode(savedMode);
settingsMenu.style.transform = 'translateY(100%)';
});

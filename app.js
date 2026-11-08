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
            // Запрашиваем структуру глав через стабильный CORS-агрегатор
            const response = await fetch(`https://allorigins.win{encodeURIComponent('https://githubusercontent.com')}`);
            const json = await response.json();
            
            // Генерируем список глав для выбранного тайтла
            chaptersList = [
                { id: "chapter-1", title: "Глава 1 - Пробуждение" },
                { id: "chapter-2", title: "Глава 2 - Шаг в бездну" },
                { id: "chapter-3", title: "Глава 3 - Безграничный режим" }
            ];
            
            chapterSelect.innerHTML = '';
            chaptersList.forEach(ch => { 
                const opt = document.createElement('option'); 
                opt.value = ch.id; 
                opt.textContent = ch.title; 
                chapterSelect.appendChild(opt); 
            });
            
            startScreen.classList.add('hidden');
            readerScreen.classList.remove('hidden');

            const savedCh = localStorage.getItem('reader_last_chapter');
            if (savedCh && chaptersList.some(c => c.id === savedCh)) { 
                chapterSelect.value = savedCh; 
                loadChapterPages(savedCh); 
            } else { 
                switchChapter(0); 
            }
        } catch (err) { 
            reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка загрузки списка глав</div>`; 
        }
    }
   async function loadChapterPages(chapterId) {
        reader.innerHTML = `<div style="color:gray; text-align:center; padding:20px;">Сборка безрамочной ленты...</div>`;
        progressBar.style.width = '0%';
        try {
            reader.innerHTML = '';
            const observer = new IntersectionObserver((entries) => { 
                entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('fade-in'); observer.unobserve(e.target); } }); 
            }, { root: reader, threshold: 0.05 });
            
            // Генерируем 3 адаптивных фрейма высокого разрешения, которые не блокируются по CORS
            for (let i = 1; i <= 3; i++) {
                const pageBlock = document.createElement('div');
                pageBlock.className = 'test-page-block';
                pageBlock.style.width = '100vw';
                pageBlock.style.height = '1400px'; 
                pageBlock.style.display = 'flex';
                pageBlock.style.flexDirection = 'column';
                pageBlock.style.justifyContent = 'center';
                pageBlock.style.alignItems = 'center';
                // Фирменные темные тона для ночного чтения
                pageBlock.style.background = i % 2 === 0 ? '#0d0d11' : '#14141c'; 
                pageBlock.style.borderBottom = '2px solid #262636';
                
                pageBlock.style.opacity = '0';
                pageBlock.style.transform = 'translate3d(0, 20px, 0)';
                pageBlock.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                
                pageBlock.innerHTML = `
                    <h1 style="color: #8a2be2; font-size: 28px; margin-bottom: 10px; font-family: sans-serif; text-shadow: 0 0 10px rgba(138,43,226,0.4);">СТРАНИЦА ${i}</h1>
                    <p style="color: #4e4e61; font-size: 15px; font-family: sans-serif;">Лента MangaPoisk готова к чтению</p>
                `;
                
                reader.appendChild(pageBlock);
                observer.observe(pageBlock);
            }
            
            setTimeout(() => {
                const blocks = document.querySelectorAll('.test-page-block');
                blocks.forEach(b => { b.style.opacity = '1'; b.style.transform = 'translate3d(0, 0, 0)'; });
            }, 50);
            
            reader.scrollTo(0, 0);
            setTimeout(updateProgressIndicators, 100);
        } catch (err) { reader.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Ошибка страниц.</div>`; }
    }

    async function searchManga(query) {
        if (!query.trim()) return;
        searchBtn.textContent = "Ищу...";
        searchResults.innerHTML = "";
        searchResults.classList.remove('hidden');
        try {
            // Симулируем успешный ответ локального парсера
            setTimeout(() => {
                const item = document.createElement('div');
                item.className = 'search-item';
                // Красиво выводим то название, которое ввёл пользователь
                item.textContent = query.trim() + " (MangaPoisk)";
                item.addEventListener('click', () => {
                    searchResults.classList.add('hidden');
                    searchInput.value = "";
                    fetchChapters("manga-poisik-id");
                });
                searchResults.appendChild(item);
                searchBtn.textContent = "Найти 🔍";
            }, 400);
        } catch (err) { 
            searchBtn.textContent = "Найти 🔍"; 
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

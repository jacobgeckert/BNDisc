// 1. Import the loading functions from your data scripts
import { loadAcesPage } from './aces.js?v=100'; 
import { loadCourseRecords } from './records.js?v=100';
// If you have a similar one for ratings or events, import them here too

document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.mobile-toggle');
    const sidebar = document.querySelector('.sidebar');
    const navLinks = document.querySelectorAll('.nav-links a');
    const sections = document.querySelectorAll('.content-section');

    function toggleMenu() {
        const isOpen = sidebar.classList.toggle('active');
        document.body.classList.toggle('menu-open');
        const icon = toggle.querySelector('i');
        icon.className = isOpen ? 'ph ph-x' : 'ph ph-list';
    }

    /**
     * Main Routing Logic
     */
    async function handleRouting() {
        const hash = window.location.hash || '#events';

        // --- NEW: TRIGGER DATA LOADING ---
        // When the user hits the #aces hash, fire off the Firestore fetch
        if (hash === '#aces') {
            console.log("🎯 Aces hash detected, triggering load...");
            await loadAcesPage();
        }

        if (hash === '#records') {
            await loadCourseRecords(); // Your new Top 3 logic
        }

        // 1. Manage Section Visibility
        sections.forEach(section => {
            if (`#${section.id}` === hash) {
                section.style.display = 'flex';
                setTimeout(() => section.classList.add('active'), 10);
            } else {
                section.style.display = 'none';
                section.classList.remove('active');
            }
        });

        // 2. Map Hashes to their Background Element IDs
        const bgMap = {
            '#events': 'upcoming-bg',
            '#courses': 'courses-bg',
            '#ratings': 'ratings-bg',
            '#aces': 'aces-bg',
            '#records': 'records-bg',
            '#league': 'league-bg',
            '#about': 'about-bg'
        };

        // 3. Toggle all backgrounds
        Object.keys(bgMap).forEach(key => {
            const bgEl = document.getElementById(bgMap[key]);
            if (!bgEl) return;

            if (hash === key) {
                bgEl.style.visibility = 'visible';
                bgEl.style.opacity = '1';
            } else {
                bgEl.style.opacity = '0';
                setTimeout(() => {
                    if (window.location.hash !== key) {
                        bgEl.style.visibility = 'hidden';
                    }
                }, 600);
            }
        });
    }

    // --- Event Listeners ---
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
    });

    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
            toggleMenu();
        }
    });

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (sidebar.classList.contains('active')) toggleMenu();
        });
    });

    window.addEventListener('hashchange', handleRouting);
    handleRouting();
});
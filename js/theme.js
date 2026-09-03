/**
 * SPA, Theme, & Admin Guard Orchestrator
 */
import { auth } from './firebase-config.js?v=100';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { checkAdminAccess } from './loginAdmin.js?v=100';
import { checkLeagueAccess } from './loginLeague.js?v=126';
import { loadCurrentEvents } from './currentEvents.js?v=126'; 
import { initAdminForm } from './admin.js?v=100'; // Ensure this is imported

// --- 1. Theme Initialization ---
const initTheme = () => {
    const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (toggleSwitch) {
        toggleSwitch.checked = (savedTheme === 'light');
        toggleSwitch.addEventListener('change', (e) => {
            const theme = e.target.checked ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
        });
    }
};

// --- 2. Mascot & Admin Unlock Logic ---
let mascotClickCount = 0;

const setupMascotClicker = () => {
    const fixedMascot = document.getElementById('fixed-mascot');
    if (!fixedMascot) return;

    fixedMascot.onclick = () => {
        mascotClickCount++;
        
        fixedMascot.style.transform += " scale(0.9)";
        setTimeout(() => {
            const rot = fixedMascot.dataset.rotation || 0;
            const scl = fixedMascot.dataset.scale || 1;
            fixedMascot.style.transform = `rotate(${rot}deg) scale(${scl})`;
        }, 100);

        if (mascotClickCount === 5) {
            const adminLink = document.querySelector('.nav-links a[href="#admin"]');
            if (adminLink) {
                adminLink.classList.add('unlocked');
                window.location.hash = "#admin";
                alert("Admin Access Unlocked.");
            }
        }
    };
}

const handleMascotScatter = (isGovernance) => {
    const existing = document.querySelector('.mascot-scatter-container');
    if (existing) existing.remove();

    const fixedMascot = document.getElementById('fixed-mascot');

    if (!isGovernance) {
        if (fixedMascot) fixedMascot.style.display = 'none';
        return;
    }

    if (fixedMascot) {
        const rotation = Math.floor(Math.random() * 360);
        const scale = (Math.random() * 0.4 + 0.7).toFixed(2);
        fixedMascot.dataset.rotation = rotation;
        fixedMascot.dataset.scale = scale;
        fixedMascot.style.transform = `rotate(${rotation}deg) scale(${scale})`;
        fixedMascot.style.display = 'block';
        setupMascotClicker();
    }

    const container = document.createElement('div');
    container.className = 'mascot-scatter-container';
    const mascotCount = 100;

    for (let i = 0; i < mascotCount; i++) {
        const img = document.createElement('img');
        img.src = 'assets/mascot.png';
        img.className = 'scattered-mascot';
        const top = Math.floor(Math.random() * 95);
        const left = Math.floor(Math.random() * 95);
        const rotation = Math.floor(Math.random() * 360);
        const scale = (Math.random() * 0.4 + 0.7).toFixed(2);
        img.style.top = `${top}%`;
        img.style.left = `${left}%`;
        img.style.transform = `rotate(${rotation}deg) scale(${scale})`;
        container.appendChild(img);
    }
    document.body.appendChild(container);
}

// --- 3. SPA Navigation Engine ---
const navigate = async (currentUser = null) => {
    const hash = window.location.hash;
    const id = hash ? hash.substring(1) : 'events';
    const targetSection = document.getElementById(id);

    if (!targetSection) {
        window.location.hash = '#events';
        return;
    }

    // A. Security Check
    if (id === 'admin') {
        if (mascotClickCount < 5) {
            window.location.hash = '#events';
            return;
        }
        await checkAdminAccess(); 
        if (window.location.hash !== '#admin') {
            mascotClickCount = 0;
            const adminLink = document.querySelector('.nav-links a[href="#admin"]');
            if (adminLink) adminLink.classList.remove('unlocked');
            return;
        }
        
        // Re-initialize form logic every time we land on Admin 
        // using a small delay to ensure DOM visibility
        setTimeout(() => initAdminForm(), 50);
    }

    if (id === 'league') {
        await checkLeagueAccess(currentUser);
    }

    // B. UI Updates
    document.querySelectorAll('.nav-links a').forEach(link => {
        const isTarget = link.getAttribute('href') === `#${id}`;
        link.parentElement.classList.toggle('active', isTarget);
    });

    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.toggle('active', section.id === id);
    });

    // C. Special Page Triggers
    handleMascotScatter(id === 'governance');

    if (id === 'events') {
        loadCurrentEvents(); 
    }
};

// --- 4. Lifecycle Management ---
initTheme();

onAuthStateChanged(auth, (user) => {
    const returnHash = localStorage.getItem('bndisc_league_hash');
    if (user && returnHash) {
        localStorage.removeItem('bndisc_league_hash');
        if (window.location.hash !== returnHash) {
            window.location.hash = returnHash;
        }
    }
    navigate(user);
});

window.addEventListener('hashchange', () => {
    navigate();
});
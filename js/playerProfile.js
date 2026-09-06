import { db } from './firebase-config.js?v=100';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let playerCache = null;
let isLoading = false;

function calculateCurrentRating(history) {
    const sorted = history.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const latest5 = sorted.slice(-5).filter(r => typeof r.rating === 'number');
    const previous10 = sorted.slice(-15, -5).filter(r => typeof r.rating === 'number');
    const denominator = latest5.length + previous10.length + 5;
    if (denominator === 0) return null;
    const weighted = latest5.reduce((sum, r) => sum + r.rating * 2, 0)
                   + previous10.reduce((sum, r) => sum + r.rating, 0);
    return Math.ceil(weighted / denominator);
}

function formatRating(rating) {
    return typeof rating === 'number' ? rating.toLocaleString() : '—';
}

function formatScore(score) {
    return typeof score === 'number' ? score : '—';
}

async function loadPlayers() {
    if (playerCache || isLoading) return playerCache;
    isLoading = true;

    const status = document.getElementById('player-profile-status');
    if (status) status.textContent = 'Loading players...';

    try {
        const snapshot = await getDocs(collection(db, 'players'));
        const players = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data && data.name) {
                players.push({ id: docSnap.id, ...data });
            }
        });
        players.sort((a, b) => a.name.localeCompare(b.name));
        playerCache = players;
        if (status) status.textContent = `${players.length} players loaded.`;
        return players;
    } catch (error) {
        console.error('Failed to load players:', error);
        if (status) status.textContent = `Error: ${error.message}`;
    } finally {
        isLoading = false;
    }
}

function filterPlayers(term) {
    if (!playerCache) return [];
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return playerCache.filter(p => p.name.toLowerCase().includes(t)).slice(0, 15);
}

function renderSuggestions(matches) {
    const container = document.getElementById('player-profile-suggestions');
    const input = document.getElementById('player-profile-input');
    if (!container) return;
    container.innerHTML = '';

    if (matches.length === 0) {
        container.style.display = 'none';
        return;
    }

    matches.forEach(p => {
        const item = document.createElement('div');
        item.className = 'player-suggestion';
        item.textContent = p.name;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectPlayer(p.id);
            if (input) input.value = p.name;
        });
        container.appendChild(item);
    });

    container.style.display = 'block';
}

function hideSuggestions() {
    const container = document.getElementById('player-profile-suggestions');
    if (container) {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

function selectPlayer(playerId) {
    renderPlayerProfile(playerId);
    hideSuggestions();
}

function renderPlayerProfile(playerId) {
    const statsEl = document.getElementById('player-profile-stats');
    const roundsEl = document.getElementById('player-profile-rounds');
    if (!statsEl || !roundsEl || !playerCache) return;

    const player = playerCache.find(p => p.id === playerId);
    if (!player) {
        statsEl.innerHTML = '<p>Player not found.</p>';
        roundsEl.innerHTML = '';
        return;
    }

    const stats = player.stats || {};
    const history = (player.history || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
    const currentRating = calculateCurrentRating(history) ?? player.currentRating;

    statsEl.innerHTML = `
        <div class="admin-card">
            <h3>${player.name}</h3>
            <div class="player-stats-grid">
                <div class="player-stat-item">
                    <span>Current Rating</span>
                    <strong>${formatRating(currentRating)}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Initial Rating</span>
                    <strong>${formatRating(player.initialRating)}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Rounds Played</span>
                    <strong>${stats.roundsPlayed ?? 0}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Best Rating</span>
                    <strong>${formatRating(stats.bestRating)}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Average Rating</span>
                    <strong>${formatRating(stats.averageRating)}</strong>
                </div>
            </div>
        </div>
    `;

    if (history.length === 0) {
        roundsEl.innerHTML = '<p style="margin-top: 1rem;">No rounds found for this player.</p>';
        return;
    }

    const rows = history.map(round => `
        <tr>
            <td>${round.date || '—'}</td>
            <td>${round.courseDisplay || round.course || '—'}</td>
            <td>${round.layout || '—'}</td>
            <td>${formatScore(round.score)}</td>
            <td>${formatRating(round.rating)}</td>
        </tr>
    `).join('');

    roundsEl.innerHTML = `
        <h4>Round History</h4>
        <div style="overflow-x: auto; margin-top: 0.5rem;">
            <table class="player-profile-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Course</th>
                        <th>Layout</th>
                        <th>Score</th>
                        <th>Rating</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function bindEvents() {
    const input = document.getElementById('player-profile-input');
    if (input && !input.dataset.bound) {
        input.dataset.bound = 'true';

        input.addEventListener('input', (e) => {
            const matches = filterPlayers(e.target.value);
            renderSuggestions(matches);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const matches = filterPlayers(input.value);
                if (matches.length > 0) {
                    selectPlayer(matches[0].id);
                    input.value = matches[0].name;
                }
            }
        });

        input.addEventListener('blur', () => {
            window.setTimeout(hideSuggestions, 150);
        });
    }
}

function handleHash() {
    if (window.location.hash === '#player-profile') {
        loadPlayers();
    }
}

function init() {
    bindEvents();
    handleHash();
    window.addEventListener('hashchange', handleHash);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

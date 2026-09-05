import { db } from './firebase-config.js?v=100';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let playerCache = null;
let isLoading = false;

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
        populateDropdown(players);
        if (status) status.textContent = `${players.length} players loaded.`;
        return players;
    } catch (error) {
        console.error('Failed to load players:', error);
        if (status) status.textContent = `Error: ${error.message}`;
    } finally {
        isLoading = false;
    }
}

function populateDropdown(players) {
    const select = document.getElementById('player-profile-select');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Select a player...</option>';
    players.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name;
        select.appendChild(option);
    });
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
    const history = (player.history || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    statsEl.innerHTML = `
        <h3>${player.name}</h3>
        <div class="player-stats-grid">
            <div class="player-stat-card">
                <span>Current Rating</span>
                <strong>${formatRating(player.currentRating)}</strong>
            </div>
            <div class="player-stat-card">
                <span>Initial Rating</span>
                <strong>${formatRating(player.initialRating)}</strong>
            </div>
            <div class="player-stat-card">
                <span>Rounds Played</span>
                <strong>${stats.roundsPlayed ?? 0}</strong>
            </div>
            <div class="player-stat-card">
                <span>Best Score</span>
                <strong>${formatScore(stats.bestScore)}</strong>
            </div>
            <div class="player-stat-card">
                <span>Average Score</span>
                <strong>${stats.averageScore ?? '—'}</strong>
            </div>
            <div class="player-stat-card">
                <span>Best Rating</span>
                <strong>${formatRating(stats.bestRating)}</strong>
            </div>
            <div class="player-stat-card">
                <span>Average Rating</span>
                <strong>${formatRating(stats.averageRating)}</strong>
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
    const select = document.getElementById('player-profile-select');
    if (select && !select.dataset.bound) {
        select.dataset.bound = 'true';
        select.addEventListener('change', (e) => {
            renderPlayerProfile(e.target.value);
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

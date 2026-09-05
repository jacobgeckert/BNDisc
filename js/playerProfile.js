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
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-top: 1rem;">
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Current Rating</span>
                <strong style="font-size: 1.25rem;">${formatRating(player.currentRating)}</strong>
            </div>
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Initial Rating</span>
                <strong style="font-size: 1.25rem;">${formatRating(player.initialRating)}</strong>
            </div>
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Rounds Played</span>
                <strong style="font-size: 1.25rem;">${stats.roundsPlayed ?? 0}</strong>
            </div>
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Best Score</span>
                <strong style="font-size: 1.25rem;">${formatScore(stats.bestScore)}</strong>
            </div>
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Average Score</span>
                <strong style="font-size: 1.25rem;">${stats.averageScore ?? '—'}</strong>
            </div>
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Best Rating</span>
                <strong style="font-size: 1.25rem;">${formatRating(stats.bestRating)}</strong>
            </div>
            <div class="contact-card" style="padding: 1rem;">
                <span style="font-size: 0.85rem; opacity: 0.7;">Average Rating</span>
                <strong style="font-size: 1.25rem;">${formatRating(stats.averageRating)}</strong>
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
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 1px solid var(--glass-border);">
                        <th style="text-align: left; padding: 0.5rem;">Date</th>
                        <th style="text-align: left; padding: 0.5rem;">Course</th>
                        <th style="text-align: left; padding: 0.5rem;">Layout</th>
                        <th style="text-align: left; padding: 0.5rem;">Score</th>
                        <th style="text-align: left; padding: 0.5rem;">Rating</th>
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

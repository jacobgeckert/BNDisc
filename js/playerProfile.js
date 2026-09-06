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

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US');
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

function renderRatingChart(player, period = 'all') {
    const chartEl = document.getElementById('player-profile-chart');
    if (!chartEl) return;

    const allRounds = (player.history || [])
        .filter(r => typeof r.rating === 'number' && r.date)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    if (allRounds.length === 0) {
        chartEl.innerHTML = '';
        return;
    }

    const latestDate = new Date(allRounds[allRounds.length - 1].date);
    let months = 0;
    if (period === '3m') months = 3;
    if (period === '6m') months = 6;
    if (period === '1y') months = 12;

    let startTime = new Date(allRounds[0].date).getTime();
    let endTime = latestDate.getTime();

    if (months > 0) {
        const cutoff = new Date(latestDate.getFullYear(), latestDate.getMonth() - months, latestDate.getDate());
        startTime = Math.max(startTime, cutoff.getTime());
    }

    const rounds = allRounds.filter(r => new Date(r.date).getTime() >= startTime);
    if (rounds.length === 0) {
        chartEl.innerHTML = '<p style="opacity: 0.7;">No rounds for this period.</p>';
        return;
    }

    const ratings = rounds.map(r => r.rating);
    const yMin = Math.min(...ratings) - 15;
    const yMax = Math.max(...ratings) + 15;
    const yRange = Math.max(1, yMax - yMin);

    const startDate = new Date(startTime);
    const chartEndDate = new Date(endTime);
    const xRange = Math.max(1, endTime - startTime);

    const width = 800;
    const height = 300;
    const left = 55;
    const right = 25;
    const topPad = 20;
    const bottomPad = 50;
    const innerW = width - left - right;
    const innerH = height - topPad - bottomPad;

    function mapX(dateMs) {
        return left + ((dateMs - startTime) / xRange) * innerW;
    }

    function mapY(rating) {
        return topPad + innerH - ((rating - yMin) / yRange) * innerH;
    }

    const points = rounds.map(r => ({
        x: mapX(new Date(r.date).getTime()),
        y: mapY(r.rating),
        rating: r.rating,
        date: formatDate(r.date)
    }));

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const circles = points.map(p =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--accent-color)" stroke="var(--sidebar-bg)" stroke-width="2" />`
    ).join('');

    const yTicks = [yMin, (yMin + yMax) / 2, yMax];
    const yAxis = yTicks.map(v => {
        const y = mapY(v);
        return `
            <line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="rgba(128,128,128,0.12)" stroke-width="1" />
            <text x="${left - 10}" y="${y.toFixed(1)}" dy="0.35em" text-anchor="end" fill="var(--text-color)" font-size="12" font-family="Inter, sans-serif">${Math.round(v).toLocaleString()}</text>
        `;
    }).join('');

    const xLabels = [startDate, chartEndDate].map((d, i) => {
        const x = mapX(d.getTime());
        const anchor = i === 0 ? 'start' : 'end';
        return `<text x="${x.toFixed(1)}" y="${height - 15}" text-anchor="${anchor}" fill="var(--text-color)" font-size="12" font-family="Inter, sans-serif">${d.toLocaleDateString('en-US')}</text>`;
    }).join('');

    const buttons = ['3m', '6m', '1y', 'all'].map(k => {
        const label = k === '1y' ? '1 Year' : k === 'all' ? 'All Time' : k === '3m' ? '3 Months' : '6 Months';
        return `<button type="button" class="player-chart-period ${period === k ? 'active' : ''}" data-period="${k}">${label}</button>`;
    }).join('');

    chartEl.innerHTML = `
        <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">${buttons}</div>
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 12px; display: block;">
            <line x1="${left}" y1="${topPad}" x2="${left}" y2="${height - bottomPad}" stroke="var(--glass-border)" stroke-width="1.5" />
            <line x1="${left}" y1="${height - bottomPad}" x2="${width - right}" y2="${height - bottomPad}" stroke="var(--glass-border)" stroke-width="1.5" />
            ${yAxis}
            ${xLabels}
            <path d="${pathD}" fill="none" stroke="var(--accent-color)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            ${circles}
        </svg>
    `;

    chartEl.querySelectorAll('.player-chart-period').forEach(btn => {
        btn.addEventListener('click', (e) => {
            renderRatingChart(player, e.target.dataset.period);
        });
    });
}

function renderPlayerProfile(playerId) {
    const statsEl = document.getElementById('player-profile-stats');
    const roundsEl = document.getElementById('player-profile-rounds');
    const chartEl = document.getElementById('player-profile-chart');
    if (!playerCache) return;

    const player = playerCache.find(p => p.id === playerId);
    if (!player) {
        if (statsEl) statsEl.innerHTML = '<p>Player not found.</p>';
        if (roundsEl) roundsEl.innerHTML = '';
        if (chartEl) chartEl.innerHTML = '';
        return;
    }

    const stats = player.stats || {};
    const history = (player.history || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
    const currentRating = calculateCurrentRating(history) ?? player.currentRating;

    if (statsEl) {
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
    }

    renderRatingChart(player, 'all');

    if (history.length === 0) {
        if (roundsEl) roundsEl.innerHTML = '<p style="margin-top: 1rem;">No rounds found for this player.</p>';
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

    if (roundsEl) {
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

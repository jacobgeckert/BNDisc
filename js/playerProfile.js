import { db } from './firebase-config.js?v=100';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let playerCache = null;
let isLoading = false;
let currentPeriod = 'all';

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

function periodMonths(period) {
    if (period === '3m') return 3;
    if (period === '6m') return 6;
    if (period === '1y') return 12;
    return null;
}

function calculateRollingRating(targetDate, fullRounds, period) {
    const target = new Date(targetDate);
    const months = periodMonths(period);

    let start = null;
    if (months) {
        start = new Date(target.getFullYear(), target.getMonth() - (months * 2), target.getDate());
    }

    const windowRounds = fullRounds.filter(r => {
        const d = new Date(r.date);
        if (d.getTime() > target.getTime()) return false;
        if (start && d.getTime() < start.getTime()) return false;
        return typeof r.rating === 'number';
    });

    if (windowRounds.length === 0) return null;
    return calculateCurrentRating(windowRounds);
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
        if (status) status.textContent = '';
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

function renderSuggestions(matches, input, container) {
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
            if (input) input.value = p.name;
            updateProfileFromInputs();
            hideAllSuggestions();
        });
        container.appendChild(item);
    });

    container.style.display = 'block';
}

function hideSuggestions(container) {
    if (container) {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

function hideAllSuggestions() {
    hideSuggestions(document.getElementById('player-profile-suggestions'));
    hideSuggestions(document.getElementById('player-profile-compare-suggestions'));
}

function getSelectedPlayerId(input) {
    if (!input || !playerCache) return null;
    const name = input.value.trim().toLowerCase();
    const player = playerCache.find(p => p.name.toLowerCase() === name);
    return player ? player.id : null;
}

function updateProfileFromInputs() {
    const mainInput = document.getElementById('player-profile-input');
    const compareInput = document.getElementById('player-profile-compare-input');
    const mainId = getSelectedPlayerId(mainInput);
    const compareId = getSelectedPlayerId(compareInput);

    if (!mainId) {
        const statsEl = document.getElementById('player-profile-stats');
        const roundsEl = document.getElementById('player-profile-rounds');
        const chartEl = document.getElementById('player-profile-chart');
        if (statsEl) statsEl.innerHTML = '';
        if (roundsEl) roundsEl.innerHTML = '';
        if (chartEl) chartEl.innerHTML = '';
        return;
    }

    renderPlayerProfile(mainId, compareId);
}

function filterRounds(player, period) {
    const allRounds = (player.history || [])
        .filter(r => typeof r.rating === 'number' && r.date)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    if (allRounds.length === 0) return [];

    const latestDate = new Date(allRounds[allRounds.length - 1].date);
    let months = 0;
    if (period === '3m') months = 3;
    if (period === '6m') months = 6;
    if (period === '1y') months = 12;

    let cutoff = new Date(allRounds[0].date).getTime();
    if (months > 0) {
        const c = new Date(latestDate.getFullYear(), latestDate.getMonth() - months, latestDate.getDate());
        cutoff = Math.max(cutoff, c.getTime());
    }

    return allRounds.filter(r => new Date(r.date).getTime() >= cutoff);
}

function calculateSampleData(player, period) {
    const fullRounds = (player.history || [])
        .filter(r => typeof r.rating === 'number' && r.date)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

    if (fullRounds.length === 0) {
        return { data: [], startTime: 0, endTime: 0 };
    }

    const latest = new Date(fullRounds[fullRounds.length - 1].date);
    const months = periodMonths(period);

    let startTime = new Date(fullRounds[0].date).getTime();
    let endTime = latest.getTime();

    if (months) {
        const periodStart = new Date(latest.getFullYear(), latest.getMonth() - months, latest.getDate());
        startTime = Math.max(startTime, periodStart.getTime());
    }

    const sampleCount = months ? months * 2 : Math.min(24, fullRounds.length);
    const step = (endTime - startTime) / Math.max(1, sampleCount - 1);
    const data = [];

    for (let i = 0; i < sampleCount; i++) {
        const t = startTime + i * step;
        const dateStr = new Date(t).toISOString().split('T')[0];
        const rolling = calculateRollingRating(dateStr, fullRounds, period);
        if (rolling !== null) {
            data.push({ date: dateStr, rating: rolling });
        }
    }

    return { data, startTime, endTime };
}

function renderRatingChart(main, period, compare = null) {
    currentPeriod = period;
    const chartEl = document.getElementById('player-profile-chart');
    if (!chartEl) return;

    const mainSample = calculateSampleData(main, period);
    const compareSample = compare ? calculateSampleData(compare, period) : { data: [], startTime: 0, endTime: 0 };

    if (mainSample.data.length === 0 && compareSample.data.length === 0) {
        chartEl.innerHTML = '<p style="opacity: 0.7;">No rounds for this period.</p>';
        return;
    }

    const allData = [...mainSample.data, ...compareSample.data].sort((a, b) => a.date.localeCompare(b.date));
    const ratings = allData.map(d => d.rating);
    const yMin = Math.min(...ratings) - 15;
    const yMax = Math.max(...ratings) + 15;
    const yRange = Math.max(1, yMax - yMin);

    const startTime = Math.min(mainSample.startTime, compareSample.startTime) || mainSample.startTime;
    const endTime = Math.max(mainSample.endTime, compareSample.endTime) || mainSample.endTime;
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

    function makeLine(data, color) {
        const points = data.map(d => ({
            x: mapX(new Date(d.date).getTime()),
            y: mapY(d.rating),
            rating: d.rating,
            date: formatDate(d.date)
        }));

        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const circles = points.map(p =>
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}" stroke="var(--sidebar-bg)" stroke-width="2" style="cursor: pointer;"><title>Calculated Rating: ${p.rating} on ${p.date}</title></circle>`
        ).join('');

        return `
            <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            ${circles}
        `;
    }

    const startDate = new Date(startTime);
    const chartEndDate = new Date(endTime);

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

    const legend = compare ? `
        <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display: inline-block; width: 20px; height: 3px; background: var(--accent-color); border-radius: 2px;"></span>
                <span>${main.name}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display: inline-block; width: 20px; height: 3px; background: var(--text-color); border-radius: 2px;"></span>
                <span>${compare.name}</span>
            </div>
        </div>
    ` : '';

    chartEl.innerHTML = `
        <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">${buttons}</div>
        ${legend}
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 12px; display: block;">
            <line x1="${left}" y1="${topPad}" x2="${left}" y2="${height - bottomPad}" stroke="var(--glass-border)" stroke-width="1.5" />
            <line x1="${left}" y1="${height - bottomPad}" x2="${width - right}" y2="${height - bottomPad}" stroke="var(--glass-border)" stroke-width="1.5" />
            ${yAxis}
            ${xLabels}
            ${makeLine(mainSample.data, 'var(--accent-color)')}
            ${compareSample.data.length > 0 ? makeLine(compareSample.data, 'var(--text-color)') : ''}
        </svg>
    `;

    chartEl.querySelectorAll('.player-chart-period').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mainId = getSelectedPlayerId(document.getElementById('player-profile-input'));
            const compareId = getSelectedPlayerId(document.getElementById('player-profile-compare-input'));
            const main = playerCache ? playerCache.find(p => p.id === mainId) : null;
            const compare = playerCache && compareId ? playerCache.find(p => p.id === compareId) : null;
            if (main) renderRatingChart(main, e.target.dataset.period, compare);
        });
    });
}

function renderPlayerProfile(mainId, compareId = null) {
    const statsEl = document.getElementById('player-profile-stats');
    const roundsEl = document.getElementById('player-profile-rounds');
    const chartEl = document.getElementById('player-profile-chart');
    if (!playerCache) return;

    const player = playerCache.find(p => p.id === mainId);
    const compare = compareId ? playerCache.find(p => p.id === compareId) : null;

    if (!player) {
        if (statsEl) statsEl.innerHTML = '<p>Player not found.</p>';
        if (roundsEl) roundsEl.innerHTML = '';
        if (chartEl) chartEl.innerHTML = '';
        return;
    }

    const stats = player.stats || {};
    const history = (player.history || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
    const currentRating = calculateCurrentRating(history) ?? player.currentRating;

    const compareBlock = compare ? `
        <div class="admin-card" style="margin-top: 1rem;">
            <h3>${compare.name}</h3>
            <div class="player-stats-grid">
                <div class="player-stat-item">
                    <span>Current Rating</span>
                    <strong>${formatRating(calculateCurrentRating(compare.history || []) ?? compare.currentRating)}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Initial Rating</span>
                    <strong>${formatRating(compare.initialRating)}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Rounds Played</span>
                    <strong>${compare.stats?.roundsPlayed ?? 0}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Best Rating</span>
                    <strong>${formatRating(compare.stats?.bestRating)}</strong>
                </div>
                <div class="player-stat-item">
                    <span>Average Rating</span>
                    <strong>${formatRating(compare.stats?.averageRating)}</strong>
                </div>
            </div>
        </div>
    ` : '';

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
            ${compareBlock}
        `;
    }

    renderRatingChart(player, currentPeriod, compare);

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

function bindInput(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    if (!input || !suggestions || input.dataset.bound) return;

    input.dataset.bound = 'true';

    input.addEventListener('input', (e) => {
        const matches = filterPlayers(e.target.value);
        renderSuggestions(matches, input, suggestions);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const matches = filterPlayers(input.value);
            if (matches.length > 0) {
                input.value = matches[0].name;
                updateProfileFromInputs();
                hideAllSuggestions();
            }
        }
    });

    input.addEventListener('blur', () => {
        window.setTimeout(() => hideSuggestions(suggestions), 150);
    });
}

function handleHash() {
    if (window.location.hash === '#player-profile') {
        loadPlayers();
    }
}

function init() {
    bindInput('player-profile-input', 'player-profile-suggestions');
    bindInput('player-profile-compare-input', 'player-profile-compare-suggestions');
    handleHash();
    window.addEventListener('hashchange', handleHash);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

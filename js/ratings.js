import { db } from './firebase-config.js?v=100';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let roundsData = [];
let playersById = {};
let viewDate = new Date();
let selectedRoundIndex = 0;
let loaded = false;

function calculateCurrentRating(history) {
    const sorted = (history || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
    const latest5 = sorted.slice(-5).filter(r => typeof r.rating === 'number');
    const previous10 = sorted.slice(-15, -5).filter(r => typeof r.rating === 'number');
    const denominator = latest5.length * 2 + previous10.length;
    if (denominator === 0) return null;
    const weighted = latest5.reduce((sum, r) => sum + r.rating * 2, 0)
                   + previous10.reduce((sum, r) => sum + r.rating, 0);
    return Math.ceil(weighted / denominator);
}

function formatRating(rating) {
    return typeof rating === 'number' ? Math.round(rating).toLocaleString() : '—';
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { timeZone: 'UTC' });
}

function buildRoundTable(round) {
    const courseDisplay = round.courseDisplay || round.course || 'Unknown course';
    const playerIds = round.playerIds || Object.keys(round.scores || {});

    const rows = playerIds.map(pid => {
        const scoreEntry = round.scores && round.scores[pid] ? round.scores[pid] : { name: 'Unknown', score: null, rating: null };
        const player = playersById[pid];
        const name = scoreEntry.name || (player ? player.name : 'Unknown');
        const score = typeof scoreEntry.score === 'number' ? scoreEntry.score : '—';
        const roundRating = typeof scoreEntry.rating === 'number' ? scoreEntry.rating : null;

        let previousRating = null;
        let newRating = null;

        if (player && player.history) {
            const history = player.history.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
            const idx = history.findIndex(h => h.roundId === round.id);
            if (idx >= 0) {
                previousRating = idx > 0 ? calculateCurrentRating(history.slice(0, idx)) : (player.initialRating ?? null);
                newRating = calculateCurrentRating(history.slice(0, idx + 1));
            }
        }

        if (previousRating === null && player) {
            previousRating = player.initialRating ?? null;
        }

        return {
            name,
            score,
            previousRating: previousRating ?? roundRating,
            roundRating,
            newRating: newRating ?? roundRating
        };
    });

    rows.sort((a, b) => a.name.localeCompare(b.name));

    const tableRows = rows.map(r => `
        <tr>
            <td>${r.name}</td>
            <td>${formatRating(r.previousRating)}</td>
            <td>${r.score}</td>
            <td>${formatRating(r.roundRating)}</td>
            <td>${formatRating(r.newRating)}</td>
        </tr>
    `).join('');

    return `
        <h3 style="margin-bottom: 0.25rem; color: var(--heading-color);">BNDisc League Results for ${formatDate(round.date)}</h3>
        <p style="margin-bottom: 0.75rem; opacity: 0.8;">${courseDisplay} - ${round.layout || '—'}</p>
        <div style="overflow-x: auto;">
            <table class="player-profile-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Previous Rating</th>
                        <th>Score</th>
                        <th>Round Rating</th>
                        <th>New Rating</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function getMonthData(year, month) {
    const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return { firstDay, daysInMonth };
}

function renderCalendar(container) {
    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayKey = new Date().toISOString().split('T')[0];

    const year = viewDate.getUTCFullYear();
    const month = viewDate.getUTCMonth();
    const { firstDay, daysInMonth } = getMonthData(year, month);

    const monthDisplay = `${monthNames[month]} ${year}`;

    const dayHeaders = dayNames.map(d => `<div>${d}</div>`).join('');

    let padding = '';
    for (let i = 0; i < firstDay; i++) {
        padding += '<div class="calendar-day padding-day"></div>';
    }

    const selectedRound = roundsData[selectedRoundIndex];

    let days = '';
    for (let d = 1; d <= daysInMonth; d++) {
        const dayKey = `${year}-${pad(month + 1)}-${pad(d)}`;
        const dayRounds = roundsData.filter(r => r.date === dayKey);
        const hasRounds = dayRounds.length > 0;
        const isToday = dayKey === todayKey;

        let pills = '';
        if (hasRounds) {
            const pillContainer = document.createElement('div');
            pills = dayRounds.map((r, i) => {
                const course = r.courseDisplay || r.course || 'Round';
                return `<div class="event-pill" data-round-id="${r.id}" style="cursor: pointer; background: var(--accent-color);" title="${course} - ${r.layout || ''}">${course}</div>`;
            }).join('');
            pills = `<div class="pill-container">${pills}</div>`;
        }

        const selectedClass = selectedRound && selectedRound.date === dayKey ? 'today' : '';
        const classes = ['calendar-day', isToday ? 'today' : '', hasRounds ? '' : 'no-events', selectedClass].filter(Boolean).join(' ');

        days += `
            <div class="${classes}" data-day="${dayKey}">
                <span class="day-number">${d}<span class="day-name">${dayNames[new Date(Date.UTC(year, month, d)).getUTCDay()]}</span></span>
                ${pills}
            </div>
        `;
    }

    const selectedHtml = selectedRound ? buildRoundTable(selectedRound) : '<p style="opacity: 0.7;">Select a round from the calendar to view the results.</p>';

    container.innerHTML = `
        <div class="calendar-main-unit" style="width: 100%;">
            <div class="calendar-header-container">
                <div class="month-nav" style="display: grid; grid-template-columns: 42px 280px 42px; align-items: center; gap: 1.25rem;">
                    <button type="button" id="ratings-prev" class="nav-arrow" title="Previous Month">
                        <i class="ph ph-caret-left"></i>
                    </button>

                    <div class="month-title-wrap" style="text-align: center;">
                        <h2 id="ratings-month-display" style="font-size: 1.8rem; font-weight: 800; margin: 0; color: var(--text-color); letter-spacing: -0.5px; text-transform: uppercase; white-space: nowrap;">${monthDisplay}</h2>
                        <div class="accent-underline"></div>
                    </div>

                    <button type="button" id="ratings-next" class="nav-arrow" title="Next Month">
                        <i class="ph ph-caret-right"></i>
                    </button>
                </div>
            </div>

            <div class="calendar-wrapper">
                <div class="calendar-days-header">
                    ${dayHeaders}
                </div>
                <div class="calendar-grid" id="ratings-calendar-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); width: 100%;">
                    ${padding}${days}
                </div>
            </div>

            <div id="ratings-selected-round" style="margin-top: 2rem;">
                ${selectedHtml}
            </div>
        </div>
    `;

    const prevBtn = container.querySelector('#ratings-prev');
    const nextBtn = container.querySelector('#ratings-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            viewDate = new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() - 1, 1));
            renderCalendar(container);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            viewDate = new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() + 1, 1));
            renderCalendar(container);
        });
    }

    container.querySelectorAll('.event-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const roundId = e.currentTarget.dataset.roundId;
            const idx = roundsData.findIndex(r => r.id === roundId);
            if (idx >= 0) {
                selectedRoundIndex = idx;
                renderCalendar(container);
            }
        });
    });
}

async function loadData() {
    const container = document.getElementById('rounds-list');
    if (!container) return;

    if (loaded) {
        renderCalendar(container);
        return;
    }

    try {
        const [roundsSnap, playersSnap] = await Promise.all([
            getDocs(query(collection(db, 'rounds'), orderBy('date', 'desc'))),
            getDocs(collection(db, 'players'))
        ]);

        playersSnap.forEach(docSnap => {
            playersById[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });

        roundsData = [];
        roundsSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data) roundsData.push({ id: docSnap.id, ...data });
        });

        loaded = true;

        if (roundsData.length === 0) {
            container.innerHTML = '<p style="opacity: 0.7;">No rated rounds in the database yet.</p>';
            return;
        }

        if (roundsData.length > 0) {
            const [y, m] = roundsData[0].date.split('-').map(Number);
            viewDate = new Date(Date.UTC(y, m - 1, 1));
            selectedRoundIndex = 0;
        }

        renderCalendar(container);
    } catch (err) {
        console.error(err);
        if (container) container.innerHTML = `<p style="opacity: 0.7;">Error loading rounds: ${err.message}</p>`;
    }
}

function handleHash() {
    if (window.location.hash === '#ratings') {
        loadData();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        handleHash();
        window.addEventListener('hashchange', handleHash);
    });
} else {
    handleHash();
    window.addEventListener('hashchange', handleHash);
}

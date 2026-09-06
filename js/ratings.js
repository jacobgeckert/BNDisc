import { db } from './firebase-config.js?v=100';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let roundsData = [];
let playersById = {};
let currentIndex = 0;
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
        <div class="admin-card" style="margin-top: 1rem;">
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
        </div>
    `;
}

function render(container) {
    if (roundsData.length === 0) {
        container.innerHTML = '<p style="opacity: 0.7;">No rated rounds in the database yet.</p>';
        return;
    }

    const round = roundsData[currentIndex];
    const courseDisplay = round.courseDisplay || round.course || 'Unknown course';
    const count = roundsData.length;

    container.innerHTML = `
        <div class="admin-card" style="padding: 1.5rem 2rem; margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; max-width: 480px; margin: 0 auto;">
                <button type="button" id="ratings-prev" class="nav-arrow" title="Previous Round">
                    <i class="ph ph-caret-left"></i>
                </button>

                <div style="text-align: center; flex: 1;">
                    <h2 style="font-size: 2rem; font-weight: 800; margin: 0; color: var(--text-color);">${formatDate(round.date)}</h2>
                    <div class="accent-underline" style="margin: 0.5rem auto;"></div>
                    <p style="margin: 0.3rem 0 0; opacity: 0.8; font-size: 0.95rem;">${courseDisplay} - ${round.layout || '—'}</p>
                    <p style="margin: 0.2rem 0 0; opacity: 0.6; font-size: 0.85rem;">Round ${currentIndex + 1} of ${count}</p>
                </div>

                <button type="button" id="ratings-next" class="nav-arrow" title="Next Round">
                    <i class="ph ph-caret-right"></i>
                </button>
            </div>
        </div>
        ${buildRoundTable(round)}
    `;

    const prevBtn = container.querySelector('#ratings-prev');
    const nextBtn = container.querySelector('#ratings-next');

    if (prevBtn) {
        prevBtn.disabled = currentIndex === 0;
        prevBtn.addEventListener('click', () => {
            if (currentIndex > 0) {
                currentIndex--;
                render(container);
            }
        });
    }
    if (nextBtn) {
        nextBtn.disabled = currentIndex === count - 1;
        nextBtn.addEventListener('click', () => {
            if (currentIndex < count - 1) {
                currentIndex++;
                render(container);
            }
        });
    }
}

async function loadData() {
    const container = document.getElementById('rounds-list');
    if (!container) return;

    if (loaded) {
        render(container);
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

        currentIndex = 0;
        render(container);
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

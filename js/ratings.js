import { db } from './firebase-config.js?v=100';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

async function loadData() {
    const container = document.getElementById('rounds-list');
    if (!container) return;

    try {
        const [roundsSnap, playersSnap] = await Promise.all([
            getDocs(query(collection(db, 'rounds'), orderBy('date', 'desc'))),
            getDocs(collection(db, 'players'))
        ]);

        const playersById = {};
        playersSnap.forEach(docSnap => {
            playersById[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });

        const rounds = [];
        roundsSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data) rounds.push({ id: docSnap.id, ...data });
        });

        if (rounds.length === 0) {
            container.innerHTML = '<p style="opacity: 0.7;">No rated rounds in the database yet.</p>';
            return;
        }

        const html = rounds.map(round => {
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
                <div style="margin-bottom: 2.5rem;">
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
        }).join('');

        container.innerHTML = html;
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

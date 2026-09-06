import { db } from './firebase-config.js?v=100';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const PPS_DEFAULTS = [
    { max: 0.80, pps: 13.0 },
    { max: 0.90, pps: 12.6 },
    { max: 1.00, pps: 12.2 },
    { max: 1.10, pps: 11.8 },
    { max: 1.20, pps: 11.4 },
    { max: 1.30, pps: 11.0 },
    { max: 1.40, pps: 10.6 },
    { max: 1.50, pps: 10.2 },
    { max: 1.60, pps: 9.8 },
    { max: 1.70, pps: 9.4 },
    { max: 1.80, pps: 9.0 },
    { max: 1.90, pps: 8.6 },
    { max: 2.00, pps: 8.2 },
    { max: 2.10, pps: 7.8 },
    { max: 2.20, pps: 7.4 },
    { max: Infinity, pps: 7.0 }
];

let ppsTable = PPS_DEFAULTS.map(r => ({ ...r }));

let raterPlayers = [];
let rows = [];
let selectedPlayer = null;

function calculateCurrentRating(history) {
    const sorted = (history || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const latest5 = sorted.slice(-5).filter(r => typeof r.rating === 'number');
    const previous10 = sorted.slice(-15, -5).filter(r => typeof r.rating === 'number');
    const denominator = latest5.length + previous10.length + 5;
    if (denominator === 0) return null;
    const weighted = latest5.reduce((sum, r) => sum + r.rating * 2, 0)
                   + previous10.reduce((sum, r) => sum + r.rating, 0);
    return Math.ceil(weighted / denominator);
}

function computePreRoundRating(player, manualInitial) {
    if (player) {
        const fromHistory = calculateCurrentRating(player.history);
        return fromHistory ?? player.currentRating ?? player.initialRating;
    }
    return manualInitial;
}

function computeHandicap(rating) {
    if (typeof rating !== 'number') return null;
    return Math.ceil(((1005 - rating) / 12) * 2) / 2;
}

function populationStdDev(values) {
    if (!values || values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
}

function stdDevLast15(history) {
    const sorted = (history || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (sorted.length < 15) return null;
    const ratings = sorted.slice(-15).map(r => r.rating).filter(r => typeof r === 'number');
    if (ratings.length < 15) return null;
    return populationStdDev(ratings);
}

function getPPS(ratio) {
    for (const row of ppsTable) {
        if (ratio <= row.max) return row.pps;
    }
    return 7.0;
}

function formatRatioRange(row, index) {
    if (row.max === Infinity) {
        const prevMax = ppsTable[index - 1]?.max ?? 2.20;
        return `> ${prevMax.toFixed(2)}`;
    }
    if (index === 0) {
        return `0.00 - ${row.max.toFixed(2)}`;
    }
    const lower = (ppsTable[index - 1].max + 0.01);
    return `${lower.toFixed(2)} - ${row.max.toFixed(2)}`;
}

function renderPPSTable() {
    const tbody = document.querySelector('#rr-pps-table tbody');
    if (!tbody) return;

    tbody.innerHTML = ppsTable.map((row, i) => `
        <tr>
            <td>${formatRatioRange(row, i)}</td>
            <td><input type="number" step="0.1" class="rr-pps-input" data-index="${i}" value="${row.pps.toFixed(1)}" style="width: 80px; padding: 0.3rem; border-radius: 4px; border: 1px solid var(--glass-border); background: var(--sidebar-bg); color: var(--text-color);"></td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.rr-pps-input').forEach(input => {
        input.addEventListener('change', () => {
            const idx = Number(input.dataset.index);
            const val = Number(input.value);
            if (!Number.isNaN(val) && val > 0) {
                ppsTable[idx].pps = val;
            }
        });
    });
}

function resetPPSTable() {
    ppsTable = PPS_DEFAULTS.map(r => ({ ...r }));
    renderPPSTable();
}

function formatRating(rating) {
    if (rating === null || rating === undefined) return '—';
    return Math.round(rating).toLocaleString();
}

async function loadRaterPlayers() {
    const status = document.getElementById('rr-summary');
    if (!window.location.hash.includes('admin')) return;
    try {
        const snapshot = await getDocs(collection(db, 'players'));
        raterPlayers = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data && data.name) {
                raterPlayers.push({ id: docSnap.id, ...data });
            }
        });
        raterPlayers.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
        if (status) status.textContent = `Error loading players: ${error.message}`;
    }
}

function filterPlayers(term) {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return raterPlayers.filter(p => p.name.toLowerCase().includes(t)).slice(0, 15);
}

function showSuggestions(matches) {
    const container = document.getElementById('rr-player-suggestions');
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
            const input = document.getElementById('rr-player-input');
            if (input) input.value = p.name;
            selectedPlayer = p;
            container.style.display = 'none';
        });
        container.appendChild(item);
    });
    container.style.display = 'block';
}

function hideSuggestions() {
    const container = document.getElementById('rr-player-suggestions');
    if (container) container.style.display = 'none';
}

function findPlayerByName(name) {
    return raterPlayers.find(p => p.name.toLowerCase() === name.trim().toLowerCase()) || null;
}

function addRow() {
    const nameInput = document.getElementById('rr-player-input');
    const scoreInput = document.getElementById('rr-score');
    const initialInput = document.getElementById('rr-initial-rating');
    const summary = document.getElementById('rr-summary');

    const name = nameInput?.value.trim();
    const score = scoreInput?.value ? Number(scoreInput.value) : null;
    const manualInitial = initialInput?.value ? Number(initialInput.value) : null;

    if (!name) {
        if (summary) summary.textContent = 'Please enter a player name.';
        return;
    }
    if (score === null || Number.isNaN(score)) {
        if (summary) summary.textContent = 'Please enter a valid score.';
        return;
    }

    const existing = findPlayerByName(name);
    if (existing) {
        if (rows.some(r => r.name.toLowerCase() === existing.name.toLowerCase())) {
            if (summary) summary.textContent = `${existing.name} is already in the round.`;
            return;
        }
    } else {
        if (manualInitial === null || Number.isNaN(manualInitial)) {
            if (summary) summary.textContent = 'New players require an initial rating.';
            return;
        }
    }

    const player = existing || null;
    const preRoundRating = computePreRoundRating(player, manualInitial);
    const history = player?.history || [];
    const roundsPlayed = player?.stats?.roundsPlayed ?? history.length;
    const qualified = roundsPlayed > 14;

    rows.push({
        id: Math.random().toString(36).slice(2),
        name: player?.name || name,
        player,
        score,
        preRoundRating,
        handicap: computeHandicap(preRoundRating),
        qualified: qualified ? 'Yes' : 'No',
        roundsPlayed,
        initialEstimate: null,
        diff: null,
        stdDev: null,
        finalRoundRating: null,
        eliminated: false
    });

    nameInput.value = '';
    scoreInput.value = '';
    initialInput.value = '';
    selectedPlayer = null;
    hideSuggestions();
    renderTable();
    if (summary) summary.textContent = '';
}

function removeRow(id) {
    rows = rows.filter(r => r.id !== id);
    renderTable();
}

function clearTable() {
    rows = [];
    renderTable();
    const summary = document.getElementById('rr-summary');
    if (summary) summary.textContent = '';
}

function renderTable() {
    const tbody = document.querySelector('#rr-table tbody');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; opacity: 0.7;">Add players to rate the round.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(row => `
        <tr style="${row.eliminated ? 'background: rgba(255,105,180,0.25);' : ''}">
            <td>${row.name}</td>
            <td>${row.score}</td>
            <td>${row.qualified}</td>
            <td>${formatRating(row.preRoundRating)}</td>
            <td>${row.handicap !== null ? row.handicap.toFixed(1) : '—'}</td>
            <td>${formatRating(row.initialEstimate)}</td>
            <td>${formatRating(row.diff)}</td>
            <td>${row.stdDev !== null ? row.stdDev.toFixed(2) : '—'}</td>
            <td>${formatRating(row.finalRoundRating)}</td>
            <td><button type="button" class="rr-remove-btn" data-id="${row.id}" style="padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-color); cursor: pointer;">×</button></td>
        </tr>
    `).join('');
}

function rateRound() {
    const summary = document.getElementById('rr-summary');
    const adjustInput = document.getElementById('rr-rating-adjust');

    if (rows.length === 0) {
        if (summary) summary.textContent = 'Add players before rating.';
        return;
    }

    const qualifiedRows = rows.filter(r => r.qualified === 'Yes');
    const validQualifiedRows = qualifiedRows.filter(r =>
        typeof r.preRoundRating === 'number' &&
        typeof r.score === 'number' &&
        typeof r.handicap === 'number'
    );

    if (validQualifiedRows.length < 8) {
        if (summary) summary.textContent = 'Need at least 8 qualified players with valid ratings and handicaps to rate round.';
        return;
    }

    rows.forEach(r => {
        r.initialEstimate = null;
        r.diff = null;
        r.stdDev = null;
        r.finalRoundRating = null;
        r.eliminated = false;
    });

    const ratings = validQualifiedRows.map(r => r.preRoundRating);
    const scores = validQualifiedRows.map(r => r.score);
    const handicaps = validQualifiedRows.map(r => r.handicap);

    const genBenchmarkRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const genBenchmarkScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const avgHandicap = handicaps.reduce((a, b) => a + b, 0) / handicaps.length;

    const scoreSD = populationStdDev(scores);
    const handicapSD = populationStdDev(handicaps);

    if (handicapSD === 0) {
        if (summary) summary.textContent = 'Handicap standard deviation is zero; cannot compute PPS.';
        return;
    }

    let ppsRatio = scoreSD / handicapSD;
    ppsRatio = Math.ceil(ppsRatio * 100) / 100;

    const pps = getPPS(ppsRatio);

    validQualifiedRows.forEach(row => {
        row.initialEstimate = Math.ceil((genBenchmarkScore - row.score) * pps + genBenchmarkRating);
        row.diff = Math.ceil(row.initialEstimate - row.preRoundRating);
    });

    if (validQualifiedRows.length > 9) {
        const diffs = validQualifiedRows.map(r => r.diff).filter(d => typeof d === 'number');
        const positiveDiffs = diffs.filter(d => d > 0);
        const negativeDiffs = diffs.filter(d => d < 0);
        const maxPositive = positiveDiffs.length ? Math.max(...positiveDiffs) : null;
        const minNegative = negativeDiffs.length ? Math.min(...negativeDiffs) : null;
        validQualifiedRows.forEach(row => {
            if ((maxPositive !== null && row.diff === maxPositive) || (minNegative !== null && row.diff === minNegative)) {
                row.eliminated = true;
            }
        });
    }

    if (validQualifiedRows.length > 10) {
        validQualifiedRows.forEach(row => {
            if (!row.eliminated) {
                row.stdDev = stdDevLast15(row.player?.history);
            }
        });

        const withStdDev = validQualifiedRows.filter(r => !r.eliminated && r.stdDev !== null);
        if (withStdDev.length > 8) {
            const sorted = withStdDev.slice().sort((a, b) => b.stdDev - a.stdDev);
            const toEliminate = sorted.length - 8;
            for (let i = 0; i < toEliminate; i++) {
                sorted[i].eliminated = true;
            }
        }
    }

    const adjustment = adjustInput?.value ? Number(adjustInput.value) : 0;
    const finalRows = validQualifiedRows.filter(r => !r.eliminated);
    const finalScores = finalRows.map(r => r.score);
    const finalRatings = finalRows.map(r => r.preRoundRating);
    const finalScore = finalScores.reduce((a, b) => a + b, 0) / finalScores.length;
    const finalBenchmarkRating = (finalRatings.reduce((a, b) => a + b, 0) / finalRatings.length) + adjustment;

    rows.forEach(row => {
        row.finalRoundRating = Math.ceil((finalScore - row.score) * pps + finalBenchmarkRating);
    });

    renderTable();

    if (summary) {
        summary.innerHTML = `
            Qualified: ${qualifiedRows.length} &bull;
            Eliminated: ${validQualifiedRows.filter(r => r.eliminated).length} &bull;
            Gen Benchmark Rating: ${Math.round(genBenchmarkRating).toLocaleString()} &bull;
            Gen Benchmark Score: ${Math.round(genBenchmarkScore).toLocaleString()} &bull;
            PPS Ratio: ${ppsRatio.toFixed(2)} &bull;
            PPS: ${pps.toFixed(2)} &bull;
            Final Score: ${Math.round(finalScore).toLocaleString()} &bull;
            Final Benchmark Rating: ${Math.round(finalBenchmarkRating).toLocaleString()}
        `;
    }
}

function initRoundRater() {
    const dateInput = document.getElementById('rr-date');
    if (dateInput) dateInput.value = new Date().toLocaleDateString('en-CA');

    const playerInput = document.getElementById('rr-player-input');
    if (playerInput) {
        playerInput.addEventListener('input', (e) => {
            selectedPlayer = null;
            showSuggestions(filterPlayers(e.target.value));
        });
        playerInput.addEventListener('blur', () => {
            window.setTimeout(hideSuggestions, 150);
        });
        playerInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const matches = filterPlayers(playerInput.value);
                if (matches.length > 0) {
                    playerInput.value = matches[0].name;
                    selectedPlayer = matches[0];
                    hideSuggestions();
                }
            }
        });
    }

    const addBtn = document.getElementById('rr-add-player');
    if (addBtn) addBtn.addEventListener('click', addRow);

    const clearBtn = document.getElementById('rr-clear-table');
    if (clearBtn) clearBtn.addEventListener('click', clearTable);

    const resetPpsBtn = document.getElementById('rr-reset-pps');
    if (resetPpsBtn) resetPpsBtn.addEventListener('click', resetPPSTable);

    renderPPSTable();

    const form = document.getElementById('round-rater-form');
    if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        rateRound();
    });

    const table = document.getElementById('rr-table');
    if (table) {
        table.addEventListener('click', (e) => {
            const btn = e.target.closest('.rr-remove-btn');
            if (btn) removeRow(btn.dataset.id);
        });
    }

    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#admin' && raterPlayers.length === 0) {
            loadRaterPlayers();
        }
    });

    loadRaterPlayers();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRoundRater);
} else {
    initRoundRater();
}

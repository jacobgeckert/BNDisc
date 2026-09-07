import { db } from './firebase-config.js?v=100';
import { collection, getDocs, getDoc, doc, setDoc, writeBatch, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { LOCATIONS, LAYOUT_SUGGESTIONS, getCourseStorageName, getCourseDisplayName } from './courseData.js?v=100';

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
    const sorted = (history || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
    const latest5 = sorted.slice(-5).filter(r => typeof r.rating === 'number');
    const previous10 = sorted.slice(-15, -5).filter(r => typeof r.rating === 'number');
    const denominator = latest5.length * 2 + previous10.length;
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

function slug(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function playerId(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeAttr(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

function findColumnKey(headers, candidates) {
    const lowerHeaders = headers.map(h => String(h).toLowerCase().trim());
    for (const cand of candidates) {
        const idx = lowerHeaders.indexOf(cand.toLowerCase());
        if (idx !== -1) return headers[idx];
    }
    return null;
}

async function importXlsx(file) {
    const summary = document.getElementById('rr-summary');
    const XLSX = window.XLSX;

    const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
        const dateInput = document.getElementById('rr-date');
        if (dateInput) dateInput.value = dateMatch[1];
    }

    if (!XLSX) {
        if (summary) summary.textContent = 'Spreadsheet library not loaded. Please refresh and try again.';
        return;
    }
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        if (!workbook.SheetNames.length) {
            if (summary) summary.textContent = 'No sheets found in file.';
            return;
        }
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsedRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        if (!parsedRows.length) {
            if (summary) summary.textContent = 'No data rows found in file.';
            return;
        }

        const headers = Object.keys(parsedRows[0]);
        const nameKey = findColumnKey(headers, ['name', 'player', 'player name']);
        const scoreKey = findColumnKey(headers, ['event_total_score', 'event total score', 'total score', 'total', 'score']);
        if (!nameKey || !scoreKey) {
            if (summary) summary.textContent = 'Could not find name and event_total_score columns.';
            return;
        }

        for (const row of parsedRows) {
            const name = String(row[nameKey] || '').trim();
            const rawScore = row[scoreKey];
            const score = typeof rawScore === 'number' ? rawScore : Number(String(rawScore).trim());
            if (!name || Number.isNaN(score)) continue;
            addRaterRow(name, score, null, { skipDuplicate: true });
        }

        if (summary) {
            summary.textContent = '';
        }
    } catch (err) {
        console.error(err);
        if (summary) summary.textContent = `Error reading file: ${err.message}`;
    }
}

function addRaterRow(name, score, manualInitial, options = {}) {
    const { skipDuplicate = false } = options;
    const summary = document.getElementById('rr-summary');

    if (!name || score === null || Number.isNaN(score)) {
        if (!skipDuplicate && summary) summary.textContent = 'Please enter a valid player name and score.';
        return false;
    }

    const trimmed = name.trim();
    if (rows.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
        if (!skipDuplicate && summary) summary.textContent = `${trimmed} is already in the round.`;
        return false;
    }

    const player = findPlayerByName(trimmed) || null;
    let preRoundRating;
    if (player) {
        preRoundRating = computePreRoundRating(player, null);
    } else if (typeof manualInitial === 'number' && !Number.isNaN(manualInitial)) {
        preRoundRating = manualInitial;
    } else {
        preRoundRating = null;
    }

    const history = player?.history || [];
    const roundsPlayed = player?.stats?.roundsPlayed ?? history.length;
    const qualified = roundsPlayed > 14;
    const preRoundRatingNum = typeof preRoundRating === 'number' ? preRoundRating : null;

    rows.push({
        id: Math.random().toString(36).slice(2),
        name: player?.name || trimmed,
        player,
        score,
        preRoundRating: preRoundRatingNum,
        handicap: computeHandicap(preRoundRatingNum),
        qualified: qualified ? 'Yes' : 'No',
        roundsPlayed,
        initialEstimate: null,
        diff: null,
        stdDev: null,
        finalRoundRating: null,
        eliminated: false,
        eliminationReason: null
    });

    renderTable();
    if (!skipDuplicate && summary) summary.textContent = '';
    return true;
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

    const player = findPlayerByName(name);
    if (!player && (manualInitial === null || Number.isNaN(manualInitial))) {
        if (summary) summary.textContent = 'New players require an initial rating.';
        return;
    }

    const added = addRaterRow(name, score, manualInitial, { skipDuplicate: false });
    if (added) {
        nameInput.value = '';
        scoreInput.value = '';
        initialInput.value = '';
        selectedPlayer = null;
        hideSuggestions();
    }
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

function clearInputs() {
    const dateInput = document.getElementById('rr-date');
    if (dateInput) dateInput.value = new Date().toLocaleDateString('en-CA');

    const inputs = ['rr-location', 'rr-layout', 'rr-rating-adjust', 'rr-player-input', 'rr-score', 'rr-initial-rating'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'rr-rating-adjust') {
            el.value = '0';
        } else {
            el.value = '';
        }
    });
}

function updateRow(id, field, value) {
    const row = rows.find(r => r.id === id);
    if (!row) return;

    if (field === 'name') {
        const name = String(value).trim();
        if (!name) return;
        row.name = name;
        row.player = findPlayerByName(name);
        if (row.player) {
            row.preRoundRating = computePreRoundRating(row.player, null);
            row.roundsPlayed = row.player?.stats?.roundsPlayed ?? (row.player?.history || []).length;
            row.qualified = row.roundsPlayed > 14 ? 'Yes' : 'No';
            row.handicap = computeHandicap(row.preRoundRating);
        } else {
            row.player = null;
            row.preRoundRating = null;
            row.roundsPlayed = 0;
            row.qualified = 'No';
            row.handicap = null;
        }
        row.initialEstimate = null;
        row.diff = null;
        row.stdDev = null;
        row.finalRoundRating = null;
        row.eliminated = false;
        row.eliminationReason = null;
    } else if (field === 'score') {
        const score = value === '' ? null : Number(value);
        row.score = score !== null && Number.isNaN(score) ? null : score;
        row.initialEstimate = null;
        row.diff = null;
        row.finalRoundRating = null;
    }

    renderTable();
}

function renderTable() {
    const tbody = document.querySelector('#rr-table tbody');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; opacity: 0.7;">Add players to rate the round.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(row => `
        <tr style="${row.eliminated ? 'background: rgba(255,105,180,0.25);' : ''}">
            <td><input type="text" class="rr-edit-name" data-id="${row.id}" value="${escapeAttr(row.name)}" style="width: 100%; padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-color); box-sizing: border-box;"></td>
            <td><input type="number" class="rr-edit-score" data-id="${row.id}" value="${row.score ?? ''}" style="width: 5rem; padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-color); box-sizing: border-box;"></td>
            <td>${row.qualified}</td>
            <td>${formatRating(row.preRoundRating)}</td>
            <td>${row.handicap !== null ? row.handicap.toFixed(1) : '—'}</td>
            <td>${formatRating(row.initialEstimate)}</td>
            <td>${formatRating(row.diff)}</td>
            <td>${row.stdDev !== null ? row.stdDev.toFixed(2) : '—'}</td>
            <td>${row.eliminationReason || '—'}</td>
            <td>${formatRating(row.finalRoundRating)}</td>
            <td><button type="button" class="rr-remove-btn" data-id="${row.id}" style="padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-color); cursor: pointer;">×</button></td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.rr-edit-name').forEach(input => {
        input.addEventListener('change', (e) => {
            updateRow(e.target.dataset.id, 'name', e.target.value);
        });
    });
    tbody.querySelectorAll('.rr-edit-score').forEach(input => {
        input.addEventListener('change', (e) => {
            updateRow(e.target.dataset.id, 'score', e.target.value);
        });
    });
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
        r.eliminationReason = null;
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
                row.eliminationReason = 'Eliminated: initial estimate outlier';
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
                sorted[i].eliminationReason = 'Eliminated: high last-15 round variance';
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

async function pushRoundToDatabase() {
    const summary = document.getElementById('rr-summary');
    const dateInput = document.getElementById('rr-date');
    const locationInput = document.getElementById('rr-location');
    const layoutInput = document.getElementById('rr-layout');

    const date = dateInput?.value;
    const loc = locationInput?.value.trim();
    const layout = layoutInput?.value.trim();

    if (!date || !loc || !layout) {
        if (summary) summary.textContent = 'Please fill out Date, Location, and Layout before pushing the round.';
        return;
    }

    if (rows.length === 0) {
        if (summary) summary.textContent = 'Add and rate at least one player before pushing.';
        return;
    }

    if (rows.some(r => typeof r.finalRoundRating !== 'number')) {
        if (summary) summary.textContent = 'Rate the round before pushing to the database.';
        return;
    }

    const course = getCourseStorageName(loc);
    const courseDisplay = getCourseDisplayName(course);
    const roundId = `${date}_${slug(course)}_${slug(layout)}`;

    try {
        const roundRef = doc(db, 'rounds', roundId);
        const existing = await getDoc(roundRef);
        if (existing.exists()) {
            if (summary) summary.textContent = `A round with ID ${roundId} already exists. Use a different date, location, or layout.`;
            return;
        }

        const batch = writeBatch(db);
        const scores = {};
        const playerIds = [];
        const roundHistoryEntry = { roundId, date, course, courseDisplay, layout };

        for (const row of rows) {
            const pid = playerId(row.name);
            const name = row.player?.name || row.name;
            scores[pid] = { name, score: row.score, rating: row.finalRoundRating };
            playerIds.push(pid);

            let playerData;
            if (row.player) {
                const newHistory = [...(row.player.history || []), { ...roundHistoryEntry, score: row.score, rating: row.finalRoundRating }];
                newHistory.sort((a, b) => a.date.localeCompare(b.date));
                const allScores = newHistory.map(h => h.score).filter(n => typeof n === 'number');
                const allRatings = newHistory.map(h => h.rating).filter(n => typeof n === 'number');
                playerData = {
                    playerId: pid,
                    name,
                    initialRating: row.player.initialRating ?? (newHistory.length ? newHistory[0].rating : null),
                    currentRating: calculateCurrentRating(newHistory),
                    stats: {
                        roundsPlayed: newHistory.length,
                        averageScore: allScores.length ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2)) : null,
                        bestScore: allScores.length ? Math.min(...allScores) : null,
                        averageRating: allRatings.length ? Number((allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(2)) : null,
                        bestRating: allRatings.length ? Math.max(...allRatings) : null
                    },
                    history: newHistory
                };
            } else {
                const newHistory = [{ ...roundHistoryEntry, score: row.score, rating: row.finalRoundRating }];
                const allScores = [row.score];
                const allRatings = [row.finalRoundRating];
                playerData = {
                    playerId: pid,
                    name,
                    initialRating: newHistory[0].rating,
                    currentRating: calculateCurrentRating(newHistory),
                    stats: {
                        roundsPlayed: 1,
                        averageScore: Number(row.score.toFixed(2)),
                        bestScore: row.score,
                        averageRating: Number(row.finalRoundRating.toFixed(2)),
                        bestRating: row.finalRoundRating
                    },
                    history: newHistory
                };
            }

            batch.set(doc(db, 'players', pid), playerData);
        }

        batch.set(roundRef, {
            date,
            course,
            courseDisplay,
            layout,
            playerIds,
            scores
        });
        batch.set(doc(db, 'players', 'lastUpdate'), { updatedAt: new Date().toISOString() });

        await batch.commit();
        clearTable();
        clearInputs();
        loadLatestRoundDate();
        window.dispatchEvent(new CustomEvent('roundPushed'));
        window.alert('Round successfully pushed to the database.');
        if (summary) summary.textContent = 'Round pushed to database successfully.';
    } catch (err) {
        console.error(err);
        if (summary) summary.textContent = `Error pushing round: ${err.message}`;
    }
}

function initRoundRaterSuggestions() {
    const locationInput = document.getElementById('rr-location');
    const layoutInput = document.getElementById('rr-layout');
    const locationSuggestions = document.getElementById('rr-location-suggestions');
    const layoutSuggestions = document.getElementById('rr-layout-suggestions');

    function updateLocationSuggestions() {
        if (!locationSuggestions || !locationInput) return;
        const term = locationInput.value.toLowerCase();
        const matches = LOCATIONS.filter(l => l.toLowerCase().includes(term));
        locationSuggestions.innerHTML = '';
        if (matches.length === 0) {
            locationSuggestions.style.display = 'none';
            return;
        }
        matches.forEach(l => {
            const div = document.createElement('div');
            div.textContent = l;
            div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--glass-border);';
            div.onmousedown = (e) => {
                e.preventDefault();
                locationInput.value = l;
                locationSuggestions.style.display = 'none';
            };
            div.onmouseenter = () => div.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))';
            div.onmouseleave = () => div.style.background = '';
            locationSuggestions.appendChild(div);
        });
        locationSuggestions.style.display = 'block';
    }

    function updateLayoutSuggestions() {
        if (!layoutSuggestions || !layoutInput) return;
        const loc = (locationInput?.value || '').toLowerCase().trim();
        const term = layoutInput.value.toLowerCase();
        const options = LAYOUT_SUGGESTIONS[loc] || [];
        const matches = options.filter(o => o.toLowerCase().includes(term));
        layoutSuggestions.innerHTML = '';
        if (matches.length === 0) {
            layoutSuggestions.style.display = 'none';
            return;
        }
        matches.forEach(l => {
            const div = document.createElement('div');
            div.textContent = l;
            div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--glass-border);';
            div.onmousedown = (e) => {
                e.preventDefault();
                layoutInput.value = l;
                layoutSuggestions.style.display = 'none';
            };
            div.onmouseenter = () => div.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))';
            div.onmouseleave = () => div.style.background = '';
            layoutSuggestions.appendChild(div);
        });
        layoutSuggestions.style.display = 'block';
    }

    if (locationInput) {
        locationInput.addEventListener('input', updateLocationSuggestions);
        locationInput.addEventListener('focus', updateLocationSuggestions);
        locationInput.addEventListener('blur', () => {
            setTimeout(() => { if (locationSuggestions) locationSuggestions.style.display = 'none'; }, 150);
        });
    }
    if (layoutInput) {
        layoutInput.addEventListener('input', updateLayoutSuggestions);
        layoutInput.addEventListener('focus', updateLayoutSuggestions);
        layoutInput.addEventListener('blur', () => {
            setTimeout(() => { if (layoutSuggestions) layoutSuggestions.style.display = 'none'; }, 150);
        });
    }
}

async function loadLatestRound() {
    const summary = document.getElementById('rr-summary');
    try {
        const q = query(collection(db, 'rounds'), orderBy('date', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            if (summary) summary.textContent = 'No rounds found in the database.';
            return;
        }

        const roundDoc = snapshot.docs[0];
        const data = roundDoc.data();

        const dateInput = document.getElementById('rr-date');
        const locationInput = document.getElementById('rr-location');
        const layoutInput = document.getElementById('rr-layout');

        if (dateInput) dateInput.value = data.date || '';
        if (locationInput) locationInput.value = data.courseDisplay || data.course || '';
        if (layoutInput) layoutInput.value = data.layout || '';

        rows = [];
        const playerIds = data.playerIds || [];
        const scores = data.scores || {};

        for (const pid of playerIds) {
            const entry = scores[pid];
            if (!entry) continue;
            rows.push({
                id: Math.random().toString(36).slice(2),
                name: entry.name,
                player: null,
                score: Number(entry.score),
                preRoundRating: null,
                handicap: null,
                qualified: 'No',
                roundsPlayed: null,
                initialEstimate: null,
                diff: null,
                stdDev: null,
                finalRoundRating: typeof entry.rating === 'number' ? entry.rating : null,
                eliminated: false,
                eliminationReason: null
            });
        }

        renderTable();
        if (summary) summary.textContent = `Loaded round from ${data.date} at ${data.courseDisplay || data.course} / ${data.layout} with ${rows.length} player${rows.length === 1 ? '' : 's'}.`;
    } catch (err) {
        console.error(err);
        if (summary) summary.textContent = `Error loading latest round: ${err.message}`;
    }
}

async function loadLatestRoundDate() {
    const label = document.getElementById('rr-latest-round-date');
    if (!label) return;
    try {
        const q = query(collection(db, 'rounds'), orderBy('date', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            label.textContent = 'No rounds in the database yet.';
            return;
        }
        const data = snapshot.docs[0].data();
        const display = data.courseDisplay || data.course || 'Unknown course';
        label.textContent = `Last Rated Round was on ${data.date} at ${display} - ${data.layout}`;
    } catch (err) {
        console.error(err);
        label.textContent = 'Unable to load latest round date.';
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

    const importInput = document.getElementById('rr-import-xlsx');
    const importBtn = document.getElementById('rr-import-xlsx-btn');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
    }
    if (importInput) {
        importInput.addEventListener('change', (e) => {
            if (e.target.files.length) importXlsx(e.target.files[0]);
            e.target.value = '';
        });
    }

    renderPPSTable();
    initRoundRaterSuggestions();

    const form = document.getElementById('round-rater-form');
    if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        rateRound();
    });

    const pushBtn = document.getElementById('rr-push-round');
    if (pushBtn) pushBtn.addEventListener('click', pushRoundToDatabase);

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
    loadLatestRoundDate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRoundRater);
} else {
    initRoundRater();
}

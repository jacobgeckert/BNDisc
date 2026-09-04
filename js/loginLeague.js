import { auth, db } from './firebase-config.js?v=100';
import { 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithRedirect,
    signInWithEmailAndPassword,
    getRedirectResult,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isLeagueAdmin, checkLeagueAdminEligibility, getLocalRoster, getRoster, getCachedDoc, refreshCachedDoc } from './firestore.js?v=101';
import { bindFirstTimeSetup } from './authSetup.js?v=100';
import { LOCATIONS, LAYOUT_SUGGESTIONS, getCourseDisplayName, getCourseStorageName } from './courseData.js?v=100';

const provider = new GoogleAuthProvider();
let isChecking = false;
let cardsVisible = false;
let editingIndex = null;
let selectedLeague = null;
let currentRoster = [];
const CHECKINS_KEY = 'bndisc_checkins';
const ACE_PAYERS_KEY = 'bndisc_ace_payers';
const CHECKIN_TAGS_KEY = 'bndisc_checkin_tags';
const CHECKIN_TAGS_ORIGINAL_KEY = 'bndisc_checkin_tags_original';
const ROUND_SCORES_KEY = 'bndisc_round_scores';
const LEAGUE_HASH_KEY = 'bndisc_league_hash';
const TAGS_ASSIGNED_KEY = 'bndisc_tags_assigned';

const EVENT_CACHE_TTL_MS = 15 * 60 * 1000;
const COURSE_RECORD_CACHE_TTL_MS = 60 * 60 * 1000;

let tagsAssigned = false;
let userLeagues = [];
let isFinalizing = false;

function getTagsAssigned() {
    try { return localStorage.getItem(TAGS_ASSIGNED_KEY) === 'true'; } catch (e) { return false; }
}

function saveTagsAssigned(val) {
    try { localStorage.setItem(TAGS_ASSIGNED_KEY, val ? 'true' : 'false'); } catch (e) {}
}

function updateTagControls() {
    const leagueType = selectedLeague?.leagueType?.toLowerCase();
    const isDoubles = leagueType === 'doubles';
    const tab = document.getElementById('league-tab-tags');
    const tagInput = document.getElementById('league-checkin-tag');
    const tagLabel = document.querySelector('label[for="league-checkin-tag"]');
    if (tab) tab.style.display = isDoubles ? 'none' : '';
    if (tagInput) tagInput.style.display = isDoubles ? 'none' : '';
    if (tagLabel) tagLabel.style.display = isDoubles ? 'none' : '';
    if (isDoubles) {
        const tagsPanel = document.getElementById('league-tags-panel');
        if (tagsPanel && tagsPanel.style.display === 'block') {
            switchLeagueTab('checkin');
        }
    }
}

const PAYOUT_TABLE = [
    [100.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [57.98, 42.02, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [44.2, 32.26, 23.55, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [37.41, 27.5, 20.22, 14.87, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [33.37, 24.72, 18.31, 13.56, 10.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [30.68, 22.89, 17.08, 12.75, 9.51, 7.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [28.72, 21.59, 16.23, 12.21, 9.18, 6.9, 5.19, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [27.2, 20.6, 15.61, 11.83, 8.96, 6.79, 5.14, 3.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [25.95, 19.81, 15.12, 11.54, 8.81, 6.73, 5.14, 3.92, 2.99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [24.89, 19.15, 14.73, 11.33, 8.71, 6.7, 5.16, 3.97, 3.05, 2.35, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [23.94, 18.56, 14.39, 11.15, 8.65, 6.7, 5.2, 4.03, 3.12, 2.42, 1.88, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [23.08, 18.03, 14.08, 11.0, 8.6, 6.72, 5.25, 4.1, 3.2, 2.5, 1.96, 1.53, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [22.27, 17.54, 13.81, 10.87, 8.56, 6.74, 5.31, 4.18, 3.29, 2.59, 2.04, 1.61, 1.27, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [21.49, 17.05, 13.53, 10.74, 8.53, 6.77, 5.37, 4.26, 3.38, 2.68, 2.13, 1.69, 1.34, 1.07, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [20.74, 16.59, 13.27, 10.62, 8.49, 6.8, 5.44, 4.35, 3.48, 2.78, 2.23, 1.78, 1.43, 1.14, 0.91, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [20.01, 16.13, 13.01, 10.49, 8.46, 6.82, 5.5, 4.44, 3.58, 2.89, 2.33, 1.88, 1.51, 1.22, 0.99, 0.79, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [19.3, 15.69, 12.75, 10.37, 8.43, 6.85, 5.57, 4.53, 3.68, 2.99, 2.43, 1.98, 1.61, 1.31, 1.06, 0.87, 0.7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [18.57, 15.22, 12.48, 10.23, 8.38, 6.87, 5.63, 4.62, 3.78, 3.1, 2.54, 2.08, 1.71, 1.4, 1.15, 0.94, 0.77, 0.63, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [17.84, 14.74, 12.18, 10.07, 8.32, 6.88, 5.68, 4.7, 3.88, 3.21, 2.65, 2.19, 1.81, 1.5, 1.24, 1.02, 0.85, 0.7, 0.58, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [17.12, 14.27, 11.89, 9.91, 8.26, 6.88, 5.74, 4.78, 3.98, 3.32, 2.77, 2.31, 1.92, 1.6, 1.33, 1.11, 0.93, 0.77, 0.64, 0.54, 0.0, 0.0, 0.0, 0.0, 0.0],
    [16.41, 13.79, 11.59, 9.74, 8.18, 6.88, 5.78, 4.86, 4.08, 3.43, 2.88, 2.42, 2.04, 1.71, 1.44, 1.21, 1.02, 0.85, 0.72, 0.6, 0.51, 0.0, 0.0, 0.0, 0.0],
    [15.68, 13.29, 11.26, 9.54, 8.09, 6.85, 5.81, 4.92, 4.17, 3.53, 3.0, 2.54, 2.15, 1.82, 1.55, 1.31, 1.11, 0.94, 0.8, 0.68, 0.57, 0.49, 0.0, 0.0, 0.0],
    [14.96, 12.79, 10.93, 9.34, 7.98, 6.82, 5.83, 4.99, 4.26, 3.64, 3.11, 2.66, 2.27, 1.94, 1.66, 1.42, 1.21, 1.04, 0.89, 0.76, 0.65, 0.55, 0.47, 0.0, 0.0],
    [14.22, 12.26, 10.57, 9.11, 7.85, 6.77, 5.84, 5.03, 4.34, 3.74, 3.22, 2.78, 2.4, 2.07, 1.78, 1.53, 1.32, 1.14, 0.98, 0.85, 0.73, 0.63, 0.54, 0.47, 0.0],
    [13.45, 11.7, 10.17, 8.85, 7.69, 6.69, 5.82, 5.06, 4.4, 3.82, 3.33, 2.89, 2.52, 2.19, 1.9, 1.65, 1.44, 1.25, 1.09, 0.95, 0.82, 0.72, 0.62, 0.54, 0.47]
];

const SCRATCH_PAYOUTS = {
    3: [8, 4],
    4: [10, 6],
    5: [12, 8]
};

function getScratchPayoutTable() {
    return `
        <table style="width: 100%; border-collapse: collapse; margin-top: 0.5rem;">
            <thead>
                <tr style="border-bottom: 1px solid var(--glass-border);">
                    <th style="text-align: left; padding: 0.5rem;"># on Card</th>
                    <th style="text-align: left; padding: 0.5rem;">1st Place</th>
                    <th style="text-align: left; padding: 0.5rem;">2nd Place</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="padding: 0.5rem;">5</td>
                    <td style="padding: 0.5rem;">$12.00</td>
                    <td style="padding: 0.5rem;">$8.00</td>
                </tr>
                <tr>
                    <td style="padding: 0.5rem;">4</td>
                    <td style="padding: 0.5rem;">$10.00</td>
                    <td style="padding: 0.5rem;">$6.00</td>
                </tr>
                <tr>
                    <td style="padding: 0.5rem;">3</td>
                    <td style="padding: 0.5rem;">$8.00</td>
                    <td style="padding: 0.5rem;">$4.00</td>
                </tr>
            </tbody>
        </table>
    `;
}

function getCheckins() {
    try {
        return JSON.parse(localStorage.getItem(CHECKINS_KEY)) || [];
    } catch (e) {
        console.warn('Could not read checkins from localStorage:', e);
        return [];
    }
}

function saveCheckins(checkins) {
    localStorage.setItem(CHECKINS_KEY, JSON.stringify(checkins));
}

function getAcePayers() {
    try {
        return JSON.parse(localStorage.getItem(ACE_PAYERS_KEY)) || [];
    } catch (e) {
        console.warn('Could not read ace payers from localStorage:', e);
        return [];
    }
}

function saveAcePayers(acePayers) {
    localStorage.setItem(ACE_PAYERS_KEY, JSON.stringify(acePayers));
}

function getCheckinTags() {
    try {
        return JSON.parse(localStorage.getItem(CHECKIN_TAGS_KEY)) || {};
    } catch (e) {
        console.warn('Could not read checkin tags from localStorage:', e);
        return {};
    }
}

function saveCheckinTags(tags) {
    localStorage.setItem(CHECKIN_TAGS_KEY, JSON.stringify(tags));
}

function getCheckinTagsOriginal() {
    try {
        return JSON.parse(localStorage.getItem(CHECKIN_TAGS_ORIGINAL_KEY)) || {};
    } catch (e) {
        console.warn('Could not read original checkin tags from localStorage:', e);
        return {};
    }
}

function saveCheckinTagsOriginal(tags) {
    localStorage.setItem(CHECKIN_TAGS_ORIGINAL_KEY, JSON.stringify(tags));
}

function getRoundScores() {
    try {
        return JSON.parse(localStorage.getItem(ROUND_SCORES_KEY)) || {};
    } catch (e) {
        console.warn('Could not read round scores from localStorage:', e);
        return {};
    }
}

function saveRoundScores(scores) {
    localStorage.setItem(ROUND_SCORES_KEY, JSON.stringify(scores));
}

async function loadLeagueCheckin() {
    const cached = getLocalRoster();
    const rosterResult = cached ? { roster: cached } : await getRoster();
    const roster = rosterResult?.roster || cached;
    const allPlayers = roster?.players || [];
    currentRoster = allPlayers;
    tagsAssigned = getTagsAssigned();
    const isScratch = selectedLeague?.leagueType?.toLowerCase() === 'scratch';

    const suggestions = document.getElementById('league-checkin-suggestions');
    const completeBtn = document.getElementById('league-complete-checkin');
    const tabCheckin = document.getElementById('league-tab-checkin');
    const tabPayouts = document.getElementById('league-tab-payouts');
    const payoutCalc = document.getElementById('league-payout-calc');
    const playersInput = document.getElementById('league-payout-players');
    const roundCostInput = document.getElementById('league-round-cost');
    const clubFeesInput = document.getElementById('league-club-fees');
    const ctpInput = document.getElementById('league-ctp');
    const perPlayerInput = document.getElementById('league-payout-per-player');
    const dateInput = document.getElementById('league-round-date');
    const locationInput = document.getElementById('league-round-location');
    const layoutInput = document.getElementById('league-round-layout');
    const finalizeBtn = document.getElementById('league-finalize-round');
    const resetBtn = document.getElementById('league-reset-round');
    let selectingSuggestion = false;
    const locationSuggestions = document.getElementById('league-location-suggestions');
    const layoutSuggestions = document.getElementById('league-layout-suggestions');

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
            div.onclick = (e) => {
                e.preventDefault();
                locationInput.value = l;
                locationSuggestions.style.display = 'none';
                updateFinalizeButton();
                renderLayoutRecords();
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
                updateFinalizeButton();
                renderLayoutRecords();
            };
            div.onmouseenter = () => div.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))';
            div.onmouseleave = () => div.style.background = '';
            layoutSuggestions.appendChild(div);
        });
        layoutSuggestions.style.display = 'block';
    }

    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    if (dateInput && dateInput.value) {
        const [year, month] = dateInput.value.split('-');
        if (year && month) {
            getCachedDoc('event_bundles', `${year}-${month}`, EVENT_CACHE_TTL_MS).catch(() => {});
        }
    }

    function updateFinalizeButton() {
        if (!finalizeBtn) return;
        const valid = dateInput?.value && locationInput?.value?.trim() && layoutInput?.value?.trim();
        finalizeBtn.disabled = !valid;
        finalizeBtn.style.opacity = valid ? '1' : '0.5';
        finalizeBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
    }

    function updateSuggestions() {
        if (!suggestions) return;
        const checkins = getCheckins();
        const checkedSet = new Set(checkins.map(n => n.toLowerCase()));
        const term = input.value.trim().toLowerCase();
        const matches = allPlayers
            .filter(p => !checkedSet.has(p.name.toLowerCase()))
            .filter(p => p.name.toLowerCase().includes(term));

        suggestions.innerHTML = '';
        if (!term || matches.length === 0) {
            suggestions.style.display = 'none';
            return;
        }

        matches.forEach(p => {
            const div = document.createElement('div');
            div.textContent = p.name;
            div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--glass-border);';
            const selectSuggestion = (e) => {
                if (e && e.cancelable) e.preventDefault();
                selectingSuggestion = true;
                input.value = p.name;
                suggestions.style.display = 'none';
                setTimeout(() => { selectingSuggestion = false; }, 300);
            };
            div.onmousedown = (e) => { selectSuggestion(e); };
            div.ontouchstart = (e) => { e.preventDefault(); selectSuggestion(e); };
            div.onmouseenter = () => div.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))';
            div.onmouseleave = () => div.style.background = '';
            suggestions.appendChild(div);
        });
        suggestions.style.display = 'block';
    }

    const input = document.getElementById('league-checkin-input');
    const aceSelect = document.getElementById('league-checkin-ace');
    const tagInput = document.getElementById('league-checkin-tag');
    const status = document.getElementById('league-checkin-status');
    const checkinList = document.getElementById('league-checkin-list');
    if (!input || !checkinList) return;
    cardsVisible = false;

    function startEdit(i, name) {
        editingIndex = i;
        input.value = name;
        input.readOnly = true;
        const acePayers = getAcePayers();
        if (aceSelect) aceSelect.value = acePayers.some(n => n.toLowerCase() === name.toLowerCase()) ? 'yes' : 'no';
        const tags = getCheckinTags();
        if (tagInput) tagInput.value = tags[name] || '';
        if (showCheckedBtn) showCheckedBtn.textContent = 'Update';
        if (suggestions) suggestions.style.display = 'none';
        renderCheckins();
    }

    function cancelEdit() {
        editingIndex = null;
        input.readOnly = false;
        input.value = '';
        if (tagInput) tagInput.value = '';
        if (aceSelect) aceSelect.value = 'yes';
        if (showCheckedBtn) showCheckedBtn.textContent = cardsVisible ? 'Show Checked In' : 'Check In';
        if (status) status.textContent = '';
        renderCheckins();
    }

    function renderCheckins() {
        const checkins = getCheckins();
        const acePayers = getAcePayers();
        const tags = getCheckinTags();
        if (playersInput && !isScratch) playersInput.value = String(checkins.length);
        renderRoundSummary();
        checkinList.innerHTML = '';
        if (checkins.length === 0) {
            checkinList.innerHTML = '<p style="opacity:0.5; text-align:center;">No one checked in yet.</p>';
            updateSuggestions();
            return;
        }
        checkins.forEach((name, i) => {
            const item = document.createElement('div');
            item.className = 'admin-event-item';

            const player = allPlayers.find(p => p.name.toLowerCase() === name.toLowerCase());
            const current = player?.currentRating ?? '';
            const hdcp = typeof player?.hdcp === 'number' ? player.hdcp.toFixed(1) : (player?.hdcp ?? '');
            const isAce = acePayers.some(n => n.toLowerCase() === name.toLowerCase());
            const ace = isAce ? ' • Ace' : '';
            const tag = tags[name] ? ` • Tag: ${tags[name]}` : '';

            item.dataset.index = i;
            item.style.position = 'relative';
            item.style.overflow = 'hidden';
            item.style.padding = '0';
            item.style.transition = 'transform 0.2s, opacity 0.2s';
            const isEditing = editingIndex === i;
            item.innerHTML = `
                <div class="checkin-row-content" style="position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; padding: 1rem; transition: transform 0.2s; background: var(--bg-color); box-shadow: ${isEditing ? 'inset 0 0 0 3px #22c55e' : 'none'};">
                    <div class="admin-event-info">
                        <strong>${name}</strong>
                        <span style="display:block; font-size:0.75rem; opacity:0.6;">
                            Rating: ${current} • HDCP: ${hdcp}${ace}${tag}
                        </span>
                    </div>
                    <button type="button" class="btn-ace" data-index="${i}" style="padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid ${isAce ? '#22c55e' : 'var(--glass-border)'}; background: ${isAce ? '#22c55e' : 'var(--sidebar-bg)'}; color: ${isAce ? '#fff' : 'var(--text-color)'}; opacity: ${isAce ? '1' : '0.5'}; cursor: pointer; white-space: nowrap;">Ace</button>
                </div>
                <button type="button" class="btn-delete" data-index="${i}" style="position: absolute; z-index: 2; right: 0; top: 0; bottom: 0; width: 80px; display: flex; align-items: center; justify-content: center; background: #d32f2f; color: #fff; border: none; cursor: pointer; transform: translateX(100%); transition: transform 0.2s;"><i class="ph ph-minus-circle" style="font-size: 1.5rem;"></i></button>
            `;
            const deleteBtn = item.querySelector('.btn-delete');
            if (deleteBtn) {
                const doRemove = () => {
                    clearTimeout(swipeTimeout);
                    removeCheckinAtIndex(parseInt(deleteBtn.dataset.index, 10));
                };
                deleteBtn.onclick = (e) => { e.stopPropagation(); doRemove(); };
                deleteBtn.ontouchstart = (e) => { e.stopPropagation(); };
                deleteBtn.ontouchend = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    doRemove();
                };
            }
            const aceBtn = item.querySelector('.btn-ace');
            if (aceBtn) {
                aceBtn.onclick = (e) => {
                    e.stopPropagation();
                    const acePayers = getAcePayers();
                    const aceIdx = acePayers.findIndex(n => n.toLowerCase() === name.toLowerCase());
                    if (aceIdx !== -1) acePayers.splice(aceIdx, 1); else acePayers.push(name);
                    saveAcePayers(acePayers);
                    renderCheckins();
                    renderTags();
                };
            }
            item.onclick = (e) => {
                if (e.target.closest('.btn-ace, .btn-delete')) return;
                startEdit(i, name);
            };
            checkinList.appendChild(item);
        });
        updateSuggestions();
    }

    function checkIn() {
        const rawName = input.value.trim();
        if (!rawName) return;
        const isDoubles = selectedLeague?.leagueType?.toLowerCase() === 'doubles';

        if (editingIndex !== null) {
            const checkins = getCheckins();
            const targetName = checkins[editingIndex];
            if (!targetName) { cancelEdit(); return; }

            const payAce = aceSelect?.value !== 'no';
            const acePayers = getAcePayers();
            const aceIdx = acePayers.findIndex(n => n.toLowerCase() === targetName.toLowerCase());
            if (payAce && aceIdx === -1) acePayers.push(targetName);
            if (!payAce && aceIdx !== -1) acePayers.splice(aceIdx, 1);
            saveAcePayers(acePayers);

            if (!isDoubles) {
                const tag = tagInput?.value?.trim() || '';
                const tags = getCheckinTags();
                tags[targetName] = tag;
                saveCheckinTags(tags);
                const originalTags = getCheckinTagsOriginal();
                originalTags[targetName] = tag;
                saveCheckinTagsOriginal(originalTags);
            }

            editingIndex = null;
            input.readOnly = false;
            input.value = '';
            if (tagInput) tagInput.value = '';
            if (aceSelect) aceSelect.value = 'yes';
            if (showCheckedBtn) showCheckedBtn.textContent = cardsVisible ? 'Show Checked In' : 'Check In';
            if (status) status.textContent = '';
            renderCheckins();
            renderTags();
            return;
        }

        const playerExists = allPlayers.some(p => p.name.toLowerCase() === rawName.toLowerCase());

        if (!playerExists) {
            const rating = prompt(`${rawName} is not on the roster. Enter their rating to continue:`);
            if (rating === null || rating.trim() === '' || isNaN(Number(rating))) {
                if (status) status.textContent = 'A valid rating is required to check in.';
                return;
            }
            const numericRating = Number(rating);
            const rawHdcp = (1005 - numericRating) / 12;
            const hdcpValue = Math.ceil(rawHdcp * 2) / 2;
            allPlayers.push({
                name: rawName,
                currentRating: numericRating,
                hdcp: hdcpValue
            });
        }

        const checkins = getCheckins();
        if (checkins.some(n => n.toLowerCase() === rawName.toLowerCase())) {
            if (status) status.textContent = `${rawName} is already checked in.`;
            return;
        }

        checkins.push(rawName);
        saveCheckins(checkins);

        const payAce = aceSelect?.value !== 'no';
        if (payAce) {
            const acePayers = getAcePayers();
            if (!acePayers.some(n => n.toLowerCase() === rawName.toLowerCase())) {
                acePayers.push(rawName);
            }
            saveAcePayers(acePayers);
        }

        if (!isDoubles && tagInput?.value?.trim()) {
            const tags = getCheckinTags();
            tags[rawName] = tagInput.value.trim();
            saveCheckinTags(tags);
            const originalTags = getCheckinTagsOriginal();
            originalTags[rawName] = tagInput.value.trim();
            saveCheckinTagsOriginal(originalTags);
        }

        if (status) status.textContent = '';
        input.value = '';
        if (tagInput) tagInput.value = '';
        if (aceSelect) aceSelect.value = 'yes';
        renderCheckins();
        renderTags();
    }

    input.addEventListener('input', updateSuggestions);
    input.addEventListener('focus', updateSuggestions);
    input.addEventListener('blur', () => {
        setTimeout(() => { if (suggestions) suggestions.style.display = 'none'; }, 150);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !selectingSuggestion) checkIn();
        if (e.key === 'Escape') cancelEdit();
    });
    if (tagInput) tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') checkIn();
        if (e.key === 'Escape') cancelEdit();
    });
    if (aceSelect) aceSelect.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') checkIn();
        if (e.key === 'Escape') cancelEdit();
    });

    const showCheckedBtn = document.getElementById('league-show-checked');
    const tabTags = document.getElementById('league-tab-tags');
    const tabRoundInfo = document.getElementById('league-tab-round-info');
    const assignTagsBtn = document.getElementById('league-assign-tags');
    const wizardYesBtn = document.getElementById('league-tag-wizard-yes');
    const wizardSkipBtn = document.getElementById('league-tag-wizard-skip');
    const wizardStopBtn = document.getElementById('league-tag-wizard-stop');
    if (tabRoundInfo) tabRoundInfo.onclick = () => switchLeagueTab('round-info');
    if (tabCheckin) tabCheckin.onclick = () => switchLeagueTab('checkin');
    if (tabTags) tabTags.onclick = () => switchLeagueTab('tags');
    if (tabPayouts) tabPayouts.onclick = () => switchLeagueTab('payouts');
    if (assignTagsBtn) assignTagsBtn.onclick = startTagWizard;
    if (wizardYesBtn) wizardYesBtn.onclick = tagWizardYes;
    if (wizardSkipBtn) wizardSkipBtn.onclick = tagWizardSkip;
    if (wizardStopBtn) wizardStopBtn.onclick = tagWizardStop;
    if (completeBtn) completeBtn.onclick = completeCheckIn;
    if (payoutCalc) payoutCalc.onclick = calculatePayouts;
    if (finalizeBtn) finalizeBtn.onclick = async () => {
        if (isFinalizing) return;
        isFinalizing = true;
        finalizeBtn.disabled = true;
        try {
            await finalizeRound();
        } finally {
            isFinalizing = false;
            finalizeBtn.disabled = false;
        }
    };
    if (resetBtn) resetBtn.onclick = () => {
        if (confirm('This will remove all checked in players and reset finances. Continue?')) {
            resetRound();
        }
    };
    if (showCheckedBtn) {
        showCheckedBtn.textContent = cardsVisible ? 'Show Checked In' : 'Check In';
        showCheckedBtn.onclick = () => {
            if (cardsVisible) {
                showCheckedIn();
            } else {
                checkIn();
            }
        };
    }
    if (roundCostInput) roundCostInput.addEventListener('input', updatePayoutPerPlayer);
    if (clubFeesInput) clubFeesInput.addEventListener('input', updatePayoutPerPlayer);
    if (ctpInput) ctpInput.addEventListener('input', updatePayoutPerPlayer);
    if (dateInput) {
        dateInput.addEventListener('input', updateFinalizeButton);
        dateInput.addEventListener('change', async () => {
            if (!locationInput || !layoutInput) return;
            const date = dateInput.value;
            if (!date) return;
            const [year, month, day] = date.split('-');
            const monthId = `${year}-${month}`;
            try {
                const { data, source } = await getCachedDoc('event_bundles', monthId, EVENT_CACHE_TTL_MS);
                let match = null;
                if (data) {
                    const events = data.events || [];
                    match = events.find(e => String(e.day) === String(Number(day)));
                }
                if (match) {
                    const oldLocation = match.location || '';
                    const oldLayout = match.layout || '';
                    locationInput.value = oldLocation;
                    layoutInput.value = oldLayout;
                    updateFinalizeButton();
                    await renderLayoutRecords();

                    if (source === 'cache') {
                        refreshCachedDoc('event_bundles', monthId, EVENT_CACHE_TTL_MS).then(updated => {
                            if (!updated) return;
                            const newMatch = (updated.events || []).find(e => String(e.day) === String(Number(day)));
                            if (!newMatch) return;
                            const currentLocation = (locationInput.value || '').trim();
                            const currentLayout = (layoutInput.value || '').trim();
                            if ((currentLocation === oldLocation.trim() || currentLocation === '') &&
                                (currentLayout === oldLayout.trim() || currentLayout === '')) {
                                locationInput.value = newMatch.location || '';
                                layoutInput.value = newMatch.layout || '';
                                updateFinalizeButton();
                                renderLayoutRecords();
                            }
                        }).catch(err => console.warn('Background event refresh failed:', err));
                    }
                }
            } catch (error) {
                console.warn('Could not load calendar event for date:', error);
            }
        });
    }
    if (locationInput) {
        locationInput.addEventListener('input', () => { updateFinalizeButton(); updateLocationSuggestions(); });
        locationInput.addEventListener('change', renderLayoutRecords);
        locationInput.addEventListener('focus', updateLocationSuggestions);
        locationInput.addEventListener('blur', () => {
            setTimeout(() => { if (locationSuggestions) locationSuggestions.style.display = 'none'; }, 150);
        });
    }
    if (layoutInput) {
        layoutInput.addEventListener('input', () => { updateFinalizeButton(); updateLayoutSuggestions(); });
        layoutInput.addEventListener('change', renderLayoutRecords);
        layoutInput.addEventListener('focus', updateLayoutSuggestions);
        layoutInput.addEventListener('blur', () => {
            setTimeout(() => { if (layoutSuggestions) layoutSuggestions.style.display = 'none'; }, 150);
        });
    }
    updatePayoutPerPlayer();
    updateFinalizeButton();

    function removeCheckinAtIndex(idx) {
        try {
            const checkins = getCheckins();
            if (idx < 0 || idx >= checkins.length) return;
            const removedName = checkins[idx];
            checkins.splice(idx, 1);
            saveCheckins(checkins);

            if (removedName) {
                const acePayers = getAcePayers();
                const aceIdx = acePayers.findIndex(n => n.toLowerCase() === removedName.toLowerCase());
                if (aceIdx !== -1) {
                    acePayers.splice(aceIdx, 1);
                    saveAcePayers(acePayers);
                }

                const tags = getCheckinTags();
                delete tags[removedName];
                saveCheckinTags(tags);

                const originalTags = getCheckinTagsOriginal();
                delete originalTags[removedName];
                saveCheckinTagsOriginal(originalTags);

                const scores = getRoundScores();
                delete scores[removedName];
                saveRoundScores(scores);
            }
        } catch (e) {
            if (status) status.textContent = 'Error removing player: ' + e.message;
        } finally {
            renderCheckins();
            renderTags();
        }
    }

    let swipeContent = null;
    let swipeDelete = null;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTimeout = null;

    function closeSwipedRow() {
        if (!swipeContent) return;
        swipeContent.style.transform = 'translateX(0)';
        if (swipeDelete) swipeDelete.style.transform = 'translateX(100%)';
        swipeContent = null;
        swipeDelete = null;
    }

    if (checkinList) {
        checkinList.addEventListener('touchstart', (e) => {
            let item = e.target.closest('.admin-event-item');
            if (!item) return;
            clearTimeout(swipeTimeout);
            if (swipeContent) closeSwipedRow();
            if (editingIndex !== null) {
                const idx = item.dataset.index;
                cancelEdit();
                item = checkinList.querySelector(`.admin-event-item[data-index="${idx}"]`);
                if (!item) return;
            }
            swipeContent = item.querySelector('.checkin-row-content');
            swipeDelete = item.querySelector('.btn-delete');
            swipeStartX = e.touches[0].clientX;
            swipeStartY = e.touches[0].clientY;
        }, { passive: true });

        checkinList.addEventListener('touchmove', (e) => {
            if (!swipeContent) return;
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;
            const deltaX = x - swipeStartX;
            const deltaY = y - swipeStartY;

            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                e.preventDefault();
                const tx = Math.max(-80, Math.min(0, deltaX));
                swipeContent.style.transform = `translateX(${tx}px)`;
                if (swipeDelete) swipeDelete.style.transform = `translateX(${tx <= -80 ? 0 : 100}%)`;
            }
        }, { passive: false });

        checkinList.addEventListener('touchend', (e) => {
            if (swipeDelete && e.target && (swipeDelete === e.target || swipeDelete.contains(e.target))) {
                return;
            }
            if (!swipeContent) return;
            clearTimeout(swipeTimeout);
            const current = swipeContent.style.transform;
            const tx = current ? parseFloat(current.replace('translateX(', '').replace('px)', '')) || 0 : 0;
            if (tx <= -80) {
                swipeContent.style.transform = 'translateX(-80px)';
                if (swipeDelete) swipeDelete.style.transform = 'translateX(0)';
                swipeTimeout = setTimeout(closeSwipedRow, 3000);
            } else {
                closeSwipedRow();
            }
        });
    }

    renderCheckins();
    renderTags();
    updateTagControls();

    if (isScratch) {
        if (ctpInput) ctpInput.value = '0.50';
        if (playersInput) {
            playersInput.value = '4';
            playersInput.readOnly = false;
            playersInput.style.opacity = '1';
            playersInput.style.cursor = 'text';
        }
        updatePayoutPerPlayer();
    } else if (playersInput) {
        playersInput.readOnly = true;
        playersInput.style.opacity = '0.7';
        playersInput.style.cursor = 'not-allowed';
    }

    const payoutForm = document.getElementById('league-payout-form');
    const payoutSubtitle = document.getElementById('league-payout-subtitle');
    const payoutResults = document.getElementById('league-payout-results');
    if (isScratch) {
        if (payoutForm) payoutForm.style.display = 'none';
        if (payoutSubtitle) payoutSubtitle.style.display = 'none';
        if (payoutResults) payoutResults.innerHTML = getScratchPayoutTable();
    } else {
        if (payoutForm) payoutForm.style.display = 'block';
        if (payoutSubtitle) payoutSubtitle.style.display = 'block';
        if (payoutResults) payoutResults.innerHTML = '';
    }
    updateScratchFinancesVisibility();
    switchLeagueTab('round-info');
}

function groupIntoCards(n) {
    if (n < 3) return [];
    if (n === 3) return [3];
    if (n === 4) return [4];
    if (n === 5) return [5];

    const groups = [];
    const fours = Math.floor(n / 4);
    const remainder = n % 4;

    if (remainder === 0) {
        for (let i = 0; i < fours; i++) groups.push(4);
    } else if (remainder === 1) {
        // e.g., 9, 13, 17: use (fours - 1) 4s and a 5
        for (let i = 0; i < fours - 1; i++) groups.push(4);
        groups.push(5);
    } else if (remainder === 2) {
        // e.g., 6, 10, 14: use (fours - 1) 4s and two 3s
        for (let i = 0; i < fours - 1; i++) groups.push(4);
        groups.push(3);
        groups.push(3);
    } else {
        // remainder === 3: e.g., 7, 11, 15: use fours 4s and a 3
        for (let i = 0; i < fours; i++) groups.push(4);
        groups.push(3);
    }

    return groups;
}

function completeCheckIn() {
    const status = document.getElementById('league-checkin-status');
    const cardsContainer = document.getElementById('league-cards-container');

    const leagueType = selectedLeague?.leagueType?.toLowerCase();
    if (!leagueType || (leagueType !== 'handicap' && leagueType !== 'scratch' && leagueType !== 'doubles')) {
        if (status) status.textContent = 'Create Cards is only for Handicap, Scratch, or Doubles leagues.';
        return;
    }

    const checkins = [...getCheckins()];
    if (leagueType === 'scratch') {
        checkins.sort((a, b) => {
            const pa = currentRoster.find(p => p.name.toLowerCase() === a.toLowerCase());
            const pb = currentRoster.find(p => p.name.toLowerCase() === b.toLowerCase());
            return (pb?.currentRating ?? 0) - (pa?.currentRating ?? 0);
        });
    } else {
        for (let i = checkins.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [checkins[i], checkins[j]] = [checkins[j], checkins[i]];
        }
    }

    if (checkins.length < 3) {
        if (status) status.textContent = 'Need at least 3 players to form a card.';
        return;
    }

    const checkinList = document.getElementById('league-checkin-list');
    if (checkinList) checkinList.style.display = 'none';
    cardsContainer.style.display = 'block';
    cardsContainer.style.marginTop = '0.5rem';
    cardsContainer.innerHTML = '<div id="league-cards-grid" style="display: flex; flex-wrap: wrap; gap: 1rem;"></div>';
    const grid = document.getElementById('league-cards-grid');

    if (leagueType === 'doubles') {
        const teams = [];
        for (let i = 0; i < checkins.length; i += 2) {
            if (i + 1 < checkins.length) teams.push([checkins[i], checkins[i + 1]]);
            else teams.push([checkins[i]]);
        }
        const cards = [];
        for (let i = 0; i < teams.length; i += 2) {
            const card = [teams[i]];
            if (i + 1 < teams.length) card.push(teams[i + 1]);
            cards.push(card);
        }
        if (cards.length > 1 && cards[cards.length - 1].length === 1) {
            const orphan = cards.pop()[0];
            cards[cards.length - 1].push(orphan);
        }

        cards.forEach((card, cardNo) => {
            const cardDiv = document.createElement('div');
            cardDiv.style.cssText = 'background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 12px; padding: 1rem; flex: 1; min-width: 220px; max-width: 320px;';
            cardDiv.innerHTML = `<h5 style="margin: 0 0 0.75rem 0; color: var(--accent-color);">Card ${cardNo + 1}</h5>`;
            const list = document.createElement('ul');
            list.style.cssText = 'margin: 0; padding-left: 1.2rem;';
            card.forEach((team) => {
                const li = document.createElement('li');
                li.style.cssText = 'margin-bottom: 0.4rem;';
                li.textContent = team.length === 1 ? `${team[0]} (Solo)` : team.join(' & ');
                list.appendChild(li);
            });
            cardDiv.appendChild(list);
            grid.appendChild(cardDiv);
        });
    } else {
        const groups = groupIntoCards(checkins.length);

        let index = 0;
        groups.forEach((size, cardNo) => {
            const card = document.createElement('div');
            card.style.cssText = 'background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 12px; padding: 1rem; flex: 1; min-width: 220px; max-width: 320px;';
            card.innerHTML = `<h5 style="margin: 0 0 0.75rem 0; color: var(--accent-color);">Card ${cardNo + 1}</h5>`;
            const list = document.createElement('ul');
            list.style.cssText = 'margin: 0; padding-left: 1.2rem;';

            for (let i = 0; i < size && index < checkins.length; i++, index++) {
                const name = checkins[index];
                const li = document.createElement('li');
                li.style.cssText = 'margin-bottom: 0.4rem;';
                const player = currentRoster.find(p => p.name.toLowerCase() === name.toLowerCase());
                const rating = player?.currentRating ?? '';
                li.textContent = leagueType === 'scratch' ? `${name} (${rating})` : name;
                list.appendChild(li);
            }

            card.appendChild(list);
            grid.appendChild(card);
        });
    }

    cardsVisible = true;
    const showCheckedBtn = document.getElementById('league-show-checked');
    if (showCheckedBtn) {
        showCheckedBtn.style.display = 'inline-block';
        showCheckedBtn.textContent = 'Show Checked In';
    }
}

function showCheckedIn() {
    const checkinList = document.getElementById('league-checkin-list');
    const cardsContainer = document.getElementById('league-cards-container');
    const showCheckedBtn = document.getElementById('league-show-checked');
    if (checkinList) checkinList.style.display = 'block';
    if (cardsContainer) cardsContainer.style.display = 'none';
    if (showCheckedBtn) {
        showCheckedBtn.style.display = 'inline-block';
        showCheckedBtn.textContent = 'Check In';
    }
    cardsVisible = false;
}

function renderTags() {
    const list = document.getElementById('league-tags-list');
    if (!list) return;
    const checkins = getCheckins();
    const tags = getCheckinTags();
    const originalTags = getCheckinTagsOriginal();
    const scores = getRoundScores();
    const taggedPlayers = checkins.filter(name => originalTags[name]);
    list.innerHTML = '';
    if (taggedPlayers.length === 0) {
        list.innerHTML = '<p style="opacity:0.5; text-align:center;">No one with a tag yet.</p>';
        return;
    }
    taggedPlayers.forEach(name => {
        const item = document.createElement('div');
        item.className = 'admin-event-item';
        item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem;';
        const encodedName = name.replace(/"/g, '&quot;');
        item.innerHTML = `
            <div class="admin-event-info">
                <strong style="font-size: 0.9rem;">${name}</strong>
                <span style="display:block; font-size:0.7rem; opacity:0.6;">Tag in: ${originalTags[name] || '—'} • Tag out: ${tags[name] || '—'}</span>
            </div>
            <input type="number" id="score-${encodedName}" class="league-score-input" data-name="${encodedName}" value="${scores[name] ?? ''}" min="0" step="1" placeholder="Score" style="width: 100px !important; max-width: 100px !important; padding: 0.2rem 0.25rem; border-radius: 4px; border: 1px solid var(--glass-border); background: var(--sidebar-bg); color: var(--text-color); text-align: center; display: inline-block;">
        `;
        const scoreInput = item.querySelector('.league-score-input');
        if (scoreInput) {
            scoreInput.oninput = () => {
                const val = scoreInput.value.trim();
                const updated = getRoundScores();
                if (val === '') {
                    delete updated[name];
                } else {
                    updated[name] = val;
                }
                saveRoundScores(updated);
            };
        }
        list.appendChild(item);
    });
}

let tagWizardState = null;

function renderTagStep() {
    const wizard = document.getElementById('league-tag-wizard');
    const question = document.getElementById('league-tag-wizard-question');
    if (!wizard || !question || !tagWizardState) return;

    const { sortedTags, playerQueue, currentTagIndex, newTags } = tagWizardState;
    if (currentTagIndex >= sortedTags.length || playerQueue.length === 0) {
        wizard.style.display = 'none';
        tagWizardState = null;
        tagsAssigned = true;
        saveTagsAssigned(true);
        saveCheckinTags(newTags);
        renderTags();
        return;
    }

    const tagNum = sortedTags[currentTagIndex];
    const player = playerQueue[0];
    question.textContent = `Assign tag ${tagNum} to ${player}?`;
    wizard.style.display = 'block';
}

function startTagWizard() {
    const checkins = getCheckins();
    const tags = getCheckinTags();
    const originalTags = getCheckinTagsOriginal();
    const scores = getRoundScores();
    const taggedPlayers = checkins.filter(name => originalTags[name]);
    if (taggedPlayers.length === 0) {
        tagsAssigned = true;
        saveTagsAssigned(true);
        return;
    }
    tagsAssigned = false;
    saveTagsAssigned(false);

    const entries = taggedPlayers.map(name => ({ name, score: Number(scores[name]) }));
    const valid = entries.filter(e => !isNaN(e.score) && scores[e.name] !== undefined);
    const invalid = entries.filter(e => !valid.includes(e));
    valid.sort((a, b) => {
        const scoreDiff = a.score - b.score;
        if (scoreDiff !== 0) return scoreDiff;
        const tagA = Number(originalTags[a.name]) || Infinity;
        const tagB = Number(originalTags[b.name]) || Infinity;
        return tagA - tagB;
    });
    const sortedNames = valid.map(e => e.name).concat(invalid.map(e => e.name));

    const tagValues = Object.values(originalTags).filter(Boolean);
    const numericTags = tagValues.map(t => Number(t)).filter(n => !isNaN(n));
    const stringTags = tagValues.filter(t => isNaN(Number(t)));
    numericTags.sort((a, b) => a - b);
    stringTags.sort();
    const sortedTags = numericTags.map(String).concat(stringTags);

    tagWizardState = {
        sortedTags,
        playerQueue: [...sortedNames],
        currentTagIndex: 0,
        newTags: {}
    };
    renderTagStep();
}

function tagWizardYes() {
    if (!tagWizardState) return;
    const { sortedTags, playerQueue, currentTagIndex, newTags } = tagWizardState;
    if (currentTagIndex >= sortedTags.length || playerQueue.length === 0) return;
    const player = playerQueue.shift();
    newTags[player] = String(sortedTags[currentTagIndex]);
    tagWizardState.currentTagIndex++;
    tagWizardState.playerQueue = playerQueue;
    saveCheckinTags(newTags);
    renderTags();
    renderTagStep();
}

function tagWizardSkip() {
    if (!tagWizardState) return;
    tagWizardState.playerQueue.shift();
    renderTagStep();
}

function tagWizardStop() {
    tagWizardState = null;
    tagsAssigned = false;
    saveTagsAssigned(false);
    const wizard = document.getElementById('league-tag-wizard');
    if (wizard) wizard.style.display = 'none';
    renderTags();
}

async function renderLayoutRecords() {
    const container = document.getElementById('league-layout-records');
    if (!container) return;
    const locationInput = document.getElementById('league-round-location');
    const layoutInput = document.getElementById('league-round-layout');
    const location = (locationInput?.value || '').trim();
    const layout = (layoutInput?.value || '').trim();

    if (!location || !layout) {
        container.innerHTML = '<p class="subtitle" style="opacity: 0.6;">Select a location and layout to see records.</p>';
        return;
    }

    const storageName = getCourseStorageName(location);
    const displayName = getCourseDisplayName(storageName);

    try {
        const { data } = await getCachedDoc('course_records', storageName, COURSE_RECORD_CACHE_TTL_MS);
        if (!data) {
            container.innerHTML = `<p class="subtitle" style="opacity: 0.6;">No records found for ${displayName}.</p>`;
            return;
        }

        const layouts = data.layouts || {};
        const layoutKey = Object.keys(layouts).find(k => k.toLowerCase().trim() === layout.toLowerCase());
        if (!layoutKey) {
            container.innerHTML = `<p class="subtitle" style="opacity: 0.6;">No records found for the ${layout} layout.</p>`;
            return;
        }

        const layoutData = layouts[layoutKey];
        const par = layoutData.par || null;

        const makeList = (scores) => {
            if (!scores || scores.length === 0) {
                return '<p class="subtitle" style="opacity: 0.6;">No records yet.</p>';
            }
            const sorted = [...scores].sort((a, b) => a.score - b.score || new Date(a.date) - new Date(b.date));
            const top3 = sorted.slice(0, 3);
            return `<ol style="margin: 0; padding-left: 1.2rem;">${top3.map((rec) => {
                const toPar = par !== null ? rec.score - par : null;
                const toParText = toPar !== null ? ` (${toPar > 0 ? '+' : ''}${toPar === 0 ? 'E' : toPar})` : '';
                const date = rec.date ? new Date(rec.date).toLocaleDateString() : '';
                return `<li style="margin-bottom: 0.35rem;">${rec.player} — <strong>${rec.score}</strong>${toParText}${date ? ` <span style="opacity: 0.6; font-size: 0.8rem;">${date}</span>` : ''}</li>`;
            }).join('')}</ol>`;
        };

        const mixedScores = layoutData.scoresM || [];
        const womenScores = layoutData.scoresW || [];

        container.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div style="background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: 8px; padding: 1rem;">
                    <h5 style="margin: 0 0 0.5rem 0;">Mixed</h5>
                    ${makeList(mixedScores)}
                </div>
                <div style="background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: 8px; padding: 1rem;">
                    <h5 style="margin: 0 0 0.5rem 0;">Women's</h5>
                    ${makeList(womenScores)}
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading layout records:', error);
        container.innerHTML = '<p class="subtitle" style="opacity: 0.6;">Error loading records.</p>';
    }
}

function switchLeagueTab(tab) {
    if (tab === 'tags' && selectedLeague?.leagueType?.toLowerCase() === 'doubles') return;
    const roundInfoPanel = document.getElementById('league-round-info-panel');
    const checkinPanel = document.getElementById('league-checkin-panel');
    const tagsPanel = document.getElementById('league-tags-panel');
    const payoutsPanel = document.getElementById('league-payouts-panel');
    const tabRoundInfo = document.getElementById('league-tab-round-info');
    const tabCheckin = document.getElementById('league-tab-checkin');
    const tabTags = document.getElementById('league-tab-tags');
    const tabPayouts = document.getElementById('league-tab-payouts');
    const playersInput = document.getElementById('league-payout-players');

    const setActive = (active) => {
        [tabRoundInfo, tabCheckin, tabTags, tabPayouts].forEach(t => {
            if (t) t.classList.remove('active');
        });
        if (active) active.classList.add('active');
    };

    if (tab === 'round-info') {
        if (roundInfoPanel) roundInfoPanel.style.display = 'block';
        if (checkinPanel) checkinPanel.style.display = 'none';
        if (tagsPanel) tagsPanel.style.display = 'none';
        if (payoutsPanel) payoutsPanel.style.display = 'none';
        setActive(tabRoundInfo);
        renderLayoutRecords();
    } else if (tab === 'checkin') {
        if (roundInfoPanel) roundInfoPanel.style.display = 'none';
        if (checkinPanel) checkinPanel.style.display = 'block';
        if (tagsPanel) tagsPanel.style.display = 'none';
        if (payoutsPanel) payoutsPanel.style.display = 'none';
        setActive(tabCheckin);
    } else if (tab === 'tags') {
        if (roundInfoPanel) roundInfoPanel.style.display = 'none';
        if (checkinPanel) checkinPanel.style.display = 'none';
        if (tagsPanel) tagsPanel.style.display = 'block';
        if (payoutsPanel) payoutsPanel.style.display = 'none';
        setActive(tabTags);
        renderTags();
    } else if (tab === 'payouts') {
        if (roundInfoPanel) roundInfoPanel.style.display = 'none';
        if (checkinPanel) checkinPanel.style.display = 'none';
        if (tagsPanel) tagsPanel.style.display = 'none';
        if (payoutsPanel) payoutsPanel.style.display = 'block';
        setActive(tabPayouts);
        if (playersInput) playersInput.value = String(getCheckins().length);
        renderRoundSummary();
    }
}

let currentPayoutAmounts = [];
let currentPayoutTotal = 0;
let currentPayoutNumPaid = 0;
let currentPayoutPills = [];
let currentPayoutOriginal = [];
let currentTieMap = {};

function ordinal(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
    const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
    return n + suffix;
}

function renderRoundSummary() {
    const summary = document.getElementById('league-payout-summary');
    const playersInput = document.getElementById('league-payout-players');
    const roundCostInput = document.getElementById('league-round-cost');
    const clubFeesInput = document.getElementById('league-club-fees');
    const aceCostInput = document.getElementById('league-ace-cost');
    const perPlayerInput = document.getElementById('league-payout-per-player');
    if (!summary) return;

    const numPlayers = Number(playersInput?.value) || 0;
    const roundCost = Number(roundCostInput?.value) || 0;
    const clubFees = Number(clubFeesInput?.value) || 0;
    const aceCost = Number(aceCostInput?.value) || 0;
    const perPlayer = Number(perPlayerInput?.value) || 0;
    const acePayers = getAcePayers().length;

    const totalCollected = numPlayers * roundCost;
    const totalPaidOut = numPlayers * perPlayer;
    const totalAcePot = acePayers * aceCost;
    const totalClubFees = numPlayers * clubFees;

    summary.innerHTML = `
        <h5 style="margin: 1rem 0 0.5rem 0;">Round Summary</h5>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="display: flex; justify-content: space-between; padding: 0.75rem; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 8px;">
                <span>Total $ Collected</span>
                <span>$${totalCollected.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.75rem; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 8px;">
                <span>Total $ Paid Out</span>
                <span>$${totalPaidOut.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.75rem; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 8px;">
                <span>Total Ace Pot Collected</span>
                <span>$${totalAcePot.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.75rem; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 8px;">
                <span>Total Club Fees</span>
                <span>$${totalClubFees.toFixed(2)}</span>
            </div>
        </div>
    `;
}

function updatePayoutPerPlayer() {
    const roundCostInput = document.getElementById('league-round-cost');
    const clubFeesInput = document.getElementById('league-club-fees');
    const ctpInput = document.getElementById('league-ctp');
    const perPlayerInput = document.getElementById('league-payout-per-player');
    if (!roundCostInput || !clubFeesInput || !ctpInput || !perPlayerInput) return;
    const roundCost = Number(roundCostInput.value) || 0;
    const clubFees = Number(clubFeesInput.value) || 0;
    const ctp = Number(ctpInput.value) || 0;
    const perPlayer = Math.max(0, roundCost - clubFees - ctp);
    perPlayerInput.value = perPlayer.toFixed(2);

    const staticPerPlayer = document.getElementById('league-static-per-player');
    const staticClubFees = document.getElementById('league-static-club-fees');
    if (staticPerPlayer) staticPerPlayer.textContent = `$${perPlayer.toFixed(2)}`;
    if (staticClubFees) staticClubFees.textContent = `$${clubFees.toFixed(2)}`;

    renderRoundSummary();
}

function updateScratchFinancesVisibility() {
    const isScratch = selectedLeague?.leagueType?.toLowerCase() === 'scratch';
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const form = document.getElementById('league-round-finances-form');
    const staticTable = document.getElementById('league-round-finances-static');
    if (!form || !staticTable) return;
    if (isScratch && isMobile) {
        form.style.display = 'none';
        staticTable.style.display = 'block';
    } else {
        form.style.display = '';
        staticTable.style.display = 'none';
    }
}

const staticCtpSelect = document.getElementById('league-static-ctp');
if (staticCtpSelect) {
    staticCtpSelect.addEventListener('change', () => {
        const clubFeesInput = document.getElementById('league-club-fees');
        const ctpInput = document.getElementById('league-ctp');
        const yes = staticCtpSelect.value === 'yes';
        if (clubFeesInput) clubFeesInput.value = yes ? '0.50' : '1.00';
        if (ctpInput) ctpInput.value = yes ? '0.50' : '0.00';
        updatePayoutPerPlayer();
    });
}

window.addEventListener('resize', updateScratchFinancesVisibility);

function calculatePayouts() {
    const playersInput = document.getElementById('league-payout-players');
    const perPlayerInput = document.getElementById('league-payout-per-player');
    const pctInput = document.getElementById('league-payout-pct');
    const results = document.getElementById('league-payout-results');

    const numPlayers = Number(playersInput.value);
    const perPlayer = Number(perPlayerInput.value);
    const pct = Number(pctInput.value);

    if (!numPlayers || numPlayers < 1 || isNaN(perPlayer) || isNaN(pct)) {
        if (results) results.innerHTML = '<p class="loading-text">Enter valid payout details.</p>';
        return;
    }

    if (selectedLeague?.leagueType?.toLowerCase() === 'scratch') {
        const scratch = SCRATCH_PAYOUTS[numPlayers];
        if (!scratch) {
            if (results) results.innerHTML = '<p class="loading-text">Scratch payouts support only 3, 4, or 5 players per card.</p>';
            return;
        }
        currentPayoutAmounts = scratch.slice();
        currentPayoutOriginal = scratch.slice();
        currentPayoutTotal = scratch[0] + scratch[1];
        currentPayoutNumPaid = 2;
        currentPayoutPills = [];
        currentTieMap = {};
        renderPayoutList();
        return;
    }

    const totalPayout = numPlayers * perPlayer;
    const numPaid = Math.max(1, Math.min(25, Math.round(numPlayers * pct / 100)));
    const row = PAYOUT_TABLE[numPaid - 1] || [];

    const baseAmounts = [];
    let sum = 0;
    for (let i = 0; i < numPaid; i++) {
        const pctValue = row[i] || 0;
        const amount = Math.floor(pctValue / 100 * totalPayout);
        baseAmounts.push(amount);
        sum += amount;
    }
    const remainder = totalPayout - sum;
    baseAmounts[0] += remainder;

    currentPayoutAmounts = baseAmounts;
    currentPayoutOriginal = baseAmounts.slice();
    currentPayoutTotal = totalPayout;
    currentPayoutNumPaid = numPaid;
    currentPayoutPills = [];
    currentTieMap = {};
    renderPayoutList();
}

function renderPayoutList() {
    const results = document.getElementById('league-payout-results');
    if (!results) return;

    let html = `
        <p><strong>Total Payout:</strong> $${currentPayoutTotal.toFixed(2)}</p>
        <p><strong>Number of Players Paid:</strong> ${currentPayoutNumPaid}</p>
        <p style="font-size: 0.8rem; opacity: 0.7; margin-top: 0.25rem;">Click a position to enter ties and split the combined payout.</p>
        <div id="league-payout-list" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
    `;

    let i = 0;
    while (i < currentPayoutNumPaid) {
        let j = i + 1;
        while (j < currentPayoutNumPaid && currentPayoutAmounts[j] === currentPayoutAmounts[i]) {
            j++;
        }
        const isTie = j - i > 1;
        const hasPills = currentPayoutPills.some(p => p.index === i);
        for (let k = i; k < j; k++) {
            const label = (isTie || hasPills) ? `Tie ${ordinal(i + 1)}` : ordinal(k + 1);
            html += `
                <div class="league-payout-row" data-index="${k}" style="display: flex; justify-content: space-between; padding: 0.75rem; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">
                    <span style="font-weight: 700; color: var(--accent-color);">${label}</span>
                    <span>$${currentPayoutAmounts[k].toFixed(2)}</span>
                </div>
            `;
        }
        i = j;
    }

    currentPayoutPills.forEach(pill => {
        html += `
            <div class="league-payout-row" data-index="${pill.index}" style="display: flex; justify-content: space-between; padding: 0.75rem; background: var(--sidebar-bg); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">
                <span style="font-weight: 700; color: var(--accent-color);">Tie ${ordinal(pill.index + 1)}</span>
                <span>$${pill.amount.toFixed(2)}</span>
            </div>
        `;
    });

    html += `</div>`;
    results.innerHTML = html;

    results.querySelectorAll('.league-payout-row').forEach(row => {
        row.onclick = () => handlePayoutTie(parseInt(row.dataset.index, 10));
    });

    renderRoundSummary();
}

function getTieStart(index) {
    if (currentTieMap[index]) return index;
    for (const start of Object.keys(currentTieMap).map(Number)) {
        if (index >= start && index < currentTieMap[start].endIndex) return start;
    }
    return -1;
}

function handlePayoutTie(index) {
    const tieStart = getTieStart(index);
    if (tieStart !== -1) {
        const tie = currentTieMap[tieStart];
        for (let i = tieStart; i < tie.endIndex; i++) {
            currentPayoutAmounts[i] = currentPayoutOriginal[i];
        }
        currentPayoutPills = currentPayoutPills.filter(p => p.index !== tieStart);
        delete currentTieMap[tieStart];
        renderPayoutList();
        return;
    }

    const tiesInput = prompt(`How many players are tied for ${ordinal(index + 1)} place?`);
    if (tiesInput === null) return;
    const ties = Number(tiesInput);
    if (isNaN(ties) || ties < 1) return;
    if (ties === 1) return;

    const endIndex = Math.min(index + ties, currentPayoutNumPaid);
    let total = 0;
    for (let i = index; i < endIndex; i++) {
        total += currentPayoutAmounts[i];
    }

    const share = total / ties;
    for (let i = index; i < endIndex; i++) {
        currentPayoutAmounts[i] = share;
    }

    currentPayoutPills = currentPayoutPills.filter(p => p.index !== index);
    const overflow = index + ties - currentPayoutNumPaid;
    for (let i = 0; i < overflow; i++) {
        currentPayoutPills.push({ index, amount: share });
    }

    currentTieMap[index] = { endIndex, ties };
    renderPayoutList();
}

async function finalizeRound() {
    if (!selectedLeague) {
        alert('No league selected.');
        return;
    }

    const dateInput = document.getElementById('league-round-date');
    const locationInput = document.getElementById('league-round-location');
    const layoutInput = document.getElementById('league-round-layout');
    const roundCostInput = document.getElementById('league-round-cost');
    const clubFeesInput = document.getElementById('league-club-fees');
    const ctpInput = document.getElementById('league-ctp');
    const aceCostInput = document.getElementById('league-ace-cost');
    const perPlayerInput = document.getElementById('league-payout-per-player');
    const pctInput = document.getElementById('league-payout-pct');

    const date = dateInput?.value;
    const location = locationInput?.value.trim();
    const layout = layoutInput?.value.trim();

    if (!date) { alert('Please enter a date.'); return; }
    if (!location) { alert('Please enter a location.'); return; }
    if (!layout) { alert('Please enter a layout.'); return; }

    if (currentPayoutAmounts.length === 0) {
        calculatePayouts();
    }

    const numPlayers = getCheckins().length;
    const acePayerCount = getAcePayers().length;
    const roundCost = Number(roundCostInput?.value) || 0;
    const clubFees = Number(clubFeesInput?.value) || 0;
    const ctp = Number(ctpInput?.value) || 0;
    const aceCost = Number(aceCostInput?.value) || 0;
    const perPlayer = Number(perPlayerInput?.value) || 0;
    const pct = Number(pctInput?.value) || 0;

    const payouts = [];
    let i = 0;
    while (i < currentPayoutNumPaid) {
        let j = i + 1;
        while (j < currentPayoutNumPaid && currentPayoutAmounts[j] === currentPayoutAmounts[i]) {
            j++;
        }
        const isTie = j - i > 1;
        const hasPills = currentPayoutPills.some(p => p.index === i);
        for (let k = i; k < j; k++) {
            payouts.push({
                place: isTie || hasPills ? `Tie ${ordinal(i + 1)}` : ordinal(k + 1),
                amount: Number(currentPayoutAmounts[k].toFixed(2))
            });
        }
        i = j;
    }
    currentPayoutPills.forEach(pill => {
        payouts.push({
            place: `Tie ${ordinal(pill.index + 1)}`,
            amount: Number(pill.amount.toFixed(2))
        });
    });

    const totalCollected = numPlayers * roundCost;
    const totalPaidOut = numPlayers * perPlayer;
    const totalAcePot = acePayerCount * aceCost;
    const totalClubFees = numPlayers * clubFees;

    const roundData = {
        date,
        location,
        layout,
        roundFinances: {
            numPlayers,
            acePayerCount,
            roundCost,
            clubFees,
            ctp,
            aceCost,
            perPlayerToPayout: perPlayer,
            percentPaid: pct
        },
        payouts,
        summary: {
            totalCollected,
            totalPaidOut,
            totalAcePot,
            totalClubFees
        },
        finalizedAt: new Date().toISOString()
    };

    const docId = `${selectedLeague.year}${selectedLeague.season}${selectedLeague.leagueType}`;
    const weekField = `week_${date}`;

    const isDoubles = selectedLeague?.leagueType?.toLowerCase() === 'doubles';
    const tags = getCheckinTags();
    const originalTags = getCheckinTagsOriginal();
    if (!isDoubles && Object.keys(originalTags).length > 0 && !tagsAssigned) {
        alert('Please assign tags using "Assign Tags by Score" before finalizing.');
        return;
    }
    const tagsData = {};
    if (!isDoubles) {
        Object.entries(tags).forEach(([owner, tagNum]) => {
            if (!tagNum) return;
            tagsData[String(tagNum)] = {
                lastReportedOwner: owner,
                lastReportedDateSeen: date
            };
        });
        Object.entries(originalTags).forEach(([owner, tagNum]) => {
            if (!tagNum) return;
            const key = String(tagNum);
            if (!tagsData[key]) {
                tagsData[key] = {
                    lastReportedOwner: 'League Box',
                    lastReportedDateSeen: date
                };
            }
        });
    }

    try {
        const director = auth.currentUser?.email || 'Unknown';
        await setDoc(doc(db, 'leagues', docId), { [weekField]: roundData, director }, { merge: true });

        const year = String(selectedLeague.year);
        if (Object.keys(tagsData).length > 0) {
            await setDoc(doc(db, 'tags', year), tagsData, { merge: true });
        }

        alert(`Round finalized under ${docId} -> ${weekField}`);

        resetRound();
    } catch (e) {
        console.error('Finalize round failed:', e);
        alert('Could not save round. See console for details.');
    }
}

function resetRound() {
    saveCheckins([]);
    saveAcePayers([]);
    saveCheckinTags({});
    saveCheckinTagsOriginal({});
    saveRoundScores({});
    tagsAssigned = false;
    saveTagsAssigned(false);
    cardsVisible = false;
    currentPayoutAmounts = [];
    currentPayoutPills = [];
    currentTieMap = {};
    currentPayoutNumPaid = 0;
    currentPayoutTotal = 0;

    const checkinList = document.getElementById('league-checkin-list');
    if (checkinList) checkinList.innerHTML = '<p style="opacity:0.5; text-align:center;">No one checked in yet.</p>';
    const cardsContainer = document.getElementById('league-cards-container');
    if (cardsContainer) cardsContainer.style.display = 'none';
    const checkinInput = document.getElementById('league-checkin-input');
    if (checkinInput) checkinInput.value = '';
    const checkinAce = document.getElementById('league-checkin-ace');
    if (checkinAce) checkinAce.value = 'yes';
    const checkinTag = document.getElementById('league-checkin-tag');
    if (checkinTag) checkinTag.value = '';
    const showCheckedBtn = document.getElementById('league-show-checked');
    if (showCheckedBtn) {
        showCheckedBtn.style.display = 'inline-block';
        showCheckedBtn.textContent = 'Check In';
    }
    renderTags();
    const results = document.getElementById('league-payout-results');
    if (results) results.innerHTML = '';

    const dateInput = document.getElementById('league-round-date');
    const locationInput = document.getElementById('league-round-location');
    const layoutInput = document.getElementById('league-round-layout');
    const roundCostInput = document.getElementById('league-round-cost');
    const clubFeesInput = document.getElementById('league-club-fees');
    const ctpInput = document.getElementById('league-ctp');
    const aceCostInput = document.getElementById('league-ace-cost');
    const perPlayerInput = document.getElementById('league-payout-per-player');
    const pctInput = document.getElementById('league-payout-pct');
    const playersInput = document.getElementById('league-payout-players');
    const finalizeBtn = document.getElementById('league-finalize-round');

    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    if (locationInput) locationInput.value = '';
    if (layoutInput) layoutInput.value = '';
    const isScratch = selectedLeague?.leagueType?.toLowerCase() === 'scratch';
    if (roundCostInput) roundCostInput.value = '5.00';
    if (clubFeesInput) clubFeesInput.value = '0.50';
    if (ctpInput) ctpInput.value = isScratch ? '0.50' : '0.00';
    if (aceCostInput) aceCostInput.value = '1.00';
    if (perPlayerInput) perPlayerInput.value = isScratch ? '4.00' : '4.50';
    if (pctInput) pctInput.value = '30.00';
    if (playersInput) {
        playersInput.value = isScratch ? '4' : '0';
        playersInput.readOnly = !isScratch;
        playersInput.style.opacity = isScratch ? '1' : '0.7';
        playersInput.style.cursor = isScratch ? 'text' : 'not-allowed';
    }
    if (finalizeBtn) {
        finalizeBtn.disabled = true;
        finalizeBtn.style.opacity = '0.5';
        finalizeBtn.style.cursor = 'not-allowed';
    }

    const payoutForm = document.getElementById('league-payout-form');
    const payoutSubtitle = document.getElementById('league-payout-subtitle');
    if (isScratch) {
        if (payoutForm) payoutForm.style.display = 'none';
        if (payoutSubtitle) payoutSubtitle.style.display = 'none';
        if (results) results.innerHTML = getScratchPayoutTable();
    } else {
        if (payoutForm) payoutForm.style.display = 'block';
        if (payoutSubtitle) payoutSubtitle.style.display = 'block';
    }
    updatePayoutPerPlayer();
    updateScratchFinancesVisibility();
}

function showLeagueActions() {
    const actions = document.getElementById('league-actions');
    const switchBtn = document.getElementById('league-switch-btn');
    if (actions) {
        actions.style.display = 'flex';
        const showSwitch = userLeagues.length > 1 && selectedLeague !== null;
        actions.style.justifyContent = showSwitch ? 'flex-start' : 'flex-end';
        if (switchBtn) {
            switchBtn.style.display = showSwitch ? '' : 'none';
        }
    }
}

function hideLeagueActions() {
    const actions = document.getElementById('league-actions');
    if (actions) actions.style.display = 'none';
}

function setupLeagueActions() {
    showLeagueActions();
    const switchBtn = document.getElementById('league-switch-btn');
    const logoutBtn = document.getElementById('league-logout-btn');
    if (switchBtn) {
        switchBtn.onclick = () => {
            selectedLeague = null;
            initLeagueCentral(userLeagues);
        };
    }
    if (logoutBtn) {
        logoutBtn.onclick = () => signOutLeagueAdmin();
    }
}

async function signOutLeagueAdmin() {
    selectedLeague = null;
    userLeagues = [];
    hideLeagueActions();
    try { await signOut(auth); } catch (e) { console.error('League sign out error:', e); }
}

function setLeagueTitle(titleText = 'League Central') {
    const title = document.getElementById('league-title');
    if (title) title.textContent = titleText;
}

function formatLeagueTitle(league) {
    if (!league) return 'League Central';
    const parts = [league.year, league.season, league.leagueType].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'League Central';
}

function showLeagueSelectorCard(show) {
    const card = document.getElementById('league-selector-card');
    if (card) card.style.display = show ? 'block' : 'none';
}

function showCheckinCard(show) {
    const card = document.getElementById('league-checkin-card');
    if (card) card.style.display = show ? 'block' : 'none';
}

async function initLeagueCentral(leagues) {
    userLeagues = leagues || [];
    if (!leagues || leagues.length === 0) {
        setLeagueTitle('League Central');
        showLeagueSelectorCard(false);
        showCheckinCard(true);
        selectedLeague = null;
        await loadLeagueCheckin();
        setupLeagueActions();
        return;
    }

    if (leagues.length === 1) {
        selectedLeague = leagues[0];
        setLeagueTitle(formatLeagueTitle(leagues[0]));
        showLeagueSelectorCard(false);
        showCheckinCard(true);
        await loadLeagueCheckin();
        setupLeagueActions();
        return;
    }

    // Multiple leagues — show selector
    setLeagueTitle('League Central');
    showCheckinCard(false);
    showLeagueSelectorCard(true);

    const select = document.getElementById('league-type-select');
    const continueBtn = document.getElementById('league-type-continue');
    if (!select || !continueBtn) return;

    select.innerHTML = '<option value="" disabled selected>Select a league...</option>';
    leagues.forEach(league => {
        const option = document.createElement('option');
        option.value = JSON.stringify(league);
        option.textContent = formatLeagueTitle(league);
        select.appendChild(option);
    });

    continueBtn.onclick = async () => {
        const selected = select.value;
        if (!selected) return;
        try {
            const league = JSON.parse(selected);
            selectedLeague = league;
            setLeagueTitle(formatLeagueTitle(league));
            showLeagueSelectorCard(false);
            showCheckinCard(true);
            await loadLeagueCheckin();
            showLeagueActions();
        } catch (e) {
            console.error('Invalid league selection:', e);
        }
    };

    setupLeagueActions();
}

export async function checkLeagueAccess(currentUser = null) {
    if (isChecking) return;
    isChecking = true;

    try {
        // If we just came back from a Google redirect sign-in, surface any error
        let redirectResult = null;
        if (!currentUser) {
            redirectResult = await getRedirectResult(auth).catch(err => err);
        }
        if (redirectResult && redirectResult.code) {
            console.error("League redirect sign-in error:", redirectResult);
            alert(`Login error: ${redirectResult.message}`);
            isChecking = false;
            return;
        }

        const leagueLogin = document.getElementById('league-login');
        const leagueContent = document.getElementById('league-content');
        const loginBtn = document.getElementById('league-login-btn');

        if (leagueLogin) leagueLogin.style.display = 'block';
        if (leagueContent) leagueContent.style.display = 'none';

        if (loginBtn) {
            loginBtn.onclick = async () => {
                await signInLeagueAdmin();
            };
        }

        const emailForm = document.getElementById('league-email-login-form');
        if (emailForm && !emailForm.dataset.bound) {
            emailForm.dataset.bound = 'true';
            emailForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('league-email-input').value.trim();
                const password = document.getElementById('league-password-input').value;
                if (!email || !password) return;

                try {
                    await signInWithEmailAndPassword(auth, email, password);
                    // onAuthStateChanged in theme.js will re-run checkLeagueAccess
                } catch (error) {
                    console.error("League email sign-in error:", error);
                    alert(`Sign-in failed: ${error.message}`);
                }
            });
        }

        bindFirstTimeSetup('league', async (email) => (await checkLeagueAdminEligibility(email)).isAdmin);

        const user = currentUser || auth.currentUser || redirectResult?.user;
        const attempted = localStorage.getItem('league_login_attempted') === 'true';
        if (attempted) {
            localStorage.removeItem('league_login_attempted');
        }

        if (user) {
            const authorized = await isLeagueAdmin(user.email);
            if (authorized.isAdmin) {
                if (leagueLogin) leagueLogin.style.display = 'none';
                if (leagueContent) leagueContent.style.display = 'block';
                await initLeagueCentral(authorized.leagues);
            } else {
                await signOut(auth);
                alert(`Access Denied: ${user.email} is not a league admin.`);
            }
        } else if (attempted) {
            alert('Login did not return a user. The mobile URL may not be authorized in Firebase, or the browser blocked the redirect.');
        }
    } catch (error) {
        console.error("League auth check error:", error);
        alert(`League auth error: ${error.message}`);
    } finally {
        isChecking = false;
    }
}

async function signInLeagueAdmin() {
    localStorage.setItem('league_login_attempted', 'true');

    const isMobile = window.innerWidth <= 768;

    if (!isMobile) {
        // Desktop: popup usually works fine
        try {
            await signInWithPopup(auth, provider);
            // onAuthStateChanged in theme.js will handle the UI
        } catch (error) {
            console.error("League popup sign-in error:", error);
            alert(`Sign-in failed: ${error.message}`);
        }
        return;
    }

    // Mobile: try popup first (it may work in Firefox Mobile from a user click)
    try {
        await signInWithPopup(auth, provider);
        // onAuthStateChanged in theme.js will handle the UI
        return;
    } catch (popupError) {
        if (popupError.code !== 'auth/popup-blocked' && popupError.code !== 'auth/popup-closed-by-user') {
            console.error("League popup sign-in error:", popupError);
            alert(`Sign-in failed: ${popupError.message}`);
            return;
        }
    }

    // If mobile popup was blocked, fall back to redirect
    localStorage.setItem(LEAGUE_HASH_KEY, window.location.hash);
    await signInWithRedirect(auth, provider);
}

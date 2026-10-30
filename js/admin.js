import { db, auth } from './firebase-config.js?v=100';
import { 
    doc, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, getDocs, deleteDoc, deleteField,
    collection, addDoc, serverTimestamp, writeBatch, query, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin, getRoster, clearDocCache } from './firestore.js?v=153';
import { sha256Hex, makeBallotToken, makeVoteLink, updateVoteNavLink } from './vote.js?v=100';
import { LOCATIONS, COURSE_NAME_OVERRIDES, LAYOUT_SUGGESTIONS, getCourseDisplayName, getCourseStorageName } from './courseData.js?v=100';

// State and Cache
let viewDate = new Date(); 
const eventCache = {};
let playersCache = null;

/**
 * Main Initialization
 */
export function initAdminForm() {
    setupAdminTabs();
    setupEventCarousel();
    initEventForm();
    initAceForm();
    initCourseRecordForm();
    loadCourseSuggestions();
    initMinutesForm();
    initFinanceForm(); // New Treasury Management Logic
    initLeagueRandomizer();
    updateManagementUI();
    initLeagueAdminManager();
    initLeagueRoster();
    initFreeRoundsManager();
    initElections();
    initCollapsibleSections();
    loadDeployInfo();
}

/**
 * Shows the latest main-branch commit next to the build stamp so admins can
 * tell whether the deployed page is current or just cached. GitHub API is
 * rate-limited unauthenticated — cache the result for the session.
 */
async function loadDeployInfo() {
    const el = document.getElementById('admin-latest-push');
    if (!el) return;
    const cached = sessionStorage.getItem('bndisc_latest_push');
    if (cached) { el.textContent = ` · latest push: ${cached}`; return; }
    try {
        const res = await fetch('https://api.github.com/repos/jacobgeckert/BNDisc/commits/main?per_page=1', {
            headers: { Accept: 'application/vnd.github+json' }
        });
        if (!res.ok) return;
        const [c] = await res.json();
        if (!c?.sha) return;
        const text = `${c.sha.slice(0, 7)} (${new Date(c.commit.committer.date).toLocaleString()})`;
        sessionStorage.setItem('bndisc_latest_push', text);
        el.textContent = ` · latest push: ${text}`;
    } catch (e) { /* offline or rate-limited — static stamp still shows */ }
}

/**
 * On mobile, each top-level dashboard section (Add New Event, Delete Events,
 * Club Meeting Minutes, etc.) collapses behind its heading so the page isn't
 * one long scroll. Desktop is unaffected (see CSS media query).
 */
function initCollapsibleSections() {
    const sections = document.querySelectorAll(
        '#admin-content .admin-grid > .admin-card, #admin-content .admin-grid-wide > .admin-card'
    );

    sections.forEach(section => {
        const heading = section.querySelector(':scope > h3');
        if (!heading || heading.dataset.collapsibleBound) return;
        heading.dataset.collapsibleBound = 'true';
        heading.classList.add('admin-section-heading');

        heading.addEventListener('click', () => {
            section.classList.toggle('expanded');
        });
    });
}

/**
 * 1. FINANCIAL MANAGEMENT (Optimized Year Bundling)
 * Saves deposits and withdrawals into a single yearly document.
 */
function initFinanceForm() {
    const form = document.getElementById('finance-form');
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-finance');
        
        const rawDate = document.getElementById('fin-date').value;
        if (!rawDate) return alert("Please select a date.");
        
        const yearId = rawDate.split('-')[0]; // "2026"

        const transaction = {
            id: crypto.randomUUID(),
            date: rawDate,
            type: document.getElementById('fin-type').value, // "Deposit" or "Withdrawal"
            amount: parseFloat(document.getElementById('fin-amount').value),
            category: document.getElementById('fin-category').value,
            memo: document.getElementById('fin-memo').value,
            recordedAt: new Date().toISOString()
        };

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recording...';
            }

            // Path: finance_bundles/{yearId}
            const docRef = doc(db, "finance_bundles", yearId);
            
            await setDoc(docRef, { 
                transactions: arrayUnion(transaction),
                lastModified: serverTimestamp()
            }, { merge: true });

            alert(`$${transaction.amount} ${transaction.type} recorded for ${yearId}!`);
            form.reset();
        } catch (error) {
            console.error("Finance Error:", error);
            alert("Error logging transaction. Check permissions.");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> Log Transaction';
            }
        }
    };
    loadExpectedLeagueTotals();
}

/**
 * X. LEAGUE EXPECTED TOTALS
 */
async function loadExpectedLeagueTotals() {
    const container = document.getElementById('league-expected-totals');
    if (!container) return;

    const currentYear = new Date().getFullYear().toString();

    try {
        const snapshot = await getDocs(collection(db, 'leagues'));
        const leagues = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data() || {};
            const weeks = Object.keys(data).filter(k => k.startsWith('week_'));
            if (weeks.length === 0) return;

            const year = docSnap.id.substring(0, 4);
            if (year !== currentYear) return;

            const director = data.director || '—';

            const rounds = weeks.map(key => {
                const round = data[key] || {};
                const summary = round.summary || {};
                return {
                    date: round.date || key.replace('week_', ''),
                    clubFees: Number(summary.totalClubFees) || 0,
                    acePot: Number(summary.totalAcePot) || 0
                };
            }).sort((a, b) => new Date(a.date) - new Date(b.date));

            const totals = rounds.reduce((acc, r) => {
                acc.clubFees += r.clubFees;
                acc.acePot += r.acePot;
                return acc;
            }, { clubFees: 0, acePot: 0 });

            leagues.push({
                id: docSnap.id,
                director,
                rounds,
                clubFees: totals.clubFees,
                acePot: totals.acePot
            });
        });

        if (leagues.length === 0) {
            container.innerHTML = '<p class="subtitle" style="margin-top: 1rem; opacity: 0.7;">No finalized league rounds found for this year.</p>';
            return;
        }

        const formatMoney = n => `$${n.toFixed(2)}`;
        const formatLeagueName = id => id
            .replace(/(\d{4})([A-Z])/g, '$1 $2')
            .replace(/([a-z])([A-Z])/g, '$1 $2');
        const formatDate = str => {
            if (!str) return '—';
            const d = new Date(str);
            return isNaN(d) ? str : d.toLocaleDateString('en-US');
        };
        container.innerHTML = `
            <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                <h4 style="margin: 0 0 0.5rem 0;">Expected League Submissions</h4>
                ${leagues.map(l => `
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--glass-border);">
                                <th colspan="3" style="text-align: left; padding: 0.5rem;">
                                    ${formatLeagueName(l.id)} — ${l.director}
                                </th>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--glass-border);">
                                <th style="text-align: left; padding: 0.5rem;">Date</th>
                                <th style="text-align: right; padding: 0.5rem;">Club Fees</th>
                                <th style="text-align: right; padding: 0.5rem;">Ace Pot</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${l.rounds.map(r => `
                                <tr>
                                    <td style="padding: 0.5rem;">${formatDate(r.date)}</td>
                                    <td style="text-align: right; padding: 0.5rem;">${formatMoney(r.clubFees)}</td>
                                    <td style="text-align: right; padding: 0.5rem;">${formatMoney(r.acePot)}</td>
                                </tr>
                            `).join('')}
                            <tr style="border-top: 1px solid var(--glass-border); font-weight: bold;">
                                <td style="padding: 0.5rem;">Total</td>
                                <td style="text-align: right; padding: 0.5rem;">${formatMoney(l.clubFees)}</td>
                                <td style="text-align: right; padding: 0.5rem;">${formatMoney(l.acePot)}</td>
                            </tr>
                        </tbody>
                    </table>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Error loading expected league totals:', error);
        container.innerHTML = '<p class="subtitle" style="margin-top: 1rem; opacity: 0.7;">Error loading league totals.</p>';
    }
}

/**
 * 2. MEETING MINUTES MANAGEMENT (Bundled by Year)
 */
function initMinutesForm() {
    const form = document.getElementById('minutes-form');
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('.btn-primary');
        
        const meetingDate = document.getElementById('minutes-date').value; 
        if (!meetingDate) return alert("Please select a meeting date.");
        
        const yearId = meetingDate.split('-')[0];

        const minutesData = {
            id: crypto.randomUUID(),
            meetingDate: meetingDate,
            startTime: document.getElementById('minutes-start-time').value,
            location: document.getElementById('minutes-location').value,
            presiding: document.getElementById('minutes-presiding').value,
            secretary: document.getElementById('minutes-secretary').value,
            attendance: document.getElementById('minutes-attendance').value,
            missing: document.getElementById('minutes-missing').value,
            guests: document.getElementById('minutes-guests').value,
            sponsorship: document.getElementById('minutes-sponsorship').value,
            oldBusiness: document.getElementById('minutes-old-business').value,
            newBusiness: document.getElementById('minutes-new-business').value,
            aroundRoom: document.getElementById('minutes-around-room').value,
            courseMaintenance: document.getElementById('minutes-course-maintenance').value,
            nextMeeting: document.getElementById('minutes-next-meeting').value,
            nextLocation: document.getElementById('minutes-next-location').value,
            submittedAt: new Date().toISOString() 
        };

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            const docRef = doc(db, "meeting_bundles", yearId);
            await setDoc(docRef, { 
                meetings: arrayUnion(minutesData),
                lastUpdated: serverTimestamp() 
            }, { merge: true });
            
            alert(`Minutes for ${meetingDate} saved!`);
            form.reset();
        } catch (error) {
            console.error("Minutes Error:", error);
            alert("Error saving minutes.");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Meeting Minutes';
            }
        }
    };
}

/**
 * 3. EVENT MANAGEMENT (Bundled by Month)
 */
// Tracks the event currently being edited (its original bundle month + data),
// so submitting the "Add New Event" form updates it in place instead of
// creating a duplicate.
let editingEvent = null; // { monthId, event }

// Concrete weekly styles for league events (a Mixed league cycles through these).
const LEAGUE_STYLES = ['Doubles', 'Handicap', 'Scratch'];

// Finds the league assignment an event belongs to. Exact year/season/type
// matches win; otherwise a Mixed assignment for that season absorbs the
// event (its weeks can be any style).
function leagueAssignmentFor(admins, year, season, leagueType) {
    const norm = String(year);
    for (const a of admins) {
        const exact = (a.leagues || []).find(l =>
            String(l.year) === norm && l.season === season && l.leagueType === leagueType);
        if (exact) return { year: exact.year, season: exact.season, leagueType: exact.leagueType };
    }
    for (const a of admins) {
        const mixed = (a.leagues || []).find(l =>
            String(l.year) === norm && l.season === season && l.leagueType === 'Mixed');
        if (mixed) return { year: mixed.year, season: mixed.season, leagueType: 'Mixed' };
    }
    return null;
}

// All distinct league assignments across league_admins docs (deduped by
// year|season|type), sorted newest season first for the picker.
function distinctLeagueAssignments(admins) {
    const seen = new Map();
    admins.forEach(a => (a.leagues || []).forEach(l => {
        const key = `${l.year}|${l.season}|${l.leagueType}`;
        if (!seen.has(key)) seen.set(key, { year: l.year, season: l.season, leagueType: l.leagueType });
    }));
    const order = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
    return [...seen.values()].sort((a, b) =>
        (Number(b.year) - Number(a.year)) || ((order[b.season] ?? -1) - (order[a.season] ?? -1)));
}

// Populates the event form's League picker from league_admins assignments.
async function populateEventLeagueSelect() {
    const select = document.getElementById('event-league');
    if (!select) return;
    const current = select.dataset.selected || select.value;
    select.innerHTML = '<option value="">Unassigned</option>';
    try {
        const snap = await getDocs(collection(db, 'league_admins'));
        const admins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        let wanted = null;
        try { wanted = current ? JSON.parse(current) : null; } catch (e) { wanted = null; }
        distinctLeagueAssignments(admins).forEach(l => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify(l);
            opt.textContent = `${l.year} ${l.season} ${l.leagueType}`;
            if (wanted && String(l.year) === String(wanted.year) &&
                l.season === wanted.season && l.leagueType === wanted.leagueType) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn('Could not load league assignments:', e);
    }
}

// Picking a league locks the event's type to the league's own type.
function syncEventLeagueSelect() {
    const leagueSelect = document.getElementById('event-league');
    const typeSelect = document.getElementById('event-league-type');
    if (!leagueSelect || !typeSelect) return;
    const league = leagueSelect.value ? JSON.parse(leagueSelect.value) : null;
    typeSelect.disabled = !!league;
    typeSelect.style.opacity = league ? '0.7' : '1';
    if (league) typeSelect.value = league.leagueType;
    syncEventRoundTypeVisibility();
}

// Mixed league events need a per-week style; show the Round Style select
// only when the event's league type is Mixed.
function syncEventRoundTypeVisibility() {
    const isMixed = document.getElementById('event-league-type')?.value === 'Mixed';
    const label = document.getElementById('event-round-type-label');
    const select = document.getElementById('event-round-type');
    if (label) label.style.display = isMixed ? '' : 'none';
    if (select) select.style.display = isMixed ? 'block' : 'none';
}

function initEventForm() {
    const form = document.getElementById('event-form');
    if (!form) return;

    initEventLayoutSuggestions();

    // Mixed league events pick a per-week style (stored as event.roundType).
    const leagueTypeSelect = document.getElementById('event-league-type');
    leagueTypeSelect?.addEventListener('change', syncEventRoundTypeVisibility);
    syncEventRoundTypeVisibility();

    const leagueSelect = document.getElementById('event-league');
    leagueSelect?.addEventListener('change', syncEventLeagueSelect);
    populateEventLeagueSelect();

    const cancelBtn = document.getElementById('cancel-edit-event');
    if (cancelBtn) {
        cancelBtn.onclick = () => cancelEditEvent();
    }

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-event');
        
        try {
            const category = document.getElementById('event-category').value;
            const rawDate = document.getElementById('event-date').value; 
            const [year, month, day] = rawDate.split('-');
            const monthId = `${year}-${month}`;
            
            if (submitBtn) submitBtn.disabled = true;

            const leagueType = document.getElementById('event-league-type').value;
            const newEvent = {
                category,
                day: parseInt(day),
                time: document.getElementById('event-time').value,
                location: document.getElementById('event-loc').value,
                leagueType,
                layout: document.getElementById('event-layout').value,
                createdAt: editingEvent ? editingEvent.event.createdAt : new Date().toISOString()
            };
            if (category === 'League' && leagueType === 'Mixed') {
                const roundType = document.getElementById('event-round-type')?.value;
                if (!roundType) {
                    if (submitBtn) submitBtn.disabled = false;
                    alert('Pick a round style for this Mixed league event.');
                    return;
                }
                newEvent.roundType = roundType;
            }

            // Stamp the league director names onto the event so the public
            // calendar popup can show them without reading league_admins
            // (which is not publicly listable). Also stamp which league the
            // event belongs to so the schedule groups by league, not style.
            if (category === 'League' && newEvent.leagueType) {
                const season = getSeasonFromMonth(parseInt(month, 10));
                const adminsSnap = await getDocs(collection(db, 'league_admins'));
                const admins = adminsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                const picked = document.getElementById('event-league')?.value;
                const league = picked ? JSON.parse(picked)
                    : leagueAssignmentFor(admins, year, season, newEvent.leagueType);
                if (league) {
                    newEvent.league = league;
                    newEvent.leagueType = league.leagueType;
                }
                newEvent.directors = leagueDirectorsFor(admins, league ? league.year : year,
                    league ? league.season : season, newEvent.leagueType);
            }

            if (editingEvent) {
                // Remove the original event (possibly from a different month's bundle)
                // and add the updated version.
                const oldDocRef = doc(db, "event_bundles", editingEvent.monthId);
                await setDoc(oldDocRef, { events: arrayRemove(editingEvent.event) }, { merge: true });
                delete eventCache[editingEvent.monthId];

                const newDocRef = doc(db, "event_bundles", monthId);
                await setDoc(newDocRef, { events: arrayUnion(newEvent) }, { merge: true });
                delete eventCache[monthId];

                alert("Event updated!");
                cancelEditEvent();
            } else {
                const docRef = doc(db, "event_bundles", monthId);
                await setDoc(docRef, { events: arrayUnion(newEvent) }, { merge: true });
                delete eventCache[monthId];

                alert("Event saved!");
                form.reset();
            }

            updateManagementUI();
        } catch (error) {
            console.error(error);
            alert("Error saving event.");
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

/**
 * Wires up the same location/layout suggestion dropdowns used on the league
 * dashboard's "Finalize Round" form so admins get course/layout autocomplete
 * when adding or editing calendar events.
 */
function initEventLayoutSuggestions() {
    const locationInput = document.getElementById('event-loc');
    const layoutInput = document.getElementById('event-layout');
    const locationSuggestions = document.getElementById('event-location-suggestions');
    const layoutSuggestions = document.getElementById('event-layout-suggestions');

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

/**
 * Populates the "Add New Event" form with an existing event's data so it can
 * be edited in place, and puts the form into "edit mode" (see initEventForm).
 */
function startEditEvent(monthId, event) {
    editingEvent = { monthId, event };

    const [year, month] = monthId.split('-');
    document.getElementById('event-category').value = event.category;
    document.getElementById('event-date').value = `${year}-${month}-${String(event.day).padStart(2, '0')}`;
    document.getElementById('event-time').value = event.time;
    document.getElementById('event-loc').value = event.location;
    document.getElementById('event-league-type').value = event.leagueType || '';
    const roundTypeSelect = document.getElementById('event-round-type');
    if (roundTypeSelect) roundTypeSelect.value = event.roundType || 'Handicap';
    const leagueSelect = document.getElementById('event-league');
    if (leagueSelect) {
        leagueSelect.dataset.selected = event.league ? JSON.stringify(event.league) : '';
        populateEventLeagueSelect().then(syncEventLeagueSelect);
    } else {
        syncEventRoundTypeVisibility();
    }
    document.getElementById('event-layout').value = event.layout || '';

    const heading = document.getElementById('event-form-heading');
    if (heading) heading.textContent = 'Edit Event';

    const editingNote = document.getElementById('event-form-editing-note');
    if (editingNote) editingNote.style.display = 'block';

    const submitBtn = document.getElementById('submit-event');
    if (submitBtn) submitBtn.querySelector('span').textContent = 'Update Event';

    const cancelBtn = document.getElementById('cancel-edit-event');
    if (cancelBtn) cancelBtn.style.display = '';

    // Switch to the tab containing the event form so the populated form is
    // actually visible (the form lives in a different admin tab than the
    // Manage Events list).
    const formPanel = document.getElementById('event-form').closest('.admin-tab-panel');
    if (formPanel) {
        const tabBtn = document.querySelector(`.admin-tab-btn[data-panel="${formPanel.id}"]`);
        if (tabBtn) tabBtn.click();
        else formPanel.classList.add('active');
    }

    // On mobile, the "Add New Event" section may be collapsed; expand it and
    // scroll it into view so the populated form is visible.
    const eventCard = document.getElementById('event-form').closest('.admin-card');
    if (eventCard) {
        eventCard.classList.add('expanded');
        eventCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function cancelEditEvent() {
    editingEvent = null;

    const form = document.getElementById('event-form');
    if (form) form.reset();
    const leagueSelect = document.getElementById('event-league');
    if (leagueSelect) leagueSelect.dataset.selected = '';
    syncEventLeagueSelect();

    const heading = document.getElementById('event-form-heading');
    if (heading) heading.textContent = 'Add New Event';

    const editingNote = document.getElementById('event-form-editing-note');
    if (editingNote) editingNote.style.display = 'none';

    const submitBtn = document.getElementById('submit-event');
    if (submitBtn) submitBtn.querySelector('span').textContent = 'Save Event';

    const cancelBtn = document.getElementById('cancel-edit-event');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

/**
 * 4. ACE MANAGEMENT
 */
function initAceForm() {
    const form = document.getElementById('ace-form');
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-ace');
        const rawCourse = document.getElementById('ace-course').value;
        const courseName = getCourseStorageName(rawCourse);
        const courseDisplay = getCourseDisplayName(courseName);

        const aceData = {
            playerName: document.getElementById('ace-player').value,
            hole: document.getElementById('ace-hole').value,
            disc: document.getElementById('ace-disc').value,
            distance: document.getElementById('ace-dist').value,
            pad: document.getElementById('ace-pad').value || "",
            basket: document.getElementById('ace-basket').value || "",
            date: document.getElementById('ace-date').value,
            id: crypto.randomUUID() 
        };

        try {
            if (submitBtn) submitBtn.disabled = true;
            const docRef = doc(db, "ace_bundles", courseName);
            await setDoc(docRef, { aces: arrayUnion(aceData) }, { merge: true });

            alert(`Ace recorded for ${courseDisplay}!`);
            form.reset();
        } catch (error) {
            console.error(error);
            alert("Error saving ace.");
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

async function loadCourseSuggestions() {
    const courseList = document.getElementById('course-suggestions');
    const recPark = document.getElementById('rec-park');
    const recLayout = document.getElementById('rec-layout');
    if (!courseList) return;

    try {
        const snapshot = await getDocs(collection(db, 'course_records'));
        const suggestedParks = new Set();
        const layoutsByPark = {};

        const defaultCourses = ['P.J. Irvin', 'Forrest', 'Maxwell', 'Heartland', 'Flying Iron (NCHS)'];
        defaultCourses.forEach(park => {
            suggestedParks.add(park);
            const storageKey = getCourseStorageName(park).toLowerCase();
            if (LAYOUT_SUGGESTIONS[storageKey]) {
                layoutsByPark[park.toLowerCase()] = [...LAYOUT_SUGGESTIONS[storageKey]];
            }
        });

        snapshot.forEach(docSnap => {
            const storageName = docSnap.id;
            const displayName = getCourseDisplayName(storageName);
            if (displayName.toLowerCase().includes('old design')) return;
            suggestedParks.add(displayName);
            const data = docSnap.data() || {};
            const layouts = Object.keys(data.layouts || {});
            const key = displayName.toLowerCase();
            const current = layoutsByPark[key] || [];
            layoutsByPark[key] = [...new Set([...current, ...layouts])];
        });

        courseList.innerHTML = '';
        suggestedParks.forEach(park => {
            const option = document.createElement('option');
            option.value = park;
            courseList.appendChild(option);
        });

        function updateLayoutList() {
            if (!recLayout || !recPark) return;
            const rawPark = recPark.value || '';
            const park = rawPark.trim().toLowerCase();
            const storageName = getCourseStorageName(rawPark);
            const displayName = getCourseDisplayName(storageName).toLowerCase();
            const layouts = layoutsByPark[park] || layoutsByPark[displayName] || [];
            recLayout.innerHTML = '<option value="" disabled selected>Select a layout...</option>';
            layouts.forEach(layout => {
                const option = document.createElement('option');
                option.value = layout;
                option.textContent = layout;
                recLayout.appendChild(option);
            });
        }

        if (recPark) {
            recPark.addEventListener('input', updateLayoutList);
            recPark.addEventListener('change', updateLayoutList);
        }
        updateLayoutList();

        // Custom dropdown of park names that exist in the course_records
        // collection (plus defaults), matching the event form's style.
        const recLocSuggestions = document.getElementById('rec-location-suggestions');
        if (recLocSuggestions && recPark) {
            const parks = [...suggestedParks].sort((a, b) => a.localeCompare(b));
            const updateParkSuggestions = () => {
                const term = (recPark.value || '').toLowerCase();
                const matches = parks.filter(p => p.toLowerCase().includes(term));
                recLocSuggestions.innerHTML = '';
                if (matches.length === 0) {
                    recLocSuggestions.style.display = 'none';
                    return;
                }
                matches.forEach(p => {
                    const div = document.createElement('div');
                    div.textContent = p;
                    div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--glass-border);';
                    div.onmousedown = (e) => {
                        e.preventDefault();
                        recPark.value = p;
                        recLocSuggestions.style.display = 'none';
                        updateLayoutList();
                    };
                    div.onmouseenter = () => div.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))';
                    div.onmouseleave = () => div.style.background = '';
                    recLocSuggestions.appendChild(div);
                });
                recLocSuggestions.style.display = 'block';
            };
            recPark.addEventListener('input', updateParkSuggestions);
            recPark.addEventListener('focus', updateParkSuggestions);
            recPark.addEventListener('blur', () => {
                setTimeout(() => { recLocSuggestions.style.display = 'none'; }, 150);
            });
        }
    } catch (error) {
        console.error('Error loading course suggestions:', error);
    }
}

/**
 * 5. COURSE RECORDS
 */
function initCourseRecordForm() {
    const form = document.getElementById('record-form');
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-record');
        
        const rawPark = document.getElementById('rec-park').value;
        const park = getCourseStorageName(rawPark);
        const parkDisplay = getCourseDisplayName(park);
        const layout = document.getElementById('rec-layout').value;
        const division = document.querySelector('input[name="division"]:checked').value; 
        const scoreKey = division === 'W' ? 'scoresW' : 'scoresM';
        const parInput = document.getElementById('rec-par').value;
        const parValue = parInput ? parseInt(parInput) : null; 
        
        const newEntry = {
            score: parseInt(document.getElementById('rec-score').value),
            player: document.getElementById('rec-player').value,
            date: document.getElementById('rec-date').value,
            id: crypto.randomUUID()
        };

        try {
            if (submitBtn) submitBtn.disabled = true;
            const docRef = doc(db, "course_records", park);
            const docSnap = await getDoc(docRef);
            
            let layouts = docSnap.exists() ? (docSnap.data().layouts || {}) : {};
            
            if (!layouts[layout]) {
                layouts[layout] = { par: parValue || 54, scoresM: [], scoresW: [] };
            } else if (parValue !== null) {
                layouts[layout].par = parValue;
            }

            let scores = layouts[layout][scoreKey] || [];
            scores.push(newEntry);
            scores.sort((a, b) => a.score - b.score || new Date(a.date) - new Date(b.date));
            layouts[layout][scoreKey] = scores.slice(0, 3);

            await setDoc(docRef, { layouts }, { merge: true });
            alert(`Record added for ${parkDisplay}!`);
            form.reset();
        } catch (error) {
            console.error("Record Update Error:", error);
            alert("Error updating records.");
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };
}

/**
 * UI HELPERS
 */
function setupEventCarousel() {
    const prevBtn = document.getElementById('prev-month');
    const nextBtn = document.getElementById('next-month');
    const leagueFilter = document.getElementById('admin-event-league-filter');
    if (prevBtn) prevBtn.onclick = () => changeMonth(-1);
    if (nextBtn) nextBtn.onclick = () => changeMonth(1);
    if (leagueFilter) leagueFilter.onchange = () => updateManagementUI();
}

function changeMonth(offset) {
    viewDate.setMonth(viewDate.getMonth() + offset);
    updateManagementUI();
}

async function updateManagementUI() {
    const monthName = viewDate.toLocaleString('default', { month: 'long' });
    const year = viewDate.getFullYear();
    const monthId = `${year}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
    
    const displayElement = document.getElementById('display-month-year');
    if (displayElement) displayElement.innerText = `${monthName} ${year}`;
    
    const listContainer = document.getElementById('admin-event-list');
    if (!listContainer) return;

    if (eventCache[monthId]) {
        renderEventList(monthId, eventCache[monthId]);
    } else {
        const docRef = doc(db, "event_bundles", monthId);
        const docSnap = await getDoc(docRef);
        const data = docSnap.exists() ? (docSnap.data().events || []) : [];
        eventCache[monthId] = data;
        renderEventList(monthId, data);
    }
}

function renderEventList(monthId, events) {
    const listContainer = document.getElementById('admin-event-list');
    const leagueFilter = document.getElementById('admin-event-league-filter')?.value || '';
    const filtered = leagueFilter ? events.filter(e => e.leagueType === leagueFilter) : events;
    listContainer.innerHTML = filtered.length === 0
        ? '<p style="opacity:0.5; padding: 1.5rem; text-align:center;">No events found.</p>'
        : '';

    const shortMonth = viewDate.toLocaleString('default', { month: 'short' });
    [...filtered].sort((a, b) => a.day - b.day).forEach(event => {
        const item = document.createElement('div');
        item.className = 'admin-event-item';
        const details = [
            event.time,
            event.location,
            event.layout,
            event.leagueType
        ].filter(Boolean).join(' • ');

        item.innerHTML = `
            <div class="admin-event-info">
                <strong>${shortMonth} ${event.day}: ${event.category}</strong>
                <span>${details}</span>
            </div>
        `;

        const actions = document.createElement('div');
        actions.className = 'admin-event-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit';
        editBtn.innerText = 'Edit';
        editBtn.onclick = () => startEditEvent(monthId, event);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete';
        delBtn.innerText = 'Delete';
        delBtn.onclick = async () => {
            if (!confirm(`Delete this event?`)) return;
            const docRef = doc(db, "event_bundles", monthId);
            await setDoc(docRef, { events: arrayRemove(event) }, { merge: true });
            delete eventCache[monthId];
            if (editingEvent && editingEvent.monthId === monthId && editingEvent.event === event) {
                cancelEditEvent();
            }
            updateManagementUI();
        };

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        item.appendChild(actions);
        listContainer.appendChild(item);
    });
}

/**
 * League Randomizer
 * Generate a schedule of league events across a date range by randomly
 * selecting a course and layout for each matching day of the week.
 */
function initLeagueRandomizer() {
    const form = document.getElementById('league-randomizer-form');
    if (!form) return;

    const parseLocal = dateStr => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    const formatLocal = date => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const getWeekStartKey = date => {
        const start = new Date(date);
        start.setDate(date.getDate() - date.getDay()); // Sunday of the week
        return formatLocal(start);
    };

    const courseFilter = document.getElementById('lr-course-filter');
    if (courseFilter) {
        courseFilter.innerHTML = LOCATIONS.map(loc => `
            <label>
                <input type="checkbox" class="lr-course-filter-option" value="${loc}" checked>
                ${loc}
            </label>
        `).join('');
    }

    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('lr-generate-btn');
        const results = document.getElementById('lr-results');

        const startDate = document.getElementById('lr-start-date').value;
        const endDate = document.getElementById('lr-end-date').value;
        const dayOfWeek = parseInt(document.getElementById('lr-day-of-week').value, 10);

        if (!startDate || !endDate) {
            alert('Please select a start and end date.');
            return;
        }

        const start = parseLocal(startDate);
        const end = parseLocal(endDate);
        if (start > end) {
            alert('Start date must be before end date.');
            return;
        }

        const selectedCourses = Array.from(document.querySelectorAll('.lr-course-filter-option:checked')).map(cb => cb.value);
        if (selectedCourses.length === 0) {
            alert('Please select at least one course.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Generating...';
        }

        // Load existing events for the months in the range so we don't
        // schedule the same course twice in the same week.
        const usedCoursesByWeek = {};
        const monthIds = new Set();
        const monthCursor = new Date(start.getFullYear(), start.getMonth(), 1);
        while (monthCursor <= end) {
            const monthId = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`;
            monthIds.add(monthId);
            monthCursor.setMonth(monthCursor.getMonth() + 1);
        }

        const usedLayouts = new Set();

        await Promise.all([...monthIds].map(async monthId => {
            try {
                const snap = await getDoc(doc(db, 'event_bundles', monthId));
                if (!snap.exists()) return;
                (snap.data().events || []).forEach(event => {
                    if (!event.location || !event.day) return;
                    const eventDate = new Date(`${monthId}-${String(event.day).padStart(2, '0')}T00:00:00`);
                    const weekKey = getWeekStartKey(eventDate);
                    if (!usedCoursesByWeek[weekKey]) usedCoursesByWeek[weekKey] = new Set();
                    usedCoursesByWeek[weekKey].add(event.location);
                    if (event.layout) usedLayouts.add(`${event.location}|${event.layout}`);
                });
            } catch (err) {
                console.error(`Error loading existing events for ${monthId}:`, err);
            }
        }));

        const generated = [];
        let current = new Date(start);

        while (current <= end) {
            if (current.getDay() === dayOfWeek) {
                const weekKey = getWeekStartKey(current);
                const used = usedCoursesByWeek[weekKey] || new Set();
                const location = getRandomUnusedLocation(used, selectedCourses, usedLayouts);
                const layout = getRandomUnusedLayout(location, usedLayouts) || getRandomLayout(location);
                const dateStr = formatLocal(current);
                const leaguePick = document.getElementById('lr-league-type').value;
                const isMixedLeague = leaguePick === 'Mixed';
                generated.push({
                    date: dateStr,
                    location,
                    layout,
                    leagueType: leaguePick,
                    style: isMixedLeague ? LEAGUE_STYLES[Math.floor(Math.random() * LEAGUE_STYLES.length)] : leaguePick
                });

                if (!usedCoursesByWeek[weekKey]) usedCoursesByWeek[weekKey] = used;
                used.add(location);
                usedLayouts.add(`${location}|${layout}`);
            }
            current.setDate(current.getDate() + 1);
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Regenerate';
        }

        renderRandomizerResults(generated, results);

        if (generated.length > 0) {
            const existingConfirm = document.getElementById('lr-confirm-btn');
            if (existingConfirm) existingConfirm.remove();

            const confirmBtn = document.createElement('button');
            confirmBtn.id = 'lr-confirm-btn';
            confirmBtn.className = 'btn-primary';
            confirmBtn.style.width = '100%';
            confirmBtn.style.marginTop = '1rem';
            confirmBtn.textContent = 'Confirm & Save Schedule';
            confirmBtn.onclick = async () => {
                const rows = results.querySelectorAll('.lr-preview-row');
                if (rows.length === 0) return;

                const checkInTime = document.getElementById('lr-checkin-time').value;
                const teeOffTime = document.getElementById('lr-teeoff-time').value;

                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Saving...';
                try {
                    const adminsSnap = await getDocs(collection(db, 'league_admins'));
                    const admins = adminsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    const eventsByMonth = {};
                    rows.forEach(row => {
                        const date = row.dataset.date;
                        const location = row.querySelector('.lr-course-select').value;
                        const leagueType = row.dataset.league;
                        const roundType = row.querySelector('.lr-league-type-select').value;
                        const layout = row.querySelector('.lr-layout-select').value;
                        const [year, month, day] = date.split('-');
                        const monthId = `${year}-${month}`;

                        const event = {
                            category: 'League',
                            day: parseInt(day, 10),
                            time: checkInTime,
                            teeOffTime,
                            location,
                            leagueType,
                            layout,
                            createdAt: new Date().toISOString()
                        };
                        if (leagueType === 'Mixed') event.roundType = roundType;

                        // Link the event to its league assignment so the
                        // schedule groups by league rather than weekly style.
                        const league = leagueAssignmentFor(admins, year,
                            getSeasonFromMonth(parseInt(month, 10)), leagueType);
                        if (league) event.league = league;

                        eventsByMonth[monthId] = eventsByMonth[monthId] || [];
                        eventsByMonth[monthId].push(event);
                    });

                    for (const [monthId, events] of Object.entries(eventsByMonth)) {
                        await setDoc(doc(db, 'event_bundles', monthId), { events: arrayUnion(...events) }, { merge: true });
                        delete eventCache[monthId];
                    }

                    alert(`Saved ${rows.length} league events.`);
                    updateManagementUI();

                    results.innerHTML = '<p class="subtitle" style="margin-top: 1rem; opacity: 0.7;">Schedule saved successfully.</p>';
                    if (btn) btn.textContent = 'Generate League Schedule';
                } catch (error) {
                    console.error('League randomizer save error:', error);
                    alert('Error saving league events.');
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Confirm & Save Schedule';
                }
            };
            results.appendChild(confirmBtn);
        }
    };
}

function getRandomLocation(pool = LOCATIONS) {
    return pool[Math.floor(Math.random() * pool.length)];
}

function getRandomLayout(location) {
    const options = LAYOUT_SUGGESTIONS[(location || '').toLowerCase().trim()];
    if (!options || options.length === 0) return 'Main';
    return options[Math.floor(Math.random() * options.length)];
}

function getRandomUnusedLayout(location, usedLayouts) {
    const options = LAYOUT_SUGGESTIONS[(location || '').toLowerCase().trim()] || ['Main'];
    const available = options.filter(o => !usedLayouts.has(`${location}|${o}`));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

function hasUnusedLayout(location, usedLayouts) {
    const options = LAYOUT_SUGGESTIONS[(location || '').toLowerCase().trim()] || ['Main'];
    return options.some(o => !usedLayouts.has(`${location}|${o}`));
}

function getRandomUnusedLocation(usedSet, pool = LOCATIONS, usedLayouts) {
    let available = pool.filter(l => !usedSet.has(l) && hasUnusedLayout(l, usedLayouts));
    if (available.length === 0) available = pool.filter(l => !usedSet.has(l));
    if (available.length === 0) return getRandomLocation(pool);
    return available[Math.floor(Math.random() * available.length)];
}

function renderRandomizerResults(generated, container) {
    if (!container) return;
    if (generated.length === 0) {
        container.innerHTML = '<p class="subtitle" style="opacity: 0.7;">No events generated for the selected range.</p>';
        return;
    }

    const layoutOptionsFor = (location, selected = '') => {
        const options = LAYOUT_SUGGESTIONS[(location || '').toLowerCase().trim()] || ['Main'];
        return options.map(o => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o}</option>`).join('');
    };

    const LEAGUE_TYPES = LEAGUE_STYLES;

    const rows = generated.map(e => `
        <tr class="lr-preview-row" data-date="${e.date}" data-league="${e.leagueType}">
            <td style="padding: 0.25rem 0.5rem;">${e.date}</td>
            <td style="padding: 0.25rem 0.5rem;">
                <select class="lr-course-select" style="width: 100%;">
                    ${LOCATIONS.map(loc => `<option value="${loc}" ${loc === e.location ? 'selected' : ''}>${loc}</option>`).join('')}
                </select>
            </td>
            <td style="padding: 0.25rem 0.5rem;">
                <select class="lr-league-type-select" style="width: 100%;">
                    ${LEAGUE_TYPES.map(t => `<option value="${t}" ${t === (e.style || e.leagueType) ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </td>
            <td style="padding: 0.25rem 0.5rem;">
                <select class="lr-layout-select" style="width: 100%;">
                    ${layoutOptionsFor(e.location, e.layout)}
                </select>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <table class="lr-preview-table" style="width: 100%; border-collapse: collapse; margin-top: 1rem; table-layout: fixed;">
            <thead>
                <tr style="border-bottom: 1px solid var(--glass-border);">
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 15%;">Date</th>
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 30%;">Course</th>
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 20%;">League Type</th>
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 35%;">Layout</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('.lr-course-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const row = sel.closest('.lr-preview-row');
            const layoutSelect = row?.querySelector('.lr-layout-select');
            if (!layoutSelect) return;
            const current = layoutSelect.value;
            layoutSelect.innerHTML = layoutOptionsFor(sel.value, current);
        });
    });
}

// Same season mapping as currentEvents.js (month is 1-12).
function getSeasonFromMonth(month) {
    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    if (month >= 9 && month <= 11) return 'Fall';
    return 'Winter';
}

function typedLeagueExists(admins, year, season, leagueType) {
    return admins.some(a => (a.leagues || []).some(l =>
        String(l.year) === String(year) && l.season === season && l.leagueType === leagueType));
}

// Returns display names for league admins whose assignments include the
// given year/season/leagueType. Admins without a name are skipped so their
// email is never shown publicly.
function leagueDirectorsFor(admins, year, season, leagueType) {
    const names = [];
    admins.forEach(a => {
        const match = (a.leagues || []).some(l =>
            String(l.year) === String(year) &&
            l.season === season &&
            (l.leagueType === leagueType ||
                (l.leagueType === 'Mixed' && leagueType !== 'Mixed' &&
                    !typedLeagueExists(admins, year, season, leagueType)))
        );
        if (match && a.name) names.push(a.name);
    });
    return names.sort();
}

// Rewrites the `directors` array on every League event in event_bundles so
// existing calendar events pick up current league admin assignments.
async function syncEventDirectors(statusEl) {
    const adminsSnap = await getDocs(collection(db, 'league_admins'));
    const admins = adminsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const bundlesSnap = await getDocs(collection(db, 'event_bundles'));
    let updated = 0;

    for (const docSnap of bundlesSnap.docs) {
        const monthId = docSnap.id;
        const [year, month] = monthId.split('-').map(Number);
        if (!year || !month) continue;
        const season = getSeasonFromMonth(month);

        const events = docSnap.data().events || [];
        for (const ev of events) {
            if (ev.category !== 'League' || !ev.leagueType) continue;
            const directors = leagueDirectorsFor(admins, year, season, ev.leagueType);
            const league = leagueAssignmentFor(admins, year, season, ev.leagueType);
            const sameLeague = JSON.stringify(ev.league || null) === JSON.stringify(league || null);
            if (JSON.stringify(ev.directors || []) === JSON.stringify(directors) && sameLeague) continue;

            const next = { ...ev, directors };
            if (league) next.league = league; else delete next.league;

            const ref = doc(db, 'event_bundles', monthId);
            await setDoc(ref, { events: arrayRemove(ev) }, { merge: true });
            await setDoc(ref, { events: arrayUnion(next) }, { merge: true });
            delete eventCache[monthId];
            clearDocCache('event_bundles', monthId);
            updated++;
        }
    }

    if (statusEl) statusEl.textContent = `Synced directors on ${updated} event${updated === 1 ? '' : 's'}.`;
}

/**
 * League Admin Manager
 * Add/remove league admins from the 'league_admins' collection.
 */
function initLeagueAdminManager() {
    const form = document.getElementById('league-admin-form');
    const list = document.getElementById('league-admin-list');
    if (!form || !list) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-league-admin');
        if (submitBtn) submitBtn.disabled = true;

        const email = document.getElementById('league-admin-email').value.trim();
        const year = document.getElementById('league-admin-year').value;
        const season = document.getElementById('league-admin-season').value;
        const leagueType = document.getElementById('league-admin-type').value;
        const name = document.getElementById('league-admin-name').value.trim();

        try {
            const cleanEmail = email.toLowerCase();
            const leagueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const newLeague = {
                id: leagueId,
                year: parseInt(year, 10) || year,
                season,
                leagueType,
                createdAt: new Date().toISOString()
            };

            // Drop any existing assignment for the same league so re-adding
            // updates it (e.g. to set the director name) instead of duplicating.
            const adminRef = doc(db, "league_admins", cleanEmail);
            const existingSnap = await getDoc(adminRef);
            const kept = (existingSnap.exists() ? existingSnap.data().leagues || [] : [])
                .filter(l => !(String(l.year) === String(newLeague.year) && l.season === season && l.leagueType === leagueType));

            const payload = { email, leagues: [...kept, newLeague] };
            if (name) payload.name = name;
            await setDoc(adminRef, payload, { merge: true });

            alert(`League added for ${email}`);
            form.reset();
            loadLeagueAdmins();
        } catch (error) {
            console.error("Error adding league:", error);
            alert("Error adding league.");
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };

    async function loadLeagueAdmins() {
        list.innerHTML = '';
        try {
            const snap = await getDocs(collection(db, "league_admins"));
            if (snap.empty) {
                list.innerHTML = '<p style="opacity:0.5; text-align:center;">No league admins found.</p>';
                return;
            }

            snap.docs.forEach(d => {
                const data = d.data();
                const leagues = data.leagues || [];

                const adminItem = document.createElement('div');
                adminItem.className = 'admin-event-item';
                adminItem.style.flexDirection = 'column';
                adminItem.style.alignItems = 'stretch';
                adminItem.style.justifyContent = 'flex-start';
                adminItem.style.gap = '0.5rem';

                const leaguesHtml = leagues.length === 0
                    ? '<p style="opacity:0.5; font-size:0.8rem; margin:0;">No leagues assigned.</p>'
                    : leagues.map(l => `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
                            <span style="font-size:0.85rem; min-width:0;">${l.year} • ${l.season} • ${l.leagueType}</span>
                            <button type="button" class="btn-delete" style="width:120px;" data-email="${data.email || d.id}" data-league='${JSON.stringify(l)}'>Remove</button>
                        </div>
                    `).join('');

                adminItem.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
                        <strong style="color: var(--accent-color); overflow-wrap: break-word; min-width:0;">${data.name ? `${data.name} — ` : ''}${data.email || d.id}</strong>
                        <button type="button" class="btn-delete" style="width:120px;" data-admin-id="${d.id}">Remove Admin</button>
                    </div>
                    ${leaguesHtml}
                `;
                list.appendChild(adminItem);
            });

            list.querySelectorAll('[data-admin-id]').forEach(btn => {
                btn.onclick = async () => {
                    const adminId = btn.dataset.adminId;
                    if (!confirm(`Remove ${adminId} as a league admin entirely? This deletes all their assigned leagues.`)) return;
                    try {
                        await deleteDoc(doc(db, "league_admins", adminId));
                        loadLeagueAdmins();
                    } catch (error) {
                        console.error("Error removing league admin:", error);
                        alert("Error removing league admin.");
                    }
                };
            });

            list.querySelectorAll('[data-league]').forEach(btn => {
                btn.onclick = async () => {
                    const email = btn.dataset.email;
                    const league = JSON.parse(btn.dataset.league);
                    if (!confirm(`Remove ${league.year} ${league.season} ${league.leagueType} for ${email}?`)) return;
                    try {
                        await updateDoc(doc(db, "league_admins", email.toLowerCase()), {
                            leagues: arrayRemove(league)
                        });
                        loadLeagueAdmins();
                    } catch (error) {
                        console.error("Error removing league:", error);
                        alert("Error removing league.");
                    }
                };
            });
        } catch (error) {
            console.error("Error loading league admins:", error);
            list.innerHTML = '<p style="color: #e74c3c; text-align:center;">Unable to load league admins.</p>';
        }
    }

    const syncBtn = document.getElementById('sync-directors-btn');
    const syncStatus = document.getElementById('sync-directors-status');
    if (syncBtn) {
        syncBtn.onclick = async () => {
            syncBtn.disabled = true;
            if (syncStatus) syncStatus.textContent = 'Syncing directors to calendar events...';
            try {
                await syncEventDirectors(syncStatus);
            } catch (error) {
                console.error('Error syncing directors:', error);
                if (syncStatus) syncStatus.textContent = 'Sync failed. See console for details.';
            } finally {
                syncBtn.disabled = false;
            }
        };
    }

    loadLeagueAdmins();
}

function initLeagueRoster() {
    const loadBtn = document.getElementById('load-league-roster');
    const list = document.getElementById('league-roster-list');
    const status = document.getElementById('league-roster-status');
    const lastLoaded = document.getElementById('league-roster-last-loaded');
    if (!loadBtn || !list || !status || !lastLoaded) return;

    function renderRoster(docs) {
        list.innerHTML = '';
        docs.forEach(p => {
            const item = document.createElement('div');
            item.className = 'admin-event-item';

            const current = p.currentRating ?? '';
            const hdcp = typeof p.hdcp === 'number' ? p.hdcp.toFixed(1) : (p.hdcp ?? '');
            const rounds = p.stats?.roundsPlayed ?? '';

            item.innerHTML = `
                <div class="admin-event-info">
                    <strong>${p.name}</strong>
                    <span style="display:block; font-size:0.75rem; opacity:0.6;">
                        Rating: ${current} • HDCP: ${hdcp} • Rounds: ${rounds}
                    </span>
                </div>
            `;
            list.appendChild(item);
        });
    }

    function updateLastLoaded(timestamp) {
        if (!timestamp) {
            lastLoaded.textContent = '';
            return;
        }
        const date = new Date(timestamp);
        lastLoaded.textContent = `Last updated: ${date.toLocaleString()}`;
    }

    async function loadRosterData(force = false) {
        loadBtn.disabled = true;
        status.textContent = 'Loading...';
        list.innerHTML = '';

        try {
            const result = await getRoster(force);
            if (!result || !result.roster) {
                status.textContent = 'No players found in the player database.';
                updateLastLoaded(null);
                return;
            }

            const { roster, source } = result;
            playersCache = roster;
            updateLastLoaded(roster.importedAt);
            status.textContent = `${roster.players.length} players loaded${source ? ` (${source})` : ''}.`;
            renderRoster(roster.players);
        } catch (error) {
            console.error('Roster load error:', error);
            status.textContent = `Error: ${error.message}`;
            alert('Failed to load roster. Check console for details.');
        } finally {
            loadBtn.disabled = false;
        }
    }

    loadBtn.onclick = () => loadRosterData(true);

    // Auto-load roster when admin page initializes (use cache, no Firestore read if local exists)
    loadRosterData(false);
}

/**
 * Free Round Allotments
 * Admins grant players N free league entries per season (shared across
 * league types). League Central auto-applies one at check-in and
 * decrements `used` when the round is finalized.
 * Doc shape: free_rounds/{playerSlug} = { name, seasons: { "2026Spring": { allotted, used } }, ace: { allotted, used } }
 * `ace` is a running balance of comped ace-pot entries — not seasonal,
 * and opt-in only (never auto-applied at check-in).
 */
function playerSlug(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function initFreeRoundsManager() {
    const form = document.getElementById('free-round-form');
    const list = document.getElementById('free-rounds-list');
    if (!form || !list) return;

    const nameInput = document.getElementById('fr-player');
    const yearInput = document.getElementById('fr-year');
    const seasonInput = document.getElementById('fr-season');
    const countInput = document.getElementById('fr-count');
    const suggestions = document.getElementById('fr-player-suggestions');
    const submitBtn = document.getElementById('submit-free-round');

    const aceForm = document.getElementById('free-ace-form');
    const aceNameInput = document.getElementById('fa-player');
    const aceCountInput = document.getElementById('fa-count');
    const aceSuggestions = document.getElementById('fa-player-suggestions');
    const aceSubmitBtn = document.getElementById('submit-free-ace');

    const listToggle = document.getElementById('free-rounds-toggle');
    const listToggleIcon = document.getElementById('free-rounds-toggle-icon');
    const listToggleCount = document.getElementById('free-rounds-toggle-count');
    if (listToggle) {
        listToggle.onclick = () => {
            const open = list.style.display !== 'none';
            list.style.display = open ? 'none' : '';
            if (listToggleIcon) listToggleIcon.textContent = open ? '+' : '−';
        };
    }

    const setDefaults = () => {
        const now = new Date();
        if (yearInput) yearInput.value = String(now.getFullYear());
        if (seasonInput) seasonInput.value = getSeasonFromMonth(now.getMonth() + 1);
    };
    setDefaults();

    // Autocomplete player names from the imported roster.
    let rosterNames = [];
    getRoster().then(result => {
        rosterNames = (result?.roster?.players || []).map(p => p.name);
    }).catch(() => {});

    const buildSuggestions = (inputEl, containerEl) => () => {
        if (!containerEl || !inputEl) return;
        const term = inputEl.value.toLowerCase().trim();
        const matches = term ? rosterNames.filter(n => n.toLowerCase().includes(term)).slice(0, 15) : [];
        containerEl.innerHTML = '';
        if (matches.length === 0) {
            containerEl.style.display = 'none';
            return;
        }
        matches.forEach(n => {
            const div = document.createElement('div');
            div.textContent = n;
            div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--glass-border);';
            div.onmousedown = (e) => {
                e.preventDefault();
                inputEl.value = n;
                containerEl.style.display = 'none';
            };
            div.onmouseenter = () => div.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))';
            div.onmouseleave = () => div.style.background = '';
            containerEl.appendChild(div);
        });
        containerEl.style.display = 'block';
    };

    const bindAutocomplete = (inputEl, containerEl) => {
        if (!inputEl || inputEl.dataset.bound) return;
        inputEl.dataset.bound = '1';
        const update = buildSuggestions(inputEl, containerEl);
        inputEl.addEventListener('input', update);
        inputEl.addEventListener('focus', update);
        inputEl.addEventListener('blur', () => {
            setTimeout(() => { if (containerEl) containerEl.style.display = 'none'; }, 150);
        });
    };

    bindAutocomplete(nameInput, suggestions);
    bindAutocomplete(aceNameInput, aceSuggestions);

    form.onsubmit = async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const year = yearInput.value.trim();
        const season = seasonInput.value;
        const count = parseInt(countInput.value, 10);
        if (!name || !year || !season || !(count > 0)) return;

        const pid = playerSlug(name);
        const seasonKey = `${year}${season}`;

        try {
            if (submitBtn) submitBtn.disabled = true;
            const ref = doc(db, 'free_rounds', pid);
            const snap = await getDoc(ref);
            const existingUsed = snap.exists() ? Number(snap.data().seasons?.[seasonKey]?.used) || 0 : 0;
            await setDoc(ref, {
                name,
                seasons: { [seasonKey]: { allotted: count, used: existingUsed } }
            }, { merge: true });
            alert(`Saved ${count} free rounds for ${name} (${year} ${season}).`);
            form.reset();
            setDefaults();
            loadFreeRounds();
        } catch (error) {
            console.error('Error saving free round allotment:', error);
            alert('Error saving free round allotment.');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };

    if (aceForm) {
        aceForm.onsubmit = async (e) => {
            e.preventDefault();
            const name = aceNameInput.value.trim();
            const count = parseInt(aceCountInput.value, 10);
            if (!name || !(count > 0)) return;

            const pid = playerSlug(name);
            try {
                if (aceSubmitBtn) aceSubmitBtn.disabled = true;
                const ref = doc(db, 'free_rounds', pid);
                const snap = await getDoc(ref);
                const existingUsed = snap.exists() ? Number(snap.data().ace?.used) || 0 : 0;
                await setDoc(ref, {
                    name,
                    ace: { allotted: count, used: existingUsed }
                }, { merge: true });
                alert(`Saved ${count} free ace entries for ${name}.`);
                aceForm.reset();
                loadFreeRounds();
            } catch (error) {
                console.error('Error saving free ace allotment:', error);
                alert('Error saving free ace allotment.');
            } finally {
                if (aceSubmitBtn) aceSubmitBtn.disabled = false;
            }
        };
    }

    async function loadFreeRounds() {
        try {
            const snap = await getDocs(collection(db, 'free_rounds'));
            const allotmentDocs = snap.docs.filter(d => {
                const data = d.data();
                return Object.keys(data.seasons || {}).length > 0 || data.ace;
            });
            if (listToggleCount) {
                listToggleCount.textContent = allotmentDocs.length ? `(${allotmentDocs.length})` : '';
            }
            if (allotmentDocs.length === 0) {
                list.innerHTML = '<p style="opacity:0.5; text-align:center;">No free round allotments.</p>';
                return;
            }

            list.innerHTML = '';
            allotmentDocs.forEach(d => {
                const data = d.data();
                const seasons = Object.entries(data.seasons || {});
                if (seasons.length === 0 && !data.ace) return;

                const item = document.createElement('div');
                item.className = 'admin-event-item';
                item.style.flexDirection = 'column';
                item.style.alignItems = 'stretch';
                item.style.justifyContent = 'flex-start';
                item.style.gap = '0.5rem';

                let rowsHtml = seasons
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([key, s]) => {
                        const m = key.match(/^(\d{4})(Winter|Spring|Summer|Fall)$/);
                        const label = m ? `${m[1]} ${m[2]}` : key;
                        return `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
                                <span style="font-size:0.85rem; min-width:0;">${label} — ${Number(s.used) || 0} of ${Number(s.allotted) || 0} used</span>
                                <button type="button" class="btn-delete" style="width:120px;" data-fr-pid="${d.id}" data-fr-season="${key}">Remove</button>
                            </div>`;
                    }).join('');

                if (data.ace) {
                    rowsHtml += `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
                            <span style="font-size:0.85rem; min-width:0;">Ace Pot — ${Number(data.ace.used) || 0} of ${Number(data.ace.allotted) || 0} used</span>
                            <button type="button" class="btn-delete" style="width:120px;" data-fr-pid="${d.id}" data-fr-ace="1">Remove</button>
                        </div>`;
                }

                item.innerHTML = `<strong style="color: var(--accent-color); overflow-wrap: break-word; min-width:0;">${data.name || d.id}</strong>${rowsHtml}`;
                list.appendChild(item);
            });

            if (list.innerHTML === '') {
                list.innerHTML = '<p style="opacity:0.5; text-align:center;">No free round allotments.</p>';
                return;
            }

            list.querySelectorAll('[data-fr-pid]').forEach(btn => {
                btn.onclick = async () => {
                    const pid = btn.dataset.frPid;
                    const seasonKey = btn.dataset.frSeason;
                    const isAce = btn.dataset.frAce === '1';
                    const label = isAce ? 'ace-pot credit balance' : `${seasonKey} free-round allotment`;
                    if (!confirm(`Remove the ${label} for this player?`)) return;
                    try {
                        await updateDoc(doc(db, 'free_rounds', pid), isAce
                            ? { ace: deleteField() }
                            : { [`seasons.${seasonKey}`]: deleteField() });
                        loadFreeRounds();
                    } catch (error) {
                        console.error('Error removing free round allotment:', error);
                        alert('Error removing allotment.');
                    }
                };
            });
        } catch (error) {
            console.error('Error loading free round allotments:', error);
            list.innerHTML = '<p style="color: #e74c3c; text-align:center;">Unable to load free round allotments.</p>';
        }
    }

    loadFreeRounds();
}

/**
 * Import the "BNDisc Ratings - Round Database.csv" file into Firestore.
 * Groups rows into round documents and builds player profile docs with history.
 */
function initRoundDatabaseImport() {
    const fileInput = document.getElementById('round-db-file');
    const importBtn = document.getElementById('import-round-db');
    const status = document.getElementById('round-db-status');
    const progress = document.getElementById('round-db-progress');
    if (!fileInput || !importBtn || !status || !progress) return;

    importBtn.onclick = async () => {
        const file = fileInput.files[0];
        if (!file) {
            alert('Please choose the Round Database CSV file.');
            return;
        }
        const currentUser = auth.currentUser;
        if (!currentUser || !(await isAdmin(currentUser.email))) {
            alert('Only club admins can import the round database.');
            return;
        }

        status.textContent = 'Reading file...';
        progress.textContent = '';
        importBtn.disabled = true;

        try {
            const csv = await file.text();
            const { rounds, players, roundCount, playerCount, skipped } = buildRoundDatabase(csv);
            status.textContent = `Parsed ${roundCount} rounds and ${playerCount} players (${skipped} skipped). Writing to Firestore...`;
            const counts = await writeRoundDatabase(rounds, players, (msg) => { progress.textContent = msg; });
            status.textContent = `Imported ${counts.roundCount} rounds and ${counts.playerCount} player profiles.`;
            alert(`Imported ${counts.roundCount} rounds and ${counts.playerCount} players.`);
        } catch (error) {
            console.error('Round database import failed:', error);
            status.textContent = `Error: ${error.message}`;
            alert('Import failed. Check console for details.');
        } finally {
            importBtn.disabled = false;
        }
    };
}

function buildRoundDatabase(csv) {
    const lines = csv.split(/\r?\n/).filter(line => line.trim());

    const headerIndex = lines.findIndex(line => {
        const first = parseCsvRow(line)[0] || '';
        return first.toLowerCase().includes('player') && first.toLowerCase().includes('name');
    });

    if (headerIndex === -1) {
        throw new Error('Could not find "Player Name" header in CSV.');
    }

    const dataLines = lines.slice(headerIndex + 1);
    const rounds = {};
    const playersById = {};
    const playerInitialRatings = {};
    const playerNames = {};
    const playerRounds = {};
    const seen = new Set();
    let skipped = 0;

    function normalizeForMatch(str) {
        return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function slug(str) {
        return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function playerId(name) {
        return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function parseDate(str) {
        const parts = String(str).trim().split('/');
        if (parts.length !== 3) return null;
        const [m, d, y] = parts.map(Number);
        if (!m || !d || !y) return null;
        const dt = new Date(y, m - 1, d);
        if (Number.isNaN(dt.getTime())) return null;
        return dt.toISOString().split('T')[0];
    }

    function parseNumber(str) {
        if (!str || String(str).trim().toUpperCase() === 'N/A') return null;
        const cleaned = String(str).replace(/,/g, '').trim();
        const n = parseInt(cleaned, 10);
        return Number.isNaN(n) ? null : n;
    }

    function mapCourse(loc) {
        const n = normalizeForMatch(loc);
        for (const [storage, display] of Object.entries(COURSE_NAME_OVERRIDES)) {
            if (n === normalizeForMatch(storage) || n === normalizeForMatch(display)) {
                return storage;
            }
        }
        for (const name of LOCATIONS) {
            if (n === normalizeForMatch(name)) return name;
        }
        return loc.trim();
    }

    function calculateCurrentRating(history) {
        const sorted = history.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.roundId || '').localeCompare(b.roundId || ''));
        const latest5 = sorted.slice(-5).filter(r => typeof r.rating === 'number');
        const previous10 = sorted.slice(-15, -5).filter(r => typeof r.rating === 'number');
        const denominator = latest5.length * 2 + previous10.length;
        if (denominator === 0) return null;
        const weighted = latest5.reduce((sum, r) => sum + r.rating * 2, 0)
                       + previous10.reduce((sum, r) => sum + r.rating, 0);
        return Math.ceil(weighted / denominator);
    }

    for (const line of dataLines) {
        const cells = parseCsvRow(line);
        if (cells.length < 6) continue;
        if (!cells[0].trim() || cells[0].startsWith('Maximum') || cells[0].startsWith('Last Round')) {
            skipped++;
            continue;
        }

        const name = cells[0].trim();
        const dateStr = cells[1].trim();
        const loc = cells[2].trim();
        const layout = cells[3].trim();
        const score = parseNumber(cells[4]);
        const rating = parseNumber(cells[5]);
        const pid = playerId(name);
        if (!pid) continue;

        playerNames[pid] = name;

        const locLower = loc.toLowerCase();

        if (locLower === 'initial rating') {
            if (rating !== null && !(pid in playerInitialRatings)) {
                playerInitialRatings[pid] = rating;
            }
            continue;
        }

        if (locLower === 'unknown' || layout.toUpperCase() === 'N/A' || score === null || rating === null) {
            skipped++;
            continue;
        }

        const course = mapCourse(loc);
        const date = parseDate(dateStr);
        if (!date) {
            skipped++;
            continue;
        }

        const groupKey = `${date}|${course}|${layout}`;
        const occurrences = (playerRounds[pid] || []).filter(r => r.groupKey === groupKey).length;
        let roundId = `${date}_${slug(course)}_${slug(layout)}`;
        if (occurrences > 0) {
            roundId += `_occ${occurrences}`;
        }

        const dedupKey = `${pid}|${date}|${course}|${layout}|${occurrences}|${score}|${rating}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const entry = {
            pid, name, date, course, layout, score, rating, roundId, groupKey
        };

        playerRounds[pid] = playerRounds[pid] || [];
        playerRounds[pid].push(entry);

        if (!rounds[roundId]) {
            rounds[roundId] = {
                date,
                course,
                layout,
                courseDisplay: getCourseDisplayName(course),
                scores: {},
                playerIds: new Set()
            };
        }
        rounds[roundId].scores[pid] = { name, score, rating };
        rounds[roundId].playerIds.add(pid);
    }

    for (const pid of new Set([...Object.keys(playerRounds), ...Object.keys(playerInitialRatings)])) {
        const entries = (playerRounds[pid] || []).slice();
        entries.sort((a, b) => a.date.localeCompare(b.date) || a.roundId.localeCompare(b.roundId));

        const history = entries.map(e => ({
            roundId: e.roundId,
            date: e.date,
            course: e.course,
            courseDisplay: getCourseDisplayName(e.course),
            layout: e.layout,
            score: e.score,
            rating: e.rating
        }));

        const scores = entries.map(e => e.score).filter(n => n !== null);
        const ratings = entries.map(e => e.rating).filter(n => n !== null);
        const initialRating = playerInitialRatings[pid] || (history.length ? history[0].rating : null);
        const currentRating = calculateCurrentRating(history) ?? (ratings.length ? ratings[ratings.length - 1] : initialRating);

        playersById[pid] = {
            playerId: pid,
            name: playerNames[pid] || pid,
            initialRating,
            currentRating,
            stats: {
                roundsPlayed: entries.length,
                averageScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null,
                bestScore: scores.length ? Math.min(...scores) : null,
                averageRating: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null,
                bestRating: ratings.length ? Math.max(...ratings) : null
            },
            history
        };
    }

    const roundDocs = {};
    for (const [roundId, data] of Object.entries(rounds)) {
        roundDocs[roundId] = {
            date: data.date,
            course: data.course,
            courseDisplay: data.courseDisplay,
            layout: data.layout,
            playerIds: Array.from(data.playerIds).sort(),
            scores: data.scores
        };
    }

    return {
        rounds: roundDocs,
        players: playersById,
        roundCount: Object.keys(roundDocs).length,
        playerCount: Object.keys(playersById).length,
        skipped
    };
}

async function writeRoundDatabase(rounds, players, onProgress) {
    let batch = writeBatch(db);
    let count = 0;
    let total = 0;
    let roundCount = 0;
    let playerCount = 0;

    async function commitBatch() {
        if (count === 0) return;
        await batch.commit();
        total += count;
        if (onProgress) onProgress(`Wrote ${total} documents...`);
        batch = writeBatch(db);
        count = 0;
    }

    for (const [roundId, data] of Object.entries(rounds)) {
        batch.set(doc(db, 'rounds', roundId), data);
        count++;
        roundCount++;
        if (count >= 450) await commitBatch();
    }

    for (const [pid, data] of Object.entries(players)) {
        batch.set(doc(db, 'players', pid), data);
        count++;
        playerCount++;
        if (count >= 450) await commitBatch();
    }

    await commitBatch();
    return { roundCount, playerCount, total };
}

function parseRosterNames(csv) {
    const lines = csv.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];

    const header = parseCsvRow(lines[0]).map(h => h.trim().toLowerCase());
    const nameIndex = header.findIndex(h => h.includes('name'));
    const idx = nameIndex >= 0 ? nameIndex : 0;

    return lines.slice(1).map(line => {
        const cells = parseCsvRow(line);
        return cells[idx] ? cells[idx].trim() : '';
    }).filter(n => n);
}

function parsePlayerRows(csv) {
    const lines = csv.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];

    return lines.slice(1).map(line => {
        const cells = parseCsvRow(line);
        const name = (cells[0] || '').trim();
        if (!name) return null;

        const docId = name.toLowerCase().replace(/\//g, '-');
        const currentRating = parseInt(cells[1], 10);
        const hdcp = parseFloat(cells[2]);
        const speed = parseFloat(cells[3]);
        const totalRoundCount = parseInt(cells[4], 10);

        return {
            docId,
            data: {
                name,
                currentRating: Number.isNaN(currentRating) ? (cells[1] || 0) : currentRating,
                hdcp: Number.isNaN(hdcp) ? (cells[2] || 0) : hdcp,
                speed: Number.isNaN(speed) ? (cells[3] || 0) : speed,
                totalRoundCount: Number.isNaN(totalRoundCount) ? (cells[4] || 0) : totalRoundCount,
                importedAt: new Date().toISOString()
            }
        };
    }).filter(p => p);
}

function parseCsvRow(row) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

/**
 * Convert the stacked admin dashboard cards into a tabbed interface.
 */
function setupAdminTabs() {
    const adminContent = document.getElementById('admin-content');
    if (!adminContent || adminContent.dataset.tabsSetup) return;
    adminContent.dataset.tabsSetup = 'true';

    const hr = adminContent.querySelector('hr.course-divider');
    if (!hr) return;
    hr.style.display = 'none';

    const tabsNav = document.createElement('div');
    tabsNav.className = 'admin-tabs';
    tabsNav.id = 'admin-tabs';

    const panelsContainer = document.createElement('div');
    panelsContainer.className = 'admin-tab-panels';

    hr.after(tabsNav);
    tabsNav.after(panelsContainer);

    const cards = [];
    const gridsToRemove = [];

    Array.from(adminContent.children).forEach(child => {
        if (child === tabsNav || child === panelsContainer) return;
        if (child.classList.contains('admin-grid-wide') || child.classList.contains('admin-card')) {
            cards.push(child);
        } else if (child.classList.contains('admin-grid')) {
            Array.from(child.children).forEach(inner => {
                if (inner.classList.contains('admin-grid-wide') || inner.classList.contains('admin-card')) {
                    cards.push(inner);
                }
            });
            gridsToRemove.push(child);
        }
    });

    gridsToRemove.forEach(grid => grid.remove());

    const fragment = document.createDocumentFragment();
    cards.forEach((card, i) => {
        const h3 = card.querySelector('h3');
        const title = h3 ? h3.textContent.trim() : `Tab ${i + 1}`;

        const panel = document.createElement('div');
        panel.className = 'admin-tab-panel';
        panel.id = `admin-tab-panel-${i}`;
        card.style.marginTop = '';
        panel.appendChild(card);
        fragment.appendChild(panel);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-tab-btn';
        btn.textContent = title;
        btn.dataset.panel = panel.id;
        btn.addEventListener('click', () => {
            panelsContainer.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
            tabsNav.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
            panel.classList.add('active');
            btn.classList.add('active');
        });
        tabsNav.appendChild(btn);
    });

    panelsContainer.appendChild(fragment);

    if (tabsNav.firstElementChild) {
        tabsNav.firstElementChild.click();
    }
}
/**
 * ELECTIONS & VOTING
 * Creates elections, issues one unguessable ballot link per member email,
 * exports link CSVs for the email blast, and tallies anonymous votes.
 * Votes live at votes/{sha256(token)} — tally validates each vote by hashing
 * issued ballot tokens, so a stored vote can't be tied back to an email.
 */
function initElections() {
    const newBtn = document.getElementById('election-new-btn');
    const createBox = document.getElementById('election-create');
    const createForm = document.getElementById('election-create-form');
    // Bylaw amendment type: swap the positions editor for a section picker.
    const typeSelect = document.getElementById('election-type');
    const posWrap = document.getElementById('election-positions-wrap');
    const amWrap = document.getElementById('election-amendments-wrap');
    const bylawSelect = document.getElementById('election-bylaw-section');
    const amBox = document.getElementById('election-amendments');
    const addAmBtn = document.getElementById('election-add-amendment');
    if (typeSelect && posWrap && amWrap) {
        typeSelect.onchange = async () => {
            const showAmend = typeSelect.value !== 'positions';
            posWrap.style.display = typeSelect.value === 'bylaws' ? 'none' : '';
            amWrap.style.display = showAmend ? '' : 'none';
            if (showAmend && bylawSelect && !bylawSelect.dataset.loaded) {
                bylawSelect.dataset.loaded = 'true';
                bylawSelect.innerHTML = '<option value="">Loading sections…</option>';
                try {
                    const secs = await getBylawSections();
                    bylawSelect.innerHTML = '<option value="">Select a section…</option>' +
                        secs.map((s, i) => `<option value="${i}">${escapeHtml(s.ref)} — ${escapeHtml(s.title)}</option>`).join('');
                } catch (e) {
                    bylawSelect.innerHTML = '<option value="">Could not load bylaws</option>';
                }
            }
        };
    }
    if (addAmBtn && bylawSelect && amBox) {
        addAmBtn.onclick = async () => {
            let secs;
            try { secs = await getBylawSections(); } catch (e) { return; }
            const s = secs[Number(bylawSelect.value)];
            if (!s || amBox.querySelector(`[data-ref="${CSS.escape(s.ref)}"]`)) return;
            const row = document.createElement('div');
            row.className = 'election-position-row am-row';
            row.dataset.ref = s.ref;
            row.dataset.currentText = s.text;
            row.style.cssText = 'border:1px solid var(--glass-border); border-radius:8px; padding:0.6rem; margin-bottom:0.5rem;';
            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                    <strong style="font-size:0.85rem;">${escapeHtml(s.ref)}</strong>
                    <button type="button" class="ep-remove btn-primary" style="margin-top:0; padding:0.15rem 0.6rem;">✕</button>
                </div>
                <div style="font-size:0.8rem; opacity:0.6; margin-bottom:0.4rem;">${escapeHtml(s.text.slice(0, 140))}${s.text.length > 140 ? '…' : ''}</div>
                <textarea class="am-proposed" rows="2" placeholder="Proposed amendment — what changes and how…" style="width:100%;"></textarea>`;
            row.querySelector('.ep-remove').onclick = () => row.remove();
            amBox.appendChild(row);
        };
    }

    const addPosBtn = document.getElementById('election-add-position');
    const positionsBox = document.getElementById('election-positions');
    if (!newBtn || !createBox || !createForm || !positionsBox) return;

    const clientIdInput = document.getElementById('gmail-client-id');
    if (clientIdInput && !clientIdInput.dataset.bound) {
        clientIdInput.dataset.bound = 'true';
        const senderInput = document.getElementById('gmail-sender-email');
        const saveGmailSettings = () => {
            // Persist to Firestore so the setup survives across devices and
            // admins; localStorage mirrors it for the token helpers.
            setDoc(doc(db, 'settings', GMAIL_SETTINGS_DOC), {
                clientId: clientIdInput.value.trim(),
                allowedSender: (senderInput?.value || '').trim()
            }, { merge: true }).catch(e => console.warn('Could not save Gmail settings:', e));
        };
        clientIdInput.onchange = () => {
            localStorage.setItem(GMAIL_CLIENT_ID_KEY, clientIdInput.value.trim());
            gmailToken = null;
            gmailEmail = '';
            saveGmailSettings();
            updateGmailStatus();
        };
        if (senderInput) {
            senderInput.onchange = () => {
                localStorage.setItem(GMAIL_SENDER_KEY, senderInput.value.trim());
                gmailToken = null;
                gmailEmail = '';
                saveGmailSettings();
                updateGmailStatus();
            };
        }

        // Hydrate from Firestore on first load (falls back to localStorage).
        clientIdInput.value = localStorage.getItem(GMAIL_CLIENT_ID_KEY) || '';
        if (senderInput) senderInput.value = localStorage.getItem(GMAIL_SENDER_KEY) || '';
        getDoc(doc(db, 'settings', GMAIL_SETTINGS_DOC)).then(snap => {
            if (!snap.exists()) return;
            const s = snap.data();
            if (s.clientId) {
                clientIdInput.value = s.clientId;
                localStorage.setItem(GMAIL_CLIENT_ID_KEY, s.clientId);
            }
            if (s.allowedSender && senderInput) {
                senderInput.value = s.allowedSender;
                localStorage.setItem(GMAIL_SENDER_KEY, s.allowedSender);
            }
            updateGmailStatus();
        }).catch(e => console.warn('Could not load Gmail settings:', e))
        .finally(() => {
            // Silent reconnect: if the Google session still holds the
            // gmail.send grant, restore the connection without a popup.
            ensureGmailToken(true).catch(() => { /* stay disconnected */ });
        });
        const connectBtn = document.getElementById('gmail-connect');
        if (connectBtn) {
            connectBtn.onclick = async () => {
                const status = document.getElementById('gmail-status');
                if (status) status.textContent = 'Connecting…';
                try {
                    // Try fully silent first (hint preselects the club
                    // account); only pop the chooser if silent fails.
                    await ensureGmailToken(true);
                } catch (silentErr) {
                    try {
                        await ensureGmailToken();
                    } catch (e) {
                        if (status) status.textContent = `Gmail: ${e.message}`;
                    }
                }
                updateGmailStatus();
            };
        }
        updateGmailStatus();
    }

    const addPositionRow = () => {
        const row = document.createElement('div');
        row.className = 'election-position-row';
        row.style.cssText = 'border: 1px solid var(--glass-border); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem;';
        row.innerHTML = `
            <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                <input type="text" class="ep-title" placeholder="Position (e.g., President)" style="flex: 1;">
                <input type="number" class="ep-max" min="1" value="1" title="Max choices" style="width: 4.5rem;">
                <button type="button" class="ep-remove" style="padding: 0 0.6rem; border-radius: 6px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-color); cursor: pointer; line-height: 1.2;">×</button>
            </div>
            <textarea class="ep-candidates" rows="3" placeholder="One candidate per line" style="width: 100%;"></textarea>
        `;
        row.querySelector('.ep-remove').onclick = () => row.remove();
        positionsBox.appendChild(row);
    };

    newBtn.onclick = () => {
        const show = createBox.style.display !== 'block';
        createBox.style.display = show ? 'block' : 'none';
        if (show && !positionsBox.children.length) addPositionRow();
    };
    if (addPosBtn) addPosBtn.onclick = addPositionRow;

    createForm.onsubmit = async (e) => {
        e.preventDefault();
        const title = document.getElementById('election-title-input').value.trim();
        const closesRaw = document.getElementById('election-closes-input').value;
        if (!title || !closesRaw) return;

        const electionType = typeSelect?.value || 'positions';
        const collectPositions = () => [...positionsBox.querySelectorAll('.election-position-row')].map(row => ({
            title: row.querySelector('.ep-title').value.trim(),
            maxChoices: Math.max(1, Number(row.querySelector('.ep-max').value) || 1),
            candidates: row.querySelector('.ep-candidates').value.split('\n').map(s => s.trim()).filter(Boolean)
        })).filter(p => p.title && p.candidates.length > 0);
        const collectAmendments = () => [...(amBox?.querySelectorAll('.am-row') || [])].map(row => ({
            title: `Amend ${row.dataset.ref}`,
            currentText: row.dataset.currentText || '',
            description: row.querySelector('.am-proposed').value.trim(),
            maxChoices: 1,
            candidates: ['Yes', 'No']
        })).filter(p => p.description);
        const positions = electionType === 'mixed'
            ? [...collectPositions(), ...collectAmendments()]
            : electionType === 'bylaws' ? collectAmendments() : collectPositions();
        if (!positions.length) {
            alert(electionType === 'positions'
                ? 'Add at least one position with at least one candidate.'
                : 'Add at least one bylaw section and describe the proposed amendment.');
            return;
        }

        const submitBtn = document.getElementById('election-create-submit');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }
        try {
            await addDoc(collection(db, 'elections'), {
                title,
                type: electionType,
                positions,
                open: true,
                navVisible: true,
                closesAt: Timestamp.fromDate(new Date(closesRaw)),
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.email || 'unknown'
            });
            createForm.reset();
            positionsBox.innerHTML = '';
            if (amBox) amBox.innerHTML = '';
            if (posWrap && amWrap) { posWrap.style.display = ''; amWrap.style.display = 'none'; }
            createBox.style.display = 'none';
            await loadElections();
            updateVoteNavLink(true);
        } catch (err) {
            console.error('Create election failed:', err);
            alert('Could not create election. Check permissions.');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Election'; }
        }
    };

    loadElections();
}

async function loadElections() {
    const list = document.getElementById('elections-list');
    if (!list) return;
    list.innerHTML = '<p style="opacity:0.5; text-align:center;">Loading elections...</p>';
    try {
        const snap = await getDocs(collection(db, 'elections'));
        const elections = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        elections.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        list.innerHTML = elections.length ? '' : '<p style="opacity:0.5; text-align:center;">No elections yet.</p>';
        elections.forEach(el => renderElectionItem(el, list));
    } catch (e) {
        console.error('Load elections failed:', e);
        list.innerHTML = '<p style="opacity:0.5; text-align:center;">Could not load elections.</p>';
    }
}

function renderElectionItem(election, list) {
    const item = document.createElement('div');
    item.className = 'admin-event-item';
    item.style.cssText = 'padding: 1rem;';

    const closes = election.closesAt?.toDate?.();
    const pastClose = closes && closes.getTime() <= Date.now();
    const isOpen = election.open !== false && !pastClose;
    const stateLabel = election.open === false ? 'Closed' : (pastClose ? 'Ended' : 'Open');
    const stateColor = isOpen ? '#22c55e' : '#f59e0b';

    const info = document.createElement('div');
    info.className = 'admin-event-info';
    const strong = document.createElement('strong');
    strong.textContent = election.title || 'Untitled Election';
    const meta = document.createElement('span');
    meta.style.cssText = 'display:block; font-size:0.75rem; opacity:0.6;';
    const typeTag = { bylaws: 'Bylaws · ', mixed: 'Mixed · ' }[election.type] || '';
    meta.textContent = `${typeTag}closes ${closes ? closes.toLocaleString() : '—'}`;
    const badge = document.createElement('span');
    badge.style.cssText = `color:${stateColor}; font-weight:600;`;
    badge.textContent = ` ● ${stateLabel}`;
    meta.appendChild(badge);
    info.appendChild(strong);
    info.appendChild(meta);

    const manageBtn = document.createElement('button');
    manageBtn.type = 'button';
    manageBtn.className = 'btn-primary';
    manageBtn.style.marginTop = '0';
    manageBtn.textContent = 'Manage';

    const details = document.createElement('div');
    details.className = 'admin-form';
    details.style.cssText = 'display:none; margin-top:0.75rem; border-top:1px solid var(--glass-border); padding-top:0.75rem;';
    details.innerHTML = `
        <div class="el-turnout" style="font-size:0.85rem; opacity:0.8; margin-bottom:0.5rem;">Turnout: loading...</div>
        <label style="display:flex; gap:0.5rem; align-items:center; font-size:0.85rem; margin-bottom:0.6rem; cursor:pointer;">
            <input type="checkbox" class="el-navcheck" style="width:auto; margin-top:0; flex-shrink:0;" ${election.navVisible === false ? '' : 'checked'}>
            <span>Show Vote link in nav</span>
        </label>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.5rem;">
            <button type="button" class="btn-primary el-toggle-open" style="flex:1; margin-top:0;">${election.open === false ? 'Re-open Voting' : 'Close Voting'}</button>
            <button type="button" class="btn-primary el-send-remind" style="flex:1; margin-top:0;">Send Reminders (unused)</button>
        </div>
        <div class="el-send-status" style="font-size:0.85rem; margin-bottom:0.6rem;"></div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.75rem;">
            <button type="button" class="btn-primary el-tally" style="flex:1; margin-top:0;">Tally</button>
            <button type="button" class="btn-primary el-delete" style="flex:1; margin-top:0; background:#d32f2f;">Delete</button>
        </div>
        <label style="font-size:0.85rem; opacity:0.8; display:block; margin-bottom:0.25rem;">Member emails (one per line) — generates links and emails the blast</label>
        <textarea class="el-emails" rows="4" placeholder="member1@example.com&#10;member2@example.com" style="width:100%; margin-bottom:0.5rem;"></textarea>
        <button type="button" class="btn-primary el-generate" style="width:100%; margin-top:0;">Generate &amp; Send Links</button>
        <div class="el-gen-status" style="font-size:0.85rem; margin-top:0.4rem;"></div>
        <div class="el-results" style="margin-top:0.75rem;"></div>
    `;

    item.appendChild(info);
    item.appendChild(manageBtn);
    item.appendChild(details);
    item.style.flexDirection = 'column';
    item.style.alignItems = 'stretch';
    info.style.marginBottom = '0.5rem';
    manageBtn.style.alignSelf = 'flex-start';

    const fetchBallots = async () => {
        const snap = await getDocs(query(collection(db, 'ballots'), where('electionId', '==', election.id)));
        return snap.docs;
    };

    const loadTurnout = async () => {
        const turnoutEl = details.querySelector('.el-turnout');
        try {
            const docs = await fetchBallots();
            const used = docs.filter(d => d.data().used).length;
            const sent = docs.filter(d => d.data().sentAt).length;
            turnoutEl.textContent = `Ballots: ${docs.length} issued · ${sent} emailed · ${used} voted`;
            return docs;
        } catch (e) {
            console.error('Ballot load failed:', e);
            turnoutEl.textContent = 'Could not load ballots.';
            return [];
        }
    };

    manageBtn.onclick = () => {
        const show = details.style.display === 'none';
        details.style.display = show ? 'block' : 'none';
        if (show) loadTurnout();
    };

    details.querySelector('.el-navcheck').onchange = async (e) => {
        try {
            await updateDoc(doc(db, 'elections', election.id), { navVisible: e.target.checked });
            updateVoteNavLink(true);
        } catch (err) {
            console.error('navVisible update failed:', err);
            e.target.checked = !e.target.checked;
        }
    };

    details.querySelector('.el-toggle-open').onclick = async () => {
        try {
            await updateDoc(doc(db, 'elections', election.id), { open: election.open === false });
            await loadElections();
            updateVoteNavLink(true);
        } catch (err) {
            console.error('Toggle open failed:', err);
            alert('Could not update the election.');
        }
    };

    const sendStatus = details.querySelector('.el-send-status');
    const sendTo = async (filterFn, label) => {
        const docs = await fetchBallots();
        const targets = docs.filter(d => filterFn(d.data()));
        if (!targets.length) { sendStatus.textContent = `No ${label} ballots.`; return; }
        try {
            await ensureGmailToken();
        } catch (e) {
            sendStatus.textContent = `Gmail: ${e.message}`;
            return;
        }
        const closesStr = closes ? closes.toLocaleString() : '';
        let sent = 0;
        const failed = [];
        sendStatus.textContent = `Sending ${label} 0/${targets.length}…`;
        for (const d of targets) {
            const b = d.data();
            try {
                await sendBallotEmail(b.email, makeVoteLink(d.id), election, closesStr);
                await updateDoc(d.ref, { sentAt: serverTimestamp() });
                sent++;
                sendStatus.textContent = `Sending ${label} ${sent}/${targets.length}…`;
                await new Promise(r => setTimeout(r, 250)); // stay under send quota
            } catch (e) {
                if (e.status === 401 || e.status === 403) {
                    gmailToken = null;
                    try {
                        await ensureGmailToken();
                        await sendBallotEmail(b.email, makeVoteLink(d.id), election, closesStr);
                        await updateDoc(d.ref, { sentAt: serverTimestamp() });
                        sent++;
                        continue;
                    } catch (retryErr) { failed.push(`${b.email} (${retryErr.message})`); continue; }
                }
                failed.push(`${b.email} (${e.message})`);
            }
        }
        sendStatus.textContent = `Sent ${sent}/${targets.length} ${label}` +
            (failed.length ? ` — failed: ${failed.join(', ')}` : '');
        await loadTurnout();
    };
    details.querySelector('.el-send-remind').onclick = () => sendTo(b => b.sentAt && !b.used, 'reminders');

    details.querySelector('.el-generate').onclick = async () => {
        const genStatus = details.querySelector('.el-gen-status');
        const emails = [...new Set(
            details.querySelector('.el-emails').value
                .split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@'))
        )];
        if (!emails.length) { genStatus.textContent = 'Paste member emails first.'; return; }

        const btn = details.querySelector('.el-generate');
        btn.disabled = true;
        genStatus.textContent = 'Generating ballots...';
        try {
            const existing = await fetchBallots();
            const existingEmails = new Set(existing.map(d => (d.data().email || '').toLowerCase()));
            const fresh = emails.filter(em => !existingEmails.has(em));

            for (let i = 0; i < fresh.length; i += 450) {
                const batch = writeBatch(db);
                fresh.slice(i, i + 450).forEach(email => {
                    batch.set(doc(db, 'ballots', makeBallotToken()), {
                        electionId: election.id,
                        email,
                        used: false,
                        usedAt: null,
                        createdAt: serverTimestamp()
                    });
                });
                await batch.commit();
            }

            genStatus.textContent = `${fresh.length} ballot link${fresh.length === 1 ? '' : 's'} generated` +
                (emails.length - fresh.length ? ` (${emails.length - fresh.length} already existed)` : '') +
                ' — sending blast…';
            await loadTurnout();
            // Send to everything still unsent (new links plus earlier failures).
            await sendTo(b => !b.sentAt, 'blast');
        } catch (err) {
            console.error('Ballot generation failed:', err);
            genStatus.textContent = 'Could not generate ballots. Check permissions.';
        } finally {
            btn.disabled = false;
        }
    };

    details.querySelector('.el-tally').onclick = async () => {
        const results = details.querySelector('.el-results');
        results.textContent = 'Counting votes...';
        try {
            const docs = await fetchBallots();
            const positions = election.positions || [];
            const counts = positions.map(() => ({}));
            const abstains = positions.map(() => 0);
            let validVotes = 0;
            let usedCount = 0;

            for (const d of docs) {
                if (d.data().used) usedCount++;
                const hash = await sha256Hex(d.id);
                const voteSnap = await getDoc(doc(db, 'votes', hash));
                if (!voteSnap.exists() || voteSnap.data().electionId !== election.id) continue;
                validVotes++;
                const sel = voteSnap.data().selections || [];
                positions.forEach((p, pi) => {
                    const picks = Array.isArray(sel[pi]) ? sel[pi] : [];
                    if (!picks.length) abstains[pi]++;
                    picks.forEach(ci => { counts[pi][ci] = (counts[pi][ci] || 0) + 1; });
                });
            }

            let html = `<div style="font-size:0.85rem; opacity:0.8; margin-bottom:0.5rem;">` +
                `${docs.length} ballots issued · ${usedCount} marked used · ${validVotes} valid votes counted` +
                (usedCount > validVotes ? ` · ${usedCount - validVotes} spoiled` : '') + `</div>`;
            positions.forEach((p, pi) => {
                const entries = (p.candidates || []).map((cand, ci) => ({ cand, n: counts[pi][ci] || 0 }));
                const top = Math.max(...entries.map(e => e.n), 0);
                html += `<div style="margin-bottom:0.75rem;"><strong>${escapeHtml(p.title)}</strong>` +
                    ` <span style="opacity:0.6; font-size:0.8rem;">(${abstains[pi]} abstain)</span><ul style="margin:0.25rem 0 0; padding-left:1.2rem;">` +
                    entries.map(e => `<li style="${e.n === top && top > 0 ? 'color:#22c55e; font-weight:600;' : ''}">${escapeHtml(e.cand)} — ${e.n}</li>`).join('') +
                    `</ul></div>`;
            });
            results.innerHTML = html;
        } catch (err) {
            console.error('Tally failed:', err);
            results.textContent = 'Could not tally votes.';
        }
    };

    details.querySelector('.el-delete').onclick = async () => {
        if (!confirm(`Delete "${election.title}" and all its ballots and votes? This cannot be undone.`)) return;
        try {
            const docs = await fetchBallots();
            // Ballot + vote deletes are 2 ops per ballot — stay under the
            // 500-op batch limit for large member lists.
            for (let i = 0; i < docs.length; i += 200) {
                const batch = writeBatch(db);
                for (const d of docs.slice(i, i + 200)) {
                    batch.delete(d.ref);
                    batch.delete(doc(db, 'votes', await sha256Hex(d.id)));
                }
                if (i + 200 >= docs.length) {
                    batch.delete(doc(db, 'elections', election.id));
                }
                await batch.commit();
            }
            if (!docs.length) {
                await deleteDoc(doc(db, 'elections', election.id));
            }
            await loadElections();
            updateVoteNavLink(true);
        } catch (err) {
            console.error('Delete election failed:', err);
            alert('Could not delete the election.');
        }
    };

    list.appendChild(item);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Bylaw section picker for amendment elections — flattens
 * governance/bylaws (articles → sections) into selectable refs.
 */
let bylawSectionsCache = null;
async function getBylawSections() {
    if (bylawSectionsCache) return bylawSectionsCache;
    const snap = await getDoc(doc(db, 'governance', 'bylaws'));
    bylawSectionsCache = [];
    (snap.data()?.articles || []).forEach(a => {
        (a.sections || []).forEach(s => {
            bylawSectionsCache.push({ ref: `Art. ${a.id} — ${s.label}`, title: a.title || '', text: s.text || '' });
        });
    });
    return bylawSectionsCache;
}

/**
 * GMAIL SENDER — OAuth'd gmail.send flow for election blasts.
 * The admin authorizes their own Gmail via a GIS token client (public OAuth
 * client ID stored in localStorage — it identifies the app, not a secret).
 * Emails go out from the authorized Gmail address via the REST API.
 */
const GMAIL_CLIENT_ID_KEY = 'bndisc_gmail_client_id';
const GMAIL_SENDER_KEY = 'bndisc_gmail_sender';
const GMAIL_SETTINGS_DOC = 'gmail';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
let gmailToken = null;
let gmailTokenAt = 0;
let gmailEmail = '';
let gisLoading = null;

function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisLoading) {
        gisLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Could not load Google sign-in library.'));
            document.head.appendChild(s);
        });
    }
    return gisLoading;
}

function requestGmailToken(prompt) {
    return new Promise(async (resolve, reject) => {
        const clientId = localStorage.getItem(GMAIL_CLIENT_ID_KEY) || '';
        if (!clientId) return reject(new Error('Paste your Gmail OAuth Client ID first.'));
        try { await loadGis(); } catch (e) { return reject(e); }
        try {
            const tc = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: GMAIL_SCOPE,
                // Preselect the configured sender so silent/chooser flows
                // land on the club account, not a personal one.
                hint: localStorage.getItem(GMAIL_SENDER_KEY) || undefined,
                callback: (resp) => {
                    if (resp.error) reject(new Error(resp.error_description || resp.error));
                    else resolve(resp.access_token);
                }
            });
            tc.requestAccessToken({ prompt });
        } catch (e) {
            reject(e);
        }
    });
}

async function ensureGmailToken(silent = false) {
    // Access tokens last ~1h; reuse for 50 min then re-request silently.
    if (gmailToken && Date.now() - gmailTokenAt < 50 * 60 * 1000) return gmailToken;
    gmailToken = await requestGmailToken(
        silent || gmailToken ? '' : 'select_account');
    gmailTokenAt = Date.now();
    try {
        const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
            headers: { Authorization: `Bearer ${gmailToken}` }
        }).then(r => r.json());
        gmailEmail = prof.emailAddress || '';
    } catch (e) { /* profile fetch is just for display */ }

    // Refuse a token for the wrong account — blasts may only come from the
    // configured sender (e.g. the club's Gmail).
    const expected = (localStorage.getItem(GMAIL_SENDER_KEY) || '').toLowerCase();
    if (expected && gmailEmail && gmailEmail.toLowerCase() !== expected) {
        const actual = gmailEmail;
        gmailToken = null;
        gmailEmail = '';
        updateGmailStatus();
        throw new Error(`Connected as ${actual}, but sending is restricted to ${expected}. Connect again with that account.`);
    }
    updateGmailStatus();
    return gmailToken;
}

function updateGmailStatus() {
    const status = document.getElementById('gmail-status');
    const btn = document.getElementById('gmail-connect');
    if (!status) return;
    if (gmailToken) {
        status.textContent = `Connected${gmailEmail ? ` as ${gmailEmail}` : ''} — ready to send.`;
        if (btn) btn.textContent = 'Reconnect Gmail';
    } else {
        const hasId = !!(localStorage.getItem(GMAIL_CLIENT_ID_KEY) || '');
        status.textContent = hasId
            ? 'Not connected — click Connect Gmail and authorize your account.'
            : 'Not connected — create an OAuth client ID (see AGENTS.md) to enable sending.';
        if (btn) btn.textContent = 'Connect Gmail';
    }
}

function rfc822(to, subject, bodyText) {
    const msg = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${bodyText}`;
    return btoa(unescape(encodeURIComponent(msg)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gmailFetch(path, opts = {}) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${gmailToken}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) {
        let detail = '';
        try {
            const body = await res.json();
            detail = body?.error?.message || '';
        } catch (e) { /* non-JSON body */ }
        const err = new Error(`Gmail API ${res.status}${detail ? `: ${detail}` : ''}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function sendBallotEmail(to, link, election, closesStr) {
    const subject = `Vote now: ${election.title}`;
    const body = [
        `Voting is open for ${election.title}.`,
        ``,
        `Your unique ballot link (casts one vote, then stops working):`,
        link,
        ``,
        `Ballot closes ${closesStr}.`,
        `Your vote is anonymous — this link proves eligibility, not identity.`,
        ``,
        `Didn't expect this email? You can ignore it.`,
        ``,
        `— BNDisc Club`
    ].join('\n');
    await gmailFetch('messages/send', {
        method: 'POST',
        body: JSON.stringify({ raw: rfc822(to, subject, body) })
    });
}

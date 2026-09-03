import { db, auth } from './firebase-config.js?v=100';
import { 
    doc, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, getDocs, deleteDoc,
    collection, addDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { isAdmin, getRoster, saveLocalRoster } from './firestore.js?v=100';
import { LOCATIONS, LAYOUT_SUGGESTIONS, getCourseDisplayName, getCourseStorageName } from './courseData.js?v=100';

// State and Cache
let viewDate = new Date(); 
const eventCache = {};
let playersCache = null;

/**
 * Main Initialization
 */
export function initAdminForm() {
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
    initCollapsibleSections();
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

function initEventForm() {
    const form = document.getElementById('event-form');
    if (!form) return;

    initEventLayoutSuggestions();

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

            const newEvent = {
                category,
                day: parseInt(day),
                time: document.getElementById('event-time').value,
                location: document.getElementById('event-loc').value,
                leagueType: document.getElementById('event-league-type').value,
                layout: document.getElementById('event-layout').value,
                createdAt: editingEvent ? editingEvent.event.createdAt : new Date().toISOString()
            };

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
    document.getElementById('event-layout').value = event.layout || '';

    const heading = document.getElementById('event-form-heading');
    if (heading) heading.textContent = 'Edit Event';

    const editingNote = document.getElementById('event-form-editing-note');
    if (editingNote) editingNote.style.display = 'block';

    const submitBtn = document.getElementById('submit-event');
    if (submitBtn) submitBtn.querySelector('span').textContent = 'Update Event';

    const cancelBtn = document.getElementById('cancel-edit-event');
    if (cancelBtn) cancelBtn.style.display = '';

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
    if (prevBtn) prevBtn.onclick = () => changeMonth(-1);
    if (nextBtn) nextBtn.onclick = () => changeMonth(1);
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
    listContainer.innerHTML = events.length === 0 
        ? '<p style="opacity:0.5; padding: 1.5rem; text-align:center;">No events found.</p>' 
        : '';

    const shortMonth = viewDate.toLocaleString('default', { month: 'short' });
    [...events].sort((a, b) => a.day - b.day).forEach(event => {
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
                const location = getRandomUnusedLocation(used);
                const layout = getRandomLayout(location);
                const dateStr = formatLocal(current);
                generated.push({ date: dateStr, location, layout });

                if (!usedCoursesByWeek[weekKey]) usedCoursesByWeek[weekKey] = used;
                used.add(location);
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
                const leagueType = document.getElementById('lr-league-type').value;

                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Saving...';
                try {
                    const eventsByMonth = {};
                    rows.forEach(row => {
                        const date = row.dataset.date;
                        const location = row.querySelector('.lr-course-select').value;
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

function getRandomLocation() {
    return LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
}

function getRandomLayout(location) {
    const options = LAYOUT_SUGGESTIONS[(location || '').toLowerCase().trim()];
    if (!options || options.length === 0) return 'Main';
    return options[Math.floor(Math.random() * options.length)];
}

function getRandomUnusedLocation(usedSet) {
    const available = LOCATIONS.filter(l => !usedSet.has(l));
    if (available.length === 0) return getRandomLocation();
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

    const rows = generated.map(e => `
        <tr class="lr-preview-row" data-date="${e.date}">
            <td style="padding: 0.25rem 0.5rem;">${e.date}</td>
            <td style="padding: 0.25rem 0.5rem;">
                <select class="lr-course-select" style="width: 100%;">
                    ${LOCATIONS.map(loc => `<option value="${loc}" ${loc === e.location ? 'selected' : ''}>${loc}</option>`).join('')}
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
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 20%;">Date</th>
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 40%;">Course</th>
                    <th style="text-align: left; padding: 0.25rem 0.5rem; width: 40%;">Layout</th>
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

            // Store each league inside a 'leagues' array on the admin doc
            await setDoc(doc(db, "league_admins", cleanEmail), {
                email,
                leagues: arrayUnion(newLeague)
            }, { merge: true });

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
                adminItem.style.alignItems = 'flex-start';
                adminItem.style.justifyContent = 'flex-start';
                adminItem.style.gap = '0.5rem';

                let leaguesHtml = '';
                if (leagues.length === 0) {
                    leaguesHtml = '<p style="opacity:0.5; font-size:0.8rem; margin:0;">No leagues assigned.</p>';
                } else {
                    leaguesHtml = `<div style="width:100%; display:flex; flex-direction:column; gap:0.5rem;">` +
                        leagues.map(l => `
                            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                <span style="font-size:0.85rem;">${l.year} • ${l.season} • ${l.leagueType}</span>
                                <button type="button" class="btn-delete" data-email="${data.email || d.id}" data-league='${JSON.stringify(l)}'>Remove</button>
                            </div>
                        `).join('') +
                    `</div>`;
                }

                adminItem.innerHTML = `
                    <div class="admin-event-info" style="width:100%;">
                        <strong>${data.email || d.id}</strong>
                        ${leaguesHtml}
                    </div>
                `;
                list.appendChild(adminItem);
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

    loadLeagueAdmins();
}

const LEAGUE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1iC87kWr4spJBhu4vLJNQanl6KzZrI9BLjBH4ZZ9NljI/export?format=csv&gid=0';

function initLeagueRoster() {
    const loadBtn = document.getElementById('load-league-roster');
    const importBtn = document.getElementById('import-league-roster');
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
            const speed = p.speed ?? '';

            item.innerHTML = `
                <div class="admin-event-info">
                    <strong>${p.name}</strong>
                    <span style="display:block; font-size:0.75rem; opacity:0.6;">
                        Rating: ${current} • HDCP: ${hdcp} • Speed: ${speed}
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
        lastLoaded.textContent = `Last loaded: ${date.toLocaleString()}`;
    }

    async function loadRosterData(force = false) {
        loadBtn.disabled = true;
        if (importBtn) importBtn.disabled = true;
        status.textContent = 'Loading...';
        list.innerHTML = '';

        try {
            const result = await getRoster(force);
            if (!result || !result.roster) {
                status.textContent = 'No players found. Import the roster first.';
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
            if (importBtn) importBtn.disabled = false;
        }
    }

    loadBtn.onclick = () => loadRosterData(true);

    if (importBtn) {
        importBtn.onclick = async () => {
            const currentUser = auth.currentUser;
            if (!currentUser || !(await isAdmin(currentUser.email))) {
                alert('Only club admins can import players.');
                return;
            }

            loadBtn.disabled = true;
            importBtn.disabled = true;
            status.textContent = 'Importing players to Firestore...';
            list.innerHTML = '';

            try {
                const response = await fetch(LEAGUE_SHEET_CSV_URL);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const csv = await response.text();
                const players = parsePlayerRows(csv);

                const rosterData = {
                    players: players.map(player => player.data),
                    importedAt: new Date().toISOString()
                };

                // One setDoc = 1 Firestore write regardless of player count
                await setDoc(doc(db, 'players', 'roster'), rosterData);

                // Tiny timestamp doc lets clients skip the full roster read when nothing changed
                await setDoc(doc(db, 'players', 'lastImport'), { importedAt: rosterData.importedAt });

                // Cache the imported data so the next Load doesn't re-read Firestore
                playersCache = { players: rosterData.players, importedAt: rosterData.importedAt };
                saveLocalRoster(playersCache);

                updateLastLoaded(playersCache.importedAt);
                status.textContent = `Imported ${players.length} players to Firestore.`;
                alert(`Imported ${players.length} players.`);
                renderRoster(playersCache.players);
            } catch (error) {
                console.error('Roster import error:', error);
                status.textContent = `Error: ${error.message}`;
                alert('Failed to import players. Check console for details.');
            } finally {
                loadBtn.disabled = false;
                importBtn.disabled = false;
            }
        };
    }

    // Auto-load roster when admin page initializes (use cache, no Firestore read if local exists)
    loadRosterData(false);
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
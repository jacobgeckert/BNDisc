import { db } from './firebase-config.js?v=100';
import { doc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getCourseDisplayName } from './courseData.js?v=100';

// 1. GLOBAL STATE & CACHE
let viewDate = new Date();
const calendarCache = {};
let leagueScheduleGroups = [];
let leagueScheduleLoaded = false; 

function formatTime12Hour(timeString) {
    if (!timeString) return '';
    if (/[AaPp][Mm]/.test(timeString)) return timeString;

    const [hours, minutes] = String(timeString).split(':');
    let h = parseInt(hours, 10);
    const m = (minutes || '00').padStart(2, '0');

    if (isNaN(h)) return timeString;

    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${period}`;
}

export async function loadCurrentEvents() {
    const grid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('current-month-display');
    
    if (!grid) return;

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); 
    const realToday = new Date(); 
    
    const monthId = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthNames = ["January", "February", "March", "April", "May", "June", 
                        "July", "August", "September", "October", "November", "December"];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    
    if (monthDisplay) monthDisplay.innerText = `${monthNames[month]} ${year}`;

    // 2. FETCH DATA (CACHE-FIRST LOGIC WITH CONSOLE LOGS)
    let events = [];
    if (calendarCache[monthId]) {
        // GREEN LOG FOR CACHE
        console.log(`%c [Calendar Cache] ${monthId} found in memory. Zero reads used.`, "color: #10b981; font-weight: bold;");
        events = calendarCache[monthId];
    } else {
        // ORANGE LOG FOR DATABASE READ
        console.log(`%c [Firestore] ${monthId} not cached. Fetching from database... (1 Read)`, "color: #f59e0b; font-weight: bold;");
        
        try {
            const docRef = doc(db, "event_bundles", monthId);
            const docSnap = await getDoc(docRef);
            events = docSnap.exists() ? docSnap.data().events || [] : [];
            
            calendarCache[monthId] = events;
        } catch (error) {
            console.error("Firestore Error:", error);
            grid.innerHTML = `<p class="error">Error loading calendar.</p>`;
            return;
        }
    }

    // 3. RENDER GRID
    const firstDayIndex = new Date(year, month, 1).getDay(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    grid.innerHTML = "";

    // Padding for Desktop
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'calendar-day padding-day'; 
        grid.appendChild(emptyDiv);
    }

    // Generate Days
    for (let d = 1; d <= daysInMonth; d++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        
        if (d === realToday.getDate() && month === realToday.getMonth() && year === realToday.getFullYear()) {
            dayDiv.classList.add('today');
        }

        const dayEvents = events.filter(e => parseInt(e.day) === d);
        if (dayEvents.length === 0) dayDiv.classList.add('no-events');

        const dayOfWeek = new Date(year, month, d).getDay();
        const dayName = dayNames[dayOfWeek];
        dayDiv.innerHTML = `<span class="day-number">${d}<span class="day-name">${dayName}</span></span>`;
        const pillContainer = document.createElement('div');
        pillContainer.className = 'pill-container';

        dayEvents.forEach(event => {
            const pill = document.createElement('div');
            const categoryClass = `cat-${event.category.toLowerCase().replace(/\s+/g, '-')}`;
            let pillClasses = `event-pill ${categoryClass}`;
            if (event.category.toLowerCase() === 'league' && event.leagueType) {
                pillClasses += ` type-${event.leagueType.toLowerCase().replace(/\s+/g, '-')}`;
            }
            pill.className = pillClasses;

            const timeSpan = document.createElement('strong');
            timeSpan.className = 'pill-time';
            timeSpan.textContent = formatTime12Hour(event.time);

            const categorySpan = document.createElement('span');
            categorySpan.className = 'pill-category';
            categorySpan.textContent = event.category;

            pill.appendChild(timeSpan);
            pill.appendChild(categorySpan);

            if (event.location) {
                const locSpan = document.createElement('span');
                locSpan.className = 'pill-location';
                locSpan.textContent = event.location;
                pill.appendChild(locSpan);
            }

            pill.onclick = (e) => {
                e.stopPropagation();
                showEventModal(event);
            };
            pillContainer.appendChild(pill);
        });

        dayDiv.appendChild(pillContainer);
        grid.appendChild(dayDiv);
    }

    // 4. MOBILE EMPTY STATE CHECK
    if (events.length === 0 && window.innerWidth <= 768) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-calendar-blank" style="font-size: 3rem; opacity: 0.2;"></i>
                <p>No events scheduled for ${monthNames[month]}.</p>
            </div>
        `;
    }

    setupCalendarButtons();
}

function showEventModal(event) {
    const modal = document.getElementById('event-modal');
    const title = document.getElementById('event-modal-title');
    const time = document.getElementById('event-modal-time');
    const location = document.getElementById('event-modal-location');
    const layout = document.getElementById('event-modal-layout');
    const leagueType = document.getElementById('event-modal-league-type');

    if (!modal || !title) return;

    title.textContent = event.category;
    time.textContent = `Time: ${formatTime12Hour(event.time)}`;
    location.textContent = `Location: ${event.location || 'TBD'}`;
    if (layout) layout.textContent = event.layout ? `Layout: ${event.layout}` : '';
    if (leagueType) leagueType.textContent = event.leagueType ? `League Type: ${event.leagueType}` : '';

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function hideEventModal() {
    const modal = document.getElementById('event-modal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

function setupCalendarButtons() {
    const prevBtn = document.getElementById('prev-month-btn');
    const nextBtn = document.getElementById('next-month-btn');
    const todayBtn = document.getElementById('today-btn');

    if (prevBtn) {
        prevBtn.onclick = () => {
            viewDate.setMonth(viewDate.getMonth() - 1);
            loadCurrentEvents();
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            viewDate.setMonth(viewDate.getMonth() + 1);
            loadCurrentEvents();
        };
    }

    if (todayBtn) {
        todayBtn.onclick = () => {
            viewDate = new Date();
            loadCurrentEvents();
        };
    }
}

// --- League Schedule View ---

const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };

function getSeasonFromMonth(month) {
    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    if (month >= 9 && month <= 11) return 'Fall';
    return 'Winter';
}

function getCheckInEndTime(checkInTime, teeOffTime) {
    if (!checkInTime || !teeOffTime) return null;
    const [ch, cm] = String(checkInTime).split(':').map(Number);
    const [th, tm] = String(teeOffTime).split(':').map(Number);
    if (isNaN(ch) || isNaN(th)) return null;
    const startMinutes = ch * 60 + cm;
    let endMinutes = th * 60 + tm - 5;
    if (endMinutes < startMinutes) endMinutes = startMinutes;
    const eh = Math.floor(endMinutes / 60);
    const em = endMinutes % 60;
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

function renderLeagueSchedule(group) {
    const container = document.getElementById('league-schedule-table');
    const title = document.getElementById('league-schedule-title');
    if (!container) return;
    if (!group) {
        container.innerHTML = '';
        if (title) title.textContent = 'League Schedule';
        return;
    }

    if (title) {
        title.textContent = `${group.year} ${group.season.toUpperCase()} ${group.leagueType.toUpperCase()} LEAGUE SCHEDULE`;
    }

    const rows = group.events.map(ev => {
        const dateStr = ev.date.toLocaleDateString('en-US');
        const course = getCourseDisplayName(ev.location) || ev.location;
        const checkInEnd = getCheckInEndTime(ev.time, ev.teeOffTime);
        const checkIn = checkInEnd
            ? `${formatTime12Hour(ev.time)} - ${formatTime12Hour(checkInEnd)}`
            : formatTime12Hour(ev.time);
        const teeOff = formatTime12Hour(ev.teeOffTime);
        const notes = ev.notes || ev.layout || '';
        return `
            <tr>
                <td>${dateStr}</td>
                <td>${course}</td>
                <td>${checkIn}</td>
                <td>${teeOff}</td>
                <td>${notes}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table class="league-schedule-table">
                <thead>
                    <tr>
                        <th>DATE</th>
                        <th>COURSE</th>
                        <th>CHECK-IN</th>
                        <th>TEE OFF</th>
                        <th>NOTES</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

export async function loadLeagueSchedule() {
    const select = document.getElementById('league-schedule-select');
    const container = document.getElementById('league-schedule-table');
    if (!select || !container) return;
    if (leagueScheduleLoaded) return;
    leagueScheduleLoaded = true;

    container.innerHTML = '<p class="subtitle" style="opacity: 0.7;">Loading schedules...</p>';

    try {
        const snapshot = await getDocs(collection(db, 'event_bundles'));
        const allEvents = [];

        snapshot.forEach(docSnap => {
            const monthId = docSnap.id;
            const data = docSnap.data() || {};
            const events = Array.isArray(data.events) ? data.events : [];
            events.forEach(event => {
                if (event.category !== 'League' || !event.day || !event.leagueType || !event.location) return;
                const date = new Date(`${monthId}-${String(event.day).padStart(2, '0')}T00:00:00`);
                if (isNaN(date.getTime())) return;
                allEvents.push({
                    ...event,
                    date,
                    year: date.getFullYear(),
                    season: getSeasonFromMonth(date.getMonth() + 1)
                });
            });
        });

        if (allEvents.length === 0) {
            container.innerHTML = '<p class="subtitle" style="opacity: 0.7;">No league schedules found.</p>';
            return;
        }

        const groups = {};
        allEvents.forEach(ev => {
            const key = `${ev.year}|${ev.leagueType}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(ev);
        });

        leagueScheduleGroups = Object.entries(groups).map(([key, events]) => {
            const [year, leagueType] = key.split('|');
            const seasonCounts = {};
            events.forEach(ev => { seasonCounts[ev.season] = (seasonCounts[ev.season] || 0) + 1; });
            const season = Object.entries(seasonCounts).sort((a, b) => b[1] - a[1])[0][0];
            return {
                year: parseInt(year, 10),
                leagueType,
                season,
                events: events.sort((a, b) => a.date - b.date)
            };
        }).sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return (SEASON_ORDER[b.season] ?? -1) - (SEASON_ORDER[a.season] ?? -1);
        });

        select.innerHTML = '<option value="" disabled selected>Select a league schedule...</option>';
        leagueScheduleGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = JSON.stringify({ year: group.year, leagueType: group.leagueType, season: group.season });
            option.textContent = `${group.year} ${group.season} ${group.leagueType}`;
            select.appendChild(option);
        });

        select.onchange = () => {
            const selected = select.value ? JSON.parse(select.value) : null;
            const group = leagueScheduleGroups.find(g =>
                g.year === selected?.year &&
                g.leagueType === selected?.leagueType &&
                g.season === selected?.season
            );
            renderLeagueSchedule(group);
        };

        if (leagueScheduleGroups.length > 0) {
            select.selectedIndex = 1;
            renderLeagueSchedule(leagueScheduleGroups[0]);
        }
    } catch (error) {
        console.error('Error loading league schedule:', error);
        container.innerHTML = '<p class="subtitle" style="opacity: 0.7;">Unable to load schedules.</p>';
    }
}

function setupEventsViewToggle() {
    const calendarBtn = document.getElementById('events-view-calendar-btn');
    const scheduleBtn = document.getElementById('events-view-schedule-btn');
    const calendarView = document.getElementById('events-calendar-view');
    const scheduleView = document.getElementById('events-schedule-view');

    if (!calendarBtn || !scheduleBtn || !calendarView || !scheduleView) return;

    calendarBtn.onclick = () => {
        calendarBtn.classList.add('active');
        scheduleBtn.classList.remove('active');
        calendarView.style.display = '';
        scheduleView.style.display = 'none';
    };

    scheduleBtn.onclick = () => {
        scheduleBtn.classList.add('active');
        calendarBtn.classList.remove('active');
        calendarView.style.display = 'none';
        scheduleView.style.display = 'block';
        loadLeagueSchedule();
    };
}

(function initEventModal() {
    const modal = document.getElementById('event-modal');
    const closeBtn = modal?.querySelector('.event-modal-close');
    const backdrop = modal?.querySelector('.event-modal-backdrop');

    if (closeBtn) closeBtn.onclick = hideEventModal;
    if (backdrop) backdrop.onclick = hideEventModal;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('active')) hideEventModal();
    });
})();

setupEventsViewToggle();
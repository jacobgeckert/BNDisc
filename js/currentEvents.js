import { db } from './firebase-config.js?v=100';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 1. GLOBAL STATE & CACHE
let viewDate = new Date();
const calendarCache = {}; 

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
            pill.className = `event-pill ${categoryClass}`;

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
    const description = document.getElementById('event-modal-description');

    if (!modal || !title) return;

    title.textContent = event.category;
    time.textContent = `Time: ${formatTime12Hour(event.time)}`;
    location.textContent = `Location: ${event.location || 'TBD'}`;
    description.textContent = event.description || '';

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
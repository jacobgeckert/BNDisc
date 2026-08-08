import { db } from './firebase-config.js?v=100';
import { getCourseDisplayName } from './courseData.js?v=100';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/** --- STATE & CACHE --- **/
let courseRecordsCache = null;
let currentDivision = 'M';
let currentParkFilter = 'all';
let searchString = ''; // New state for search

/**
 * 1. Entry Point: Loaded by Nav
 */
export async function loadCourseRecords() {
    const container = document.getElementById('records-list-container');
    if (!container) return;

    // Set up listeners for dropdown, search bar, and radio toggles
    initFilters();

    // 2. FETCH DATA (CACHE-FIRST LOGIC)
    if (courseRecordsCache) {
        console.log(`%c [Records Cache] Dashboard entry. Zero reads used.`, "color: #10b981; font-weight: bold;");
        renderRecords(courseRecordsCache);
        return;
    }

    try {
        const querySnapshot = await getDocs(collection(db, "course_records"));
        const docCount = querySnapshot.size;

        console.log(`%c [Firestore] Records not cached. Fetching ${docCount} document(s)...`, "color: #f59e0b; font-weight: bold;");

        const allRecords = [];
        querySnapshot.forEach(doc => {
            allRecords.push({
                parkName: doc.id,
                layouts: doc.data().layouts || {}
            });
        });

        courseRecordsCache = allRecords;

        populateCourseDropdown(allRecords);
        renderRecords(allRecords);
    } catch (error) {
        console.error("%c Firestore Error:", "color: #ef4444; font-weight: bold;", error);
        container.innerHTML = `<p class="error" style="text-align:center; padding:2rem;">Error loading course records.</p>`;
    }
}

/**
 * 2. Event Listeners for Filters
 */
function initFilters() {
    // Division Toggle (Mixed vs Women) — reset to Mixed on load
    currentDivision = 'M';
    const toggles = document.querySelectorAll('input[name="view-division"]');
    toggles.forEach(radio => {
        radio.checked = (radio.value === 'M');
        radio.removeEventListener('change', handleDivisionChange);
        radio.addEventListener('change', handleDivisionChange);
    });

    // Course Filter Dropdown
    const filterDropdown = document.getElementById('course-filter');
    if (filterDropdown) {
        filterDropdown.removeEventListener('change', handleParkFilterChange);
        filterDropdown.addEventListener('change', handleParkFilterChange);
    }

    // NEW: Search Input Listener
    const searchInput = document.getElementById('record-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchString = e.target.value.toLowerCase();
            renderRecords(courseRecordsCache);
        });
    }
}

/**
 * 3. Filter Handlers
 */
function handleDivisionChange(e) {
    currentDivision = e.target.value; 
    if (courseRecordsCache) renderRecords(courseRecordsCache);
}

function handleParkFilterChange(e) {
    currentParkFilter = e.target.value;
    if (courseRecordsCache) renderRecords(courseRecordsCache);
}

/**
 * 4. Populate Dropdown Options
 */
function populateCourseDropdown(records) {
    const filter = document.getElementById('course-filter');
    if (!filter) return;
    const parkNames = records.map(r => r.parkName).sort();
    filter.innerHTML = '<option value="all">All Courses</option>';
    parkNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = getCourseDisplayName(name);
        filter.appendChild(option);
    });
}

/**
 * 5. Rendering Engine
 */
function renderRecords(data) {
    const container = document.getElementById('records-list-container');
    if (!container || !data) return;
    
    container.innerHTML = '';

    // Step A: Apply Course Filter
    const filteredByPark = data.filter(park => {
        return currentParkFilter === 'all' || park.parkName === currentParkFilter;
    });

    const sortedParks = [...filteredByPark].sort((a, b) => a.parkName.localeCompare(b.parkName));

    sortedParks.forEach(park => {
        const parkDiv = document.createElement('div');
        parkDiv.className = 'park-record-section';
        const scoreKey = currentDivision === 'W' ? 'scoresW' : 'scoresM';
        
const layoutsHtml = Object.entries(park.layouts).map(([layoutName, layoutData]) => {
            const par = layoutData.par || null;
            const allScores = layoutData[scoreKey] || []; // Keep the full list for ranking
            const rankedScores = [...allScores].sort((a, b) => a.score - b.score || new Date(a.date) - new Date(b.date));

            // 1. Filter the scores for the search, but keep track of original rank
            const filteredScores = rankedScores
                .map((rec, index) => ({ ...rec, originalRank: index + 1 })) // Attach rank here
                .filter(rec => {
                    if (!searchString) return true;
                    return rec.player.toLowerCase().includes(searchString);
                });

            // Hide layouts with no data after search
            if (filteredScores.length === 0) return '';

            return `
                <div class="layout-group">
                    <div class="layout-header">
                        <h4 class="layout-title">${layoutName}</h4>
                        ${par ? `<span class="par-badge">Par ${par}</span>` : ''}
                    </div>
                    <div class="record-leaderboard">
                        ${filteredScores.map((rec) => {
                            let toParHtml = '';
                            if (par) {
                                const diff = rec.score - par;
                                const sign = diff > 0 ? '+' : '';
                                const displayDiff = diff === 0 ? 'E' : `${sign}${diff}`;
                                toParHtml = `<span class="to-par">(${displayDiff})</span>`;
                            }

                            // Use originalRank instead of the current loop index
                            const isFirstPlace = rec.originalRank === 1;

                            return `
                                <div class="record-row ${isFirstPlace ? 'gold-record' : ''}">
                                    <div class="rank">#${rec.originalRank}</div>
                                    <div class="player-info">
                                        <span class="player-name">${rec.player}</span>
                                        <span class="record-date">${new Date(rec.date).toLocaleDateString()}</span>
                                    </div>
                                    <div class="score-display">
                                        <span class="total-strokes">${rec.score}</span>
                                        ${toParHtml}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');

        if (layoutsHtml.trim() !== '') {
            parkDiv.innerHTML = `
                <h3 class="course-group-title">${getCourseDisplayName(park.parkName)}</h3>
                <div class="layouts-grid">${layoutsHtml}</div>
            `;
            container.appendChild(parkDiv);
        }
    });

    // Check for empty results
    if (container.innerHTML === '') {
        const noResultsMsg = searchString 
            ? `No records found for "${searchString}"`
            : `No ${currentDivision === 'W' ? "Women's" : "Mixed"} records found.`;
            
        container.innerHTML = `
            <div style="text-align:center; padding: 4rem; opacity: 0.4;">
                <p>${noResultsMsg}</p>
            </div>
        `;
    }
}
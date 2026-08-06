import { db } from './firebase-config.js?v=100';
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const yearSelect = document.getElementById('bag-tag-year');
const list = document.getElementById('bag-tags-list');

async function loadBagTags(year) {
    if (!list) return;
    if (!year) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = '<div class="loading-spinner">Loading bag tags...</div>';
    console.log('[bagTags] db:', db);
    console.log('[bagTags] loadBagTags year:', year);
    try {
        const ref = doc(db, 'tags', year);
        console.log('[bagTags] doc ref:', ref);
        const snap = await getDoc(ref);
        console.log('[bagTags] snap exists:', snap.exists(), 'id:', snap.id);
        if (!snap.exists()) {
            list.innerHTML = '<p style="opacity:0.5; text-align:center;">No bag tag records for this year.</p>';
            return;
        }
        const data = snap.data();
        console.log('[bagTags] raw data:', data);
        const entries = Object.entries(data)
            .filter(([_, value]) => value && typeof value === 'object')
            .sort(([a], [b]) => {
                const na = Number(a), nb = Number(b);
                if (!isNaN(na) && !isNaN(nb)) return na - nb;
                return String(a).localeCompare(String(b));
            });
        if (entries.length === 0) {
            list.innerHTML = '<p style="opacity:0.5; text-align:center;">No bag tag records for this year.</p>';
            return;
        }
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; margin-top: 0.5rem;';
        table.innerHTML = `
            <thead>
                <tr style="background: var(--sidebar-bg); border-bottom: 1px solid var(--glass-border);">
                    <th style="padding: 0.5rem; text-align: left; font-weight: 600;">Tag #</th>
                    <th style="padding: 0.5rem; text-align: left; font-weight: 600;">Last Known Owner</th>
                    <th style="padding: 0.5rem; text-align: left; font-weight: 600;">Last Seen Date</th>
                </tr>
            </thead>
        `;
        const IGNORED_OWNERS = new Set(['Unknown', 'League Box']);

        // Determine, for each owner appearing on more than one tag, the most
        // recent date they were seen on. Any tag entry for that owner with an
        // earlier date should have the name struck through.
        const latestDateByOwner = {};
        entries.forEach(([, info]) => {
            const owner = info.lastReportedOwner;
            const date = info.lastReportedDateSeen;
            if (!owner || !date || IGNORED_OWNERS.has(owner)) return;
            if (!latestDateByOwner[owner] || date > latestDateByOwner[owner]) {
                latestDateByOwner[owner] = date;
            }
        });

        const tbody = document.createElement('tbody');
        entries.forEach(([tagNum, info], i) => {
            const owner = info.lastReportedOwner || 'Unknown';
            const date = info.lastReportedDateSeen || '—';
            const isSuperseded = !IGNORED_OWNERS.has(owner) &&
                info.lastReportedDateSeen &&
                latestDateByOwner[owner] &&
                info.lastReportedDateSeen < latestDateByOwner[owner];
            const ownerHtml = isSuperseded ? `<s>${owner}</s>` : owner;
            const row = document.createElement('tr');
            row.style.cssText = `border-bottom: 1px solid var(--glass-border); background: ${i % 2 === 0 ? 'var(--bg-color)' : 'var(--sidebar-bg)'};`;
            row.innerHTML = `
                <td style="padding: 0.5rem;">${tagNum}</td>
                <td style="padding: 0.5rem;">${ownerHtml}</td>
                <td style="padding: 0.5rem;">${date}</td>
            `;
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        list.innerHTML = '';
        list.appendChild(table);
    } catch (e) {
        console.error('[bagTags] loadBagTags error:', e);
        list.innerHTML = `<p style="color: #d32f2f; text-align:center;">Could not load bag tags: ${e.message || 'unknown error'}</p>`;
    }
}

async function populateYears() {
    if (!yearSelect) return;
    yearSelect.innerHTML = '';
    let years = [];
    try {
        console.log('[bagTags] fetching years from tags collection...');
        const snap = await getDocs(collection(db, 'tags'));
        years = snap.docs.map(d => d.id).filter(id => /^\d{4}$/.test(id));
        console.log('[bagTags] years found:', years);
    } catch (e) {
        console.error('[bagTags] populateYears error:', e);
    }
    years.sort((a, b) => Number(b) - Number(a));
    if (years.length === 0) {
        const currentYear = String(new Date().getFullYear());
        const opt = document.createElement('option');
        opt.value = currentYear;
        opt.textContent = currentYear;
        yearSelect.appendChild(opt);
        loadBagTags(currentYear);
        return;
    }
    years.forEach(year => {
        const opt = document.createElement('option');
        opt.value = year;
        opt.textContent = year;
        yearSelect.appendChild(opt);
    });
    yearSelect.addEventListener('change', () => loadBagTags(yearSelect.value));
    loadBagTags(yearSelect.value);
}

function initBagTags() {
    if (!yearSelect) return;
    populateYears();
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#ratings') loadBagTags(yearSelect.value);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBagTags);
} else {
    initBagTags();
}
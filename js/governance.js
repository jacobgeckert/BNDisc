import { db } from './firebase-config.js?v=100';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Main Initialization
 */
async function renderGovernancePage() {
    await Promise.all([
        renderLatestMinutes(),
        renderFinanceOverview(), // New Financial Render
        renderBylaws()
    ]);
}

/**
 * 1. RENDER FINANCE OVERVIEW
 */
async function renderFinanceOverview() {
    const container = document.getElementById('finance-text-content');
    if (!container) return;

    const currentYear = new Date().getFullYear().toString();

    try {
        const docRef = doc(db, "finance_bundles", currentYear);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // Sort transactions: newest first
            const transactions = (data.transactions || []).sort((a, b) => new Date(b.date) - new Date(a.date));

            // Calculate Totals
            let totalDeposits = 0;
            let totalWithdrawals = 0;

            transactions.forEach(t => {
                if (t.type === 'Deposit') totalDeposits += t.amount;
                else totalWithdrawals += t.amount;
            });

            const currentBalance = totalDeposits - totalWithdrawals;

            container.innerHTML = `
                <div class="finance-report-content">
                    <div class="finance-summary-grid">
                        <div class="stat-box" data-filter="all">
                            <label>Total Balance</label>
                            <span class="amount">$${currentBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                        <div class="stat-box" data-filter="Deposit">
                            <label>YTD Deposits</label>
                            <span class="amount positive">+$${totalDeposits.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                        <div class="stat-box" data-filter="Withdrawal">
                            <label>YTD Expenses</label>
                            <span class="amount negative">-$${totalWithdrawals.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                    </div>

                    <table class="finance-ledger">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Category</th>
                                <th>Memo</th>
                                <th>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${transactions.map(t => `
                                <tr data-type="${t.type}">
                                    <td data-label="Date">${t.date}</td>
                                    <td data-label="Category"><span class="tag-badge">${t.category || 'General'}</span></td>
                                    <td data-label="Memo">${t.memo || '-'}</td>
                                    <td data-label="Amount" class="${t.type === 'Deposit' ? 'positive' : 'negative'}">
                                        ${t.type === 'Deposit' ? '+' : '-'}$${t.amount.toFixed(2)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            const ledger = container.querySelector('.finance-ledger');
            const boxes = container.querySelectorAll('.stat-box');
            if (ledger && boxes.length) {
                boxes.forEach(box => {
                    box.addEventListener('click', () => {
                        if (window.innerWidth > 768) return;
                        const filter = box.dataset.filter;
                        ledger.querySelectorAll('tbody tr').forEach(row => {
                            row.style.display = (filter === 'all' || row.dataset.type === filter) ? '' : 'none';
                        });
                        const wasActive = box.classList.contains('active-stat');
                        const isExpanded = ledger.classList.contains('expanded');
                        if (wasActive && isExpanded) {
                            ledger.classList.remove('expanded');
                            boxes.forEach(b => b.classList.remove('active-stat'));
                        } else {
                            ledger.classList.add('expanded');
                            boxes.forEach(b => b.classList.remove('active-stat'));
                            box.classList.add('active-stat');
                        }
                    });
                });
            }

            const treasuryTitle = document.getElementById('treasury-title');
            const treasuryCard = treasuryTitle ? treasuryTitle.parentElement.nextElementSibling : null;
            if (treasuryTitle && treasuryCard) {
                treasuryTitle.addEventListener('click', () => {
                    if (window.innerWidth > 768) return;
                    treasuryTitle.classList.toggle('expanded');
                    treasuryCard.classList.toggle('expanded');
                });
            }
        } else {
            container.innerHTML = `<p class="loading-text">No financial records found for ${currentYear}.</p>`;
        }
    } catch (error) {
        console.error("Finance Error:", error);
        container.innerHTML = `<p class="loading-text">Error loading treasury data.</p>`;
    }
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseMinutesList(text) {
    if (!text) return [];
    return text
        .replace(/^\s*[•\-]\s*/gm, '')
        .split(/[\n\r]+|[•\-]\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

function formatMinutesList(text, fallback) {
    const items = parseMinutesList(text);
    if (items.length === 0) return `<p>${fallback}</p>`;
    return `<ul class="minutes-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

/**
 * 2. RENDER LATEST MINUTES (Updated with formatting)
 */
async function renderLatestMinutes() {
    const minutesContainer = document.getElementById('minutes-text-content');
    if (!minutesContainer) return;

    const currentYear = new Date().getFullYear().toString();
    
    try {
        const docRef = doc(db, "meeting_bundles", currentYear);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const latest = data.meetings.sort((a, b) => new Date(b.meetingDate) - new Date(a.meetingDate))[0];

            if (latest) {
                minutesContainer.innerHTML = `
                    <div class="minutes-report-content">
                        <p><strong>DATE:</strong> ${latest.meetingDate}</p>
                        <p><strong>LOCATION:</strong> ${latest.location}</p>
                        <p><strong>CALL TO ORDER:</strong> ${formatTime(latest.startTime)}</p>
                        <p><strong>PRESIDING:</strong> ${latest.presiding}</p>
                        <p><strong>SECRETARY:</strong> ${latest.secretary}</p>
                        <br>

                        <div class="report-section">
                            <h4>Attendance</h4>
                            <p><strong>Board:</strong> ${latest.attendance}</p>
                            <p><strong>Missing:</strong> ${latest.missing || 'None'}</p>
                            <p><strong>Guests:</strong> ${latest.guests || 'None'}</p>
                            <br>
                        </div>

                        <div class="report-body">
                            <div class="report-topic">
                                <strong>Sponsorship & Opportunities</strong>
                                ${formatMinutesList(latest.sponsorship, 'No updates.')}
                                <br>
                            </div>
                            <div class="report-topic"><strong>Course Maintenance Opportunities</strong>${formatMinutesList(latest.courseMaintenance, 'No updates.')}</div>
                            <div class="report-topic"><strong>Old Business</strong>${formatMinutesList(latest.oldBusiness, 'None.')}</div>
                            <div class="report-topic"><strong>New Business</strong>${formatMinutesList(latest.newBusiness, 'None.')}</div>
                            <div class="report-topic"><strong>Around the Room</strong>${formatMinutesList(latest.aroundRoom, 'No additional discussion.')}</div>
                        </div>

                        <div class="report-footer">
                            <p><strong>Next Meeting:</strong> ${formatDateTime(latest.nextMeeting)} — ${latest.nextLocation}</p>
                        </div>
                    </div>
                `;

                const minutesTitle = document.getElementById('minutes-title');
                const minutesCard = minutesTitle ? minutesTitle.parentElement.nextElementSibling : null;
                if (minutesTitle && minutesCard) {
                    minutesTitle.addEventListener('click', () => {
                        if (window.innerWidth > 768) return;
                        minutesTitle.classList.toggle('expanded');
                        minutesCard.classList.toggle('expanded');
                    });
                }
                return;
            }
        }
        minutesContainer.innerHTML = `<p class="loading-text">No meeting minutes found for ${currentYear}.</p>`;
    } catch (error) {
        console.error("Minutes Error:", error);
    }
}

/**
 * 3. RENDER BYLAWS
 */
async function renderBylaws() {
    const bylawsContainer = document.getElementById('bylaws-text-content');
    if (!bylawsContainer) return;

    try {
        const docRef = doc(db, "governance", "bylaws");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            let bylawsHTML = '';

            if (data.articles) {
                bylawsHTML += data.articles.map(article => `
                    <div class="bylaws-article-block">
                        <h3 class="article-heading">Article ${romanize(article.id)} — ${article.title}</h3>
                        <div class="article-body">
                            ${(article.sections || []).map(section => `
                                <div class="bylaws-row">
                                    <span class="row-label">${section.label}</span>
                                    <div class="row-content">
                                        <p>${section.text}</p>
                                        ${section.subPoints ? `
                                            <div class="sub-points">
                                                ${section.subPoints.map(p => {
                                                    const isTertiary = p.trim().startsWith('i');
                                                    const className = isTertiary ? 'sub-point-inner' : 'sub-point-standard';
                                                    return `<p class="${className}"><strong>${p.split(':')[0]}</strong>: ${p.split(':').slice(1).join(':')}</p>`;
                                                }).join('')}
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div><hr class="article-divider">
                `).join('');
            }

            if (data.lastModified) {
                bylawsHTML += `
                    <div class="bylaws-article-block">
                        <h3 class="article-heading">Certification of Approval</h3>
                        <div class="article-body">
                            <p>Ratified on <strong>${data.lastModified.dateOfApproval}</strong>.</p>
                            <div class="board-signatures">
                                <p>President: ${data.lastModified.president}</p>
                                <p>Secretary: ${data.lastModified.secretary}</p>
                            </div>
                        </div>
                    </div>
                `;
            }
            bylawsContainer.innerHTML = bylawsHTML;

            bylawsContainer.querySelectorAll('.article-heading').forEach(heading => {
                heading.addEventListener('click', () => {
                    if (window.innerWidth > 768) return;
                    const block = heading.closest('.bylaws-article-block');
                    if (block) block.classList.toggle('expanded');
                });
            });
        }
    } catch (error) {
        console.error("Bylaws Error:", error);
    }
}

/**
 * UTILITY HELPERS
 */
function formatDateTime(str) {
    if (!str) return "TBD";
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + 
           ' @ ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatTime(str) {
    if (!str) return "N/A";
    const [h, m] = str.split(':');
    const d = new Date();
    d.setHours(h, m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function romanize(num) {
    const lookup = {M:1000,CM:900,D:500,CD:400,C:100,XC:90,L:50,XL:40,X:10,IX:9,V:5,IV:4,I:1};
    let roman = '';
    for (let i in lookup) { while (num >= lookup[i]) { roman += i; num -= lookup[i]; } }
    return roman;
}

document.addEventListener('DOMContentLoaded', renderGovernancePage);
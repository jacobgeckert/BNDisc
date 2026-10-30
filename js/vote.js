/**
 * Club Elections — voter-facing ballot page (#vote) and Vote nav-link visibility.
 *
 * Voting links look like: <site>/#vote?t=<token>
 * - ballots/{token}         -> { electionId, email, used, usedAt }
 *   The unguessable token IS the credential: knowing it authorizes the vote.
 * - votes/{sha256(token)}   -> { electionId, selections, submittedAt }
 *   The vote doc ID is a one-way hash, so a ballot can be marked "used"
 *   without anyone being able to tie a stored vote back to an email.
 */
import { db } from './firebase-config.js?v=100';
import {
    doc, getDoc, getDocs, collection, query, where,
    serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ELECTION_CACHE_TTL_MS = 60 * 1000;
let openElectionCache = { at: 0, count: 0 };

export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 128-bit url-safe random token — unguessable, so the doc ID is the credential.
export function makeBallotToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makeVoteLink(token) {
    return `${location.origin}${location.pathname}#vote?t=${token}`;
}

function getTokenFromHash() {
    const hash = window.location.hash || '';
    const qi = hash.indexOf('?');
    if (qi === -1) return '';
    return new URLSearchParams(hash.slice(qi + 1)).get('t') || '';
}

// Accepts a pasted link ("...#vote?t=TOKEN") or a bare token.
export function extractToken(text) {
    const t = (text || '').trim();
    if (!t) return '';
    const m = t.match(/[?&]t=([A-Za-z0-9_-]{10,})/);
    return m ? m[1] : t;
}

export function isElectionOpen(election) {
    if (!election || election.open === false) return false;
    const closes = election.closesAt?.toMillis?.() ?? NaN;
    return !isNaN(closes) && Date.now() < closes;
}

// Reveals the Vote nav link while a navVisible open election exists, or while
// the user is on #vote via a ballot link. Result cached for 60s.
export async function updateVoteNavLink(force = false) {
    const link = document.querySelector('.nav-links a[href="#vote"]');
    if (!link) return;
    const onVotePage = (window.location.hash || '').split('?')[0] === '#vote';
    let show = onVotePage;
    if (!show) {
        try {
            if (force || Date.now() - openElectionCache.at > ELECTION_CACHE_TTL_MS) {
                const snap = await getDocs(query(
                    collection(db, 'elections'),
                    where('open', '==', true)
                ));
                const visible = snap.docs.filter(d => d.data().navVisible !== false);
                openElectionCache = { at: Date.now(), count: visible.length };
            }
            show = openElectionCache.count > 0;
        } catch (e) {
            console.warn('Could not check for open elections:', e);
            show = openElectionCache.count > 0;
        }
    }
    link.classList.toggle('unlocked', show);
}

export async function initVote() {
    const status = document.getElementById('vote-status');
    const codeEntry = document.getElementById('vote-code-entry');
    const form = document.getElementById('vote-form');
    const done = document.getElementById('vote-done');
    if (!status || !codeEntry || !form || !done) return;

    const showOnly = (el) => {
        [codeEntry, form, done].forEach(e => { e.style.display = 'none'; });
        if (el) el.style.display = 'block';
    };

    const codeForm = document.getElementById('vote-code-form');
    if (codeForm) {
        codeForm.onsubmit = () => {
            const token = extractToken(document.getElementById('vote-code-input')?.value);
            if (!token) {
                status.textContent = 'Enter your voting link or code.';
                return;
            }
            window.location.hash = `#vote?t=${token}`;
        };
    }

    const token = getTokenFromHash();
    if (!token) {
        status.textContent = 'Enter your voting link or the code from your email to continue.';
        showOnly(codeEntry);
        return;
    }

    status.textContent = 'Loading your ballot...';
    showOnly(null);

    let ballot, election;
    try {
        const ballotSnap = await getDoc(doc(db, 'ballots', token));
        if (!ballotSnap.exists()) {
            status.textContent = 'This voting link is not valid. Check that you copied the whole link from your email.';
            showOnly(codeEntry);
            return;
        }
        ballot = ballotSnap.data();
        const electionSnap = await getDoc(doc(db, 'elections', ballot.electionId));
        if (!electionSnap.exists()) {
            status.textContent = 'This election no longer exists.';
            return;
        }
        election = electionSnap.data();
    } catch (e) {
        console.error('Ballot load failed:', e);
        status.textContent = 'Could not load your ballot. Check your connection and try again.';
        return;
    }

    const title = document.getElementById('vote-title');
    const subtitle = document.getElementById('vote-subtitle');
    if (title) title.textContent = election.title || 'Club Vote';
    const closes = election.closesAt?.toDate?.();
    if (subtitle && closes) subtitle.textContent = `Ballot closes ${closes.toLocaleString()}`;

    if (ballot.used) {
        status.textContent = '';
        done.textContent = '';
        const msg = document.createElement('p');
        msg.style.textAlign = 'center';
        msg.textContent = 'This ballot link has already been used. If this wasn\'t you, contact a club admin.';
        done.appendChild(msg);
        showOnly(done);
        return;
    }

    if (!isElectionOpen(election)) {
        status.textContent = 'Voting for this election is closed.';
        return;
    }

    renderBallotForm(election, ballot.electionId, token, status, form, done, showOnly);
}

function renderBallotForm(election, electionId, token, status, form, done, showOnly) {
    const container = document.getElementById('vote-positions');
    const submitBtn = document.getElementById('vote-submit');
    if (!container || !submitBtn) return;
    container.innerHTML = '';

    const positions = election.positions || [];
    positions.forEach((pos, pi) => {
        const max = pos.maxChoices || 1;
        const fieldset = document.createElement('fieldset');
        fieldset.style.cssText = 'border: 1px solid var(--glass-border); border-radius: 8px; padding: 0.75rem 1rem 1rem; margin-bottom: 1rem;';
        const legend = document.createElement('legend');
        legend.style.cssText = 'padding: 0 0.4rem; font-weight: 600;';
        legend.textContent = pos.title + (max > 1 ? ` (pick up to ${max})` : '');
        fieldset.appendChild(legend);

        // Bylaw amendments carry the section's current text and the proposed
        // change; show both above the Yes/No radios.
        if (pos.currentText || pos.description) {
            const ctx = document.createElement('div');
            ctx.style.cssText = 'font-size:0.85rem; line-height:1.5; margin-bottom:0.6rem;';
            if (pos.currentText) {
                const cur = document.createElement('p');
                cur.style.cssText = 'opacity:0.65; margin:0 0 0.4rem;';
                cur.appendChild(Object.assign(document.createElement('strong'), { textContent: 'Current: ' }));
                cur.appendChild(document.createTextNode(pos.currentText));
                ctx.appendChild(cur);
            }
            if (pos.description) {
                const prop = document.createElement('p');
                prop.style.cssText = 'margin:0; padding:0.5rem 0.6rem; border:1px solid var(--glass-border); border-radius:6px;';
                prop.appendChild(Object.assign(document.createElement('strong'), { textContent: 'Proposed: ' }));
                prop.appendChild(document.createTextNode(pos.description));
                ctx.appendChild(prop);
            }
            fieldset.appendChild(ctx);
        }

        (pos.candidates || []).forEach((cand, ci) => {
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.25rem; cursor: pointer; border-radius: 6px;';
            const input = document.createElement('input');
            input.type = max === 1 ? 'radio' : 'checkbox';
            input.name = `vote-pos-${pi}`;
            input.value = String(ci);
            input.style.cssText = 'width: 1.1rem; height: 1.1rem; accent-color: var(--accent-color); flex-shrink: 0;';
            if (max > 1) {
                input.onchange = () => {
                    const checked = container.querySelectorAll(`input[name="vote-pos-${pi}"]:checked`);
                    if (checked.length > max) {
                        input.checked = false;
                        status.textContent = `${pos.title}: pick at most ${max}.`;
                    }
                };
            }
            const span = document.createElement('span');
            span.textContent = cand;
            label.appendChild(input);
            label.appendChild(span);
            fieldset.appendChild(label);
        });
        container.appendChild(fieldset);
    });

    status.textContent = '';
    showOnly(form);

    submitBtn.onclick = async () => {
        const selections = [];
        let total = 0;
        positions.forEach((pos, pi) => {
            const checked = [...container.querySelectorAll(`input[name="vote-pos-${pi}"]:checked`)]
                .map(i => Number(i.value));
            selections.push(checked);
            total += checked.length;
        });
        if (total === 0) {
            status.textContent = 'Select at least one candidate. (A position left blank counts as an abstain.)';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.textContent = 'Submitting…';
        status.textContent = '';
        try {
            if (!crypto.subtle) throw new Error('Voting requires a secure (HTTPS) connection.');
            const receipt = await sha256Hex(token);
            const batch = writeBatch(db);
            batch.update(doc(db, 'ballots', token), { used: true, usedAt: serverTimestamp() });
            batch.set(doc(db, 'votes', receipt), {
                electionId,
                selections,
                submittedAt: serverTimestamp()
            });
            await Promise.race([
                batch.commit(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Submit timed out — check your connection.')), 20000))
            ]);

            status.textContent = '';
            done.textContent = '';
            const ok = document.createElement('p');
            ok.style.cssText = 'text-align:center; color:#22c55e; font-weight:600;';
            ok.textContent = 'Ballot recorded.';
            const rec = document.createElement('p');
            rec.style.cssText = 'text-align:center; font-size:0.85rem; opacity:0.75;';
            rec.textContent = 'Your anonymous receipt: ';
            const code = document.createElement('code');
            code.style.wordBreak = 'break-all';
            code.textContent = receipt;
            const tail = document.createElement('span');
            tail.textContent = ' — save it to verify your vote appears in the final tally.';
            rec.appendChild(code);
            rec.appendChild(tail);
            done.appendChild(ok);
            done.appendChild(rec);
            showOnly(done);
        } catch (e) {
            console.error('Ballot submit failed:', e);
            status.textContent = e.code === 'permission-denied'
                ? 'This ballot has already been used or voting is closed.'
                : `Could not submit your ballot (${e.code || e.message}). Try again.`;
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.textContent = 'Submit Ballot';
        }
    };
}

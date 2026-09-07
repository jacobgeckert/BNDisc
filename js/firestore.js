import { db } from './firebase-config.js?v=100';
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function isLeagueAdmin(email) {
    if (!email) {
        console.warn("isLeagueAdmin check: No email provided.");
        return { isAdmin: false, leagues: [] };
    }
    try {
        const cleanEmail = email.toLowerCase().trim();

        // 1. Try matching document ID first (lowercase email as ID)
        const leagueAdminDocRef = doc(db, "league_admins", cleanEmail);
        const docSnap = await getDoc(leagueAdminDocRef);
        if (docSnap.exists()) {
            return { isAdmin: true, leagues: docSnap.data().leagues || [] };
        }

        // 2. Fallback: scan collection for a matching 'email' field or case-insensitive doc ID
        const snap = await getDocs(collection(db, "league_admins"));
        const match = snap.docs.find(d => {
            const id = d.id.toLowerCase().trim();
            const field = (d.data().email || '').toString().toLowerCase().trim();
            return id === cleanEmail || field === cleanEmail;
        });

        if (match) {
            console.log("✅ League admin match found in Firestore!");
            return { isAdmin: true, leagues: match.data().leagues || [] };
        } else {
            console.warn(`❌ No document found in 'league_admins' for: "${cleanEmail}"`);
            return { isAdmin: false, leagues: [] };
        }
    } catch (error) {
        console.error("🔥 Firestore Error:", error.code, error.message);
        return { isAdmin: false, leagues: [] };
    }
}

// Used by the unauthenticated "first time setup" flow. Unlike isLeagueAdmin(),
// this only performs a direct get-by-ID lookup (no collection scan) so it only
// requires Firestore rules to allow a public `get` on a known document ID,
// not a public `list` of the whole collection. Errors are NOT swallowed here
// so the caller can tell "not on the allow-list" apart from a rules/permission problem.
export async function checkLeagueAdminEligibility(email) {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) return { isAdmin: false, leagues: [] };

    const leagueAdminDocRef = doc(db, "league_admins", cleanEmail);
    const docSnap = await getDoc(leagueAdminDocRef);
    if (docSnap.exists()) {
        return { isAdmin: true, leagues: docSnap.data().leagues || [] };
    }
    return { isAdmin: false, leagues: [] };
}

// Used by the unauthenticated "first time setup" flow. See checkLeagueAdminEligibility()
// above for why this exists separately from isAdmin().
export async function checkAdminEligibility(email) {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) return false;

    const adminDocRef = doc(db, "admins", cleanEmail);
    const docSnap = await getDoc(adminDocRef);
    return docSnap.exists();
}

export async function isAdmin(email) {
    if (!email) {
        console.warn("isAdmin check: No email provided.");
        return false;
    }
    try {
        const cleanEmail = email.toLowerCase().trim();
        console.log(`Checking Firestore for Document ID: "${cleanEmail}"`);
        
        const adminDocRef = doc(db, "admins", cleanEmail);
        const docSnap = await getDoc(adminDocRef);
        
        if (docSnap.exists()) {
            console.log("✅ Admin match found in Firestore!");
            return true;
        } else {
            console.warn(`❌ No document found in 'admin' collection with ID: "${cleanEmail}"`);
            return false;
        }
    } catch (error) {
        console.error("🔥 Firestore Error:", error.code, error.message);
        return false;
    }
}

const ROSTER_CACHE_KEY = 'bndisc_roster_cache';

export function saveLocalRoster(rosterData) {
    try {
        localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(rosterData));
    } catch (e) {
        console.warn('Could not save roster to localStorage:', e);
    }
}

export function getLocalRoster() {
    try {
        const raw = localStorage.getItem(ROSTER_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.warn('Could not read roster from localStorage:', e);
        return null;
    }
}

function getLastSaturdayCutoff() {
    const now = new Date();
    const day = now.getDay();
    const daysBack = (day - 6 + 7) % 7;
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - daysBack);
    cutoff.setHours(23, 59, 59, 999);
    if (cutoff > now) cutoff.setDate(cutoff.getDate() - 7);
    return cutoff;
}

export async function getRoster(force = false) {
    const local = getLocalRoster();
    const lastSaturday = getLastSaturdayCutoff();
    const localFresh = local && local.fetchedAt && new Date(local.fetchedAt) >= lastSaturday;

    const lastUpdateSnap = await getDoc(doc(db, 'players', 'lastUpdate'));
    const serverUpdatedAt = lastUpdateSnap.exists() ? lastUpdateSnap.data().updatedAt : null;

    if (!force && localFresh && (!serverUpdatedAt || local.importedAt === serverUpdatedAt)) {
        return { roster: local, source: 'local' };
    }

    const snap = await getDocs(collection(db, 'players'));
    const players = [];
    snap.forEach(docSnap => {
        if (docSnap.id === 'roster' || docSnap.id === 'lastImport' || docSnap.id === 'lastUpdate') return;
        const data = docSnap.data() || {};
        const rating = typeof data.currentRating === 'number' ? data.currentRating : (typeof data.initialRating === 'number' ? data.initialRating : null);
        const rawHdcp = rating != null ? (1005 - rating) / 12 : null;
        const hdcp = rawHdcp != null ? Math.ceil(rawHdcp * 2) / 2 : null;
        players.push({
            name: data.name || docSnap.id,
            currentRating: rating,
            hdcp,
            stats: data.stats || null
        });
    });

    players.sort((a, b) => a.name.localeCompare(b.name));

    const roster = {
        players,
        importedAt: serverUpdatedAt || new Date().toISOString(),
        fetchedAt: new Date().toISOString()
    };
    saveLocalRoster(roster);
    return { roster, source: 'firestore' };
}

const DOC_CACHE_PREFIX = 'bndisc_doc_cache_';
const DEFAULT_DOC_TTL_MS = 15 * 60 * 1000;
const pendingDocRequests = new Map();

function docCacheKey(collection, docId) {
    return `${DOC_CACHE_PREFIX}${collection}:${docId}`;
}

function readDocCache(collection, docId, ttlMs = DEFAULT_DOC_TTL_MS) {
    try {
        const raw = localStorage.getItem(docCacheKey(collection, docId));
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.fetchedAt !== 'number') return undefined;
        if (Date.now() - parsed.fetchedAt > ttlMs) return undefined;
        return { data: parsed.data, fetchedAt: parsed.fetchedAt };
    } catch (e) {
        console.warn('Could not read doc cache:', e);
        return undefined;
    }
}

function writeDocCache(collection, docId, data) {
    try {
        localStorage.setItem(docCacheKey(collection, docId), JSON.stringify({ data, fetchedAt: Date.now() }));
    } catch (e) {
        console.warn('Could not write doc cache:', e);
    }
}

async function fetchDocAndCache(collection, docId) {
    const key = docCacheKey(collection, docId);
    if (pendingDocRequests.has(key)) return pendingDocRequests.get(key);

    const promise = (async () => {
        try {
            const snap = await getDoc(doc(db, collection, docId));
            const data = snap.exists() ? snap.data() : null;
            writeDocCache(collection, docId, data);
            return data;
        } finally {
            pendingDocRequests.delete(key);
        }
    })();
    pendingDocRequests.set(key, promise);
    return promise;
}

export async function getCachedDoc(collection, docId, ttlMs = DEFAULT_DOC_TTL_MS) {
    const cached = readDocCache(collection, docId, ttlMs);
    if (cached !== undefined) {
        return { data: cached.data, source: 'cache' };
    }
    const data = await fetchDocAndCache(collection, docId);
    return { data, source: 'firestore' };
}

export async function refreshCachedDoc(collection, docId, ttlMs = DEFAULT_DOC_TTL_MS) {
    return fetchDocAndCache(collection, docId);
}

export function seedDocCache(collection, docId, data) {
    writeDocCache(collection, docId, data);
}
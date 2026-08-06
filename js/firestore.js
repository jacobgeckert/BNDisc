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

export async function getRoster(force = false) {
    const local = getLocalRoster();

    // If we have a cached roster and aren't forcing a refresh, return it without any Firestore call
    if (!force && local) {
        return { roster: local, source: 'local' };
    }

    const lastImportSnap = await getDoc(doc(db, 'players', 'lastImport'));
    const serverImportedAt = lastImportSnap.exists() ? lastImportSnap.data().importedAt : null;

    if (local && serverImportedAt && local.importedAt === serverImportedAt) {
        return { roster: local, source: 'local' };
    }

    const rosterSnap = await getDoc(doc(db, 'players', 'roster'));
    if (!rosterSnap.exists()) return null;

    const snapData = rosterSnap.data();
    const roster = {
        players: snapData.players || [],
        importedAt: snapData.importedAt || null
    };
    saveLocalRoster(roster);
    return { roster, source: 'firestore' };
}
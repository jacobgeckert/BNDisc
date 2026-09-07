import { auth } from './firebase-config.js?v=100';
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { isAdmin, checkAdminEligibility } from './firestore.js?v=147';
import { bindFirstTimeSetup } from './authSetup.js?v=100';

const provider = new GoogleAuthProvider();
let isChecking = false; // The Lock
let loginListenersBound = false;

function bindAdminLoginListeners() {
    if (loginListenersBound) return;
    loginListenersBound = true;

    const googleBtn = document.getElementById('admin-google-login-btn');
    if (googleBtn) {
        googleBtn.onclick = async () => {
            try {
                await signInWithPopup(auth, provider);
                // onAuthStateChanged in theme.js will re-run checkAdminAccess
            } catch (error) {
                console.error("Admin Google sign-in error:", error);
                alert(`Sign-in failed: ${error.message}`);
            }
        };
    }

    const emailForm = document.getElementById('admin-email-login-form');
    if (emailForm) {
        emailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('admin-email-input').value.trim();
            const password = document.getElementById('admin-password-input').value;
            if (!email || !password) return;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                // onAuthStateChanged in theme.js will re-run checkAdminAccess
            } catch (error) {
                console.error("Admin email sign-in error:", error);
                alert(`Sign-in failed: ${error.message}`);
            }
        });
    }

    bindFirstTimeSetup('admin', checkAdminEligibility);
}

export async function checkAdminAccess() {
    // If a check is already running, exit this function
    if (isChecking) return;
    isChecking = true;

    try {
        const adminContent = document.getElementById('admin-content');
        const adminLogin = document.getElementById('admin-login');
        if (adminContent) adminContent.style.display = 'none';
        if (adminLogin) adminLogin.style.display = 'block';

        bindAdminLoginListeners();

        const user = auth.currentUser;

        if (!user) {
            // Wait for the user to sign in via the Google button or email/password form.
            return;
        }

        const authorized = await isAdmin(user.email);

        if (authorized) {
            if (adminContent) adminContent.style.display = 'block';
            if (adminLogin) adminLogin.style.display = 'none';
        } else {
        alert(`Access Denied: ${user.email} is not authorized.`);
        
        // --- NEW: RE-HIDE THE LINK ---
        const adminLink = document.querySelector('.nav-links a[href="#admin"]');
        if (adminLink) {
            adminLink.classList.remove('unlocked');
        }

        await signOut(auth);
        window.location.hash = "#events";
        }
    } catch (error) {
        console.error("Auth process interrupted:", error);
        window.location.hash = "#events";
    } finally {
        // Release the lock after the process is done
        isChecking = false;
    }
}
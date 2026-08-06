/**
 * Shared "first time login" account setup flow.
 * Lets a user who is already on an authorization allow-list (Firestore)
 * claim their account by picking their own password, instead of an
 * admin having to manually create their Firebase Auth credentials.
 */
import { auth } from './firebase-config.js?v=100';
import {
    fetchSignInMethodsForEmail,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/**
 * @param {string} prefix - DOM id prefix, e.g. "admin" or "league".
 * @param {(email: string) => Promise<boolean>} checkAuthorized - resolves true if the email is allowed.
 */
export function bindFirstTimeSetup(prefix, checkAuthorized) {
    const firstTimeLink = document.getElementById(`${prefix}-first-time-link`);
    const backLink = document.getElementById(`${prefix}-back-to-login-link`);
    const loginForm = document.getElementById(`${prefix}-email-login-form`);
    const checkForm = document.getElementById(`${prefix}-setup-check-form`);
    const passwordForm = document.getElementById(`${prefix}-setup-password-form`);

    if (!firstTimeLink || !loginForm || !checkForm || !passwordForm) return;
    if (firstTimeLink.dataset.bound) return;
    firstTimeLink.dataset.bound = 'true';

    const firstTimePrompt = firstTimeLink.closest('p');
    let pendingEmail = '';

    const showLogin = () => {
        loginForm.style.display = '';
        if (firstTimePrompt) firstTimePrompt.style.display = '';
        checkForm.style.display = 'none';
        passwordForm.style.display = 'none';
        checkForm.reset();
        passwordForm.reset();
    };

    firstTimeLink.addEventListener('click', (e) => {
        e.preventDefault();
        const loginEmailInput = document.getElementById(`${prefix}-email-input`);
        const setupEmailInput = document.getElementById(`${prefix}-setup-email-input`);
        if (setupEmailInput && loginEmailInput?.value) {
            setupEmailInput.value = loginEmailInput.value;
        }
        loginForm.style.display = 'none';
        if (firstTimePrompt) firstTimePrompt.style.display = 'none';
        checkForm.style.display = '';
        passwordForm.style.display = 'none';
    });

    if (backLink) {
        backLink.addEventListener('click', (e) => {
            e.preventDefault();
            showLogin();
        });
    }

    checkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById(`${prefix}-setup-email-input`);
        const email = emailInput.value.trim().toLowerCase();
        if (!email) return;

        let authorized = false;
        try {
            authorized = await checkAuthorized(email);
        } catch (error) {
            console.error(`${prefix} first-time setup eligibility check error:`, error);
            if (error.code === 'permission-denied') {
                alert('Could not verify your account due to a Firestore permissions error. Ask the site admin to allow a public "get" read on this allow-list collection (see AGENTS.md / setup notes).');
            } else {
                alert(`Error checking authorization: ${error.message}`);
            }
            return;
        }

        if (!authorized) {
            alert(`"${email}" is not an authorized account. Contact the site admin to be added.`);
            return;
        }

        try {
            const methods = await fetchSignInMethodsForEmail(auth, email);
            if (methods.length > 0) {
                alert('An account already exists for this email. Please sign in instead.');
                const loginEmailInput = document.getElementById(`${prefix}-email-input`);
                if (loginEmailInput) loginEmailInput.value = email;
                showLogin();
                return;
            }

            pendingEmail = email;
            checkForm.style.display = 'none';
            passwordForm.style.display = '';
        } catch (error) {
            console.error(`${prefix} first-time setup check error:`, error);
            alert(`Error: ${error.message}`);
        }
    });

    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById(`${prefix}-setup-password-input`).value;
        const confirmPassword = document.getElementById(`${prefix}-setup-password-confirm-input`).value;

        if (password.length < 6) {
            alert('Password must be at least 6 characters.');
            return;
        }
        if (password !== confirmPassword) {
            alert('Passwords do not match.');
            return;
        }

        try {
            await createUserWithEmailAndPassword(auth, pendingEmail, password);
            // onAuthStateChanged elsewhere will pick up the newly signed-in user
            // and re-run the relevant access check.
            showLogin();
        } catch (error) {
            console.error(`${prefix} account creation error:`, error);
            alert(`Could not create account: ${error.message}`);
        }
    });
}

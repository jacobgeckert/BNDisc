import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZvz6xuQmNKsNzldihk3c5zN1gdZQx-DM",
  authDomain: "bndisc-4de3e.firebaseapp.com",
  projectId: "bndisc-4de3e",
  storageBucket: "bndisc-4de3e.firebasestorage.app",
  messagingSenderId: "898772949936",
  appId: "1:898772949936:web:225441a103e1eaf9585475"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
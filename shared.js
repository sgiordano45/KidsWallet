// KidsWallet Shared Utilities
// Firebase Auth + Firestore with multi-family support

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  updateDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

// ============================================
// FIREBASE INITIALIZATION
// ============================================

let app, db, auth;
let useFirebase = false;
let currentUser = null;
let familyId = null;
let walletId = 'main'; // Default wallet within family

// Auth state callbacks
const authCallbacks = [];

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  useFirebase = true;
  console.log('Firebase initialized');
} catch (error) {
  console.error('Firebase init failed:', error);
}

// ============================================
// AUTH FUNCTIONS
// ============================================

export function onAuthChange(callback) {
  authCallbacks.push(callback);
  // If we already know auth state, call immediately
  if (currentUser !== null || !useFirebase) {
    callback(currentUser);
  }
  return () => {
    const idx = authCallbacks.indexOf(callback);
    if (idx > -1) authCallbacks.splice(idx, 1);
  };
}

function notifyAuthCallbacks(user) {
  authCallbacks.forEach(cb => cb(user));
}

export async function signInWithGoogle() {
  if (!useFirebase) {
    console.error('Firebase not available');
    return null;
  }
  
  const provider = new GoogleAuthProvider();
  
  try {
    // Try popup first (works on desktop)
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      // Fallback to redirect (better for mobile/iPad)
      await signInWithRedirect(auth, provider);
      return null;
    }
    console.error('Sign in error:', error);
    throw error;
  }
}

export async function signOutUser() {
  if (!useFirebase) return;
  
  try {
    await signOut(auth);
    currentUser = null;
    familyId = null;
    notifyAuthCallbacks(null);
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function getFamilyId() {
  return familyId;
}

export function isAuthenticated() {
  return currentUser !== null;
}

// Initialize auth listener
if (useFirebase) {
  // Check for redirect result first
  getRedirectResult(auth).then((result) => {
    if (result?.user) {
      console.log('Redirect sign-in successful');
    }
  }).catch((error) => {
    console.error('Redirect result error:', error);
  });
  
  // Set up auth state listener
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      familyId = user.uid; // Family ID = user's UID
      
      // Ensure family document exists
      await ensureFamilyExists(user);
      
      // Check for data migration
      await migrateOldData(user);
      
      console.log('User signed in:', user.email);
    } else {
      currentUser = null;
      familyId = null;
      console.log('User signed out');
    }
    notifyAuthCallbacks(currentUser);
  });
}

// ============================================
// FAMILY MANAGEMENT
// ============================================

async function ensureFamilyExists(user) {
  if (!useFirebase || !user) return;
  
  try {
    const familyRef = doc(db, 'families', user.uid);
    const familySnap = await getDoc(familyRef);
    
    if (!familySnap.exists()) {
      // Create new family
      await setDoc(familyRef, {
        ownerUid: user.uid,
        ownerEmail: user.email,
        ownerName: user.displayName || 'Parent',
        name: `${user.displayName || 'My'}'s Family`,
        createdAt: serverTimestamp()
      });
      console.log('Created new family');
      
      // Create default wallet
      const walletRef = doc(db, 'families', user.uid, 'wallets', 'main');
      await setDoc(walletRef, {
        name: 'Main Wallet',
        balance: 0,
        totalDeposits: 0,
        totalSpent: 0,
        totalEarned: 0,
        totalInterest: 0,
        settings: {
          interestRate: 5,
          interestDay: 1,
          lastInterestDate: null,
          parentPin: null,
          kidPin: null,
          allowanceAmount: 5,
          allowanceFrequency: 'biweekly',
          lastAllowanceDate: null
        },
        createdAt: serverTimestamp()
      });
      console.log('Created default wallet');
    }
  } catch (error) {
    console.error('Error ensuring family exists:', error);
  }
}

async function migrateOldData(user) {
  if (!useFirebase || !user) return;
  
  try {
    // Check if old data exists at wallets/main_wallet
    const oldWalletRef = doc(db, 'wallets', 'main_wallet');
    const oldWalletSnap = await getDoc(oldWalletRef);
    
    if (oldWalletSnap.exists()) {
      console.log('Found old data, migrating...');
      
      const oldData = oldWalletSnap.data();
      const newWalletRef = doc(db, 'families', user.uid, 'wallets', 'main');
      
      // Check if new location already has data
      const newWalletSnap = await getDoc(newWalletRef);
      
      if (!newWalletSnap.exists() || newWalletSnap.data().balance === 0) {
        // Migrate wallet data
        await setDoc(newWalletRef, {
          ...oldData,
          migratedAt: serverTimestamp()
        }, { merge: true });
        
        // Migrate transactions
        const oldTxQuery = query(
          collection(db, 'wallets', 'main_wallet', 'transactions'),
          orderBy('date', 'desc')
        );
        const oldTxSnap = await getDocs(oldTxQuery);
        
        const batch = writeBatch(db);
        oldTxSnap.forEach((txDoc) => {
          const newTxRef = doc(db, 'families', user.uid, 'wallets', 'main', 'transactions', txDoc.id);
          batch.set(newTxRef, txDoc.data());
        });
        
        // Migrate goals
        const oldGoalsQuery = query(
          collection(db, 'wallets', 'main_wallet', 'goals'),
          orderBy('createdAt', 'desc')
        );
        const oldGoalsSnap = await getDocs(oldGoalsQuery);
        
        oldGoalsSnap.forEach((goalDoc) => {
          const newGoalRef = doc(db, 'families', user.uid, 'wallets', 'main', 'goals', goalDoc.id);
          batch.set(newGoalRef, goalDoc.data());
        });
        
        await batch.commit();
        console.log('Migration complete');
        
        // Optionally delete old data (commented out for safety)
        // await deleteDoc(oldWalletRef);
      }
    }
  } catch (error) {
    console.error('Migration error:', error);
  }
}

export async function getFamilyInfo() {
  if (!useFirebase || !familyId) return null;
  
  try {
    const familyRef = doc(db, 'families', familyId);
    const familySnap = await getDoc(familyRef);
    return familySnap.exists() ? familySnap.data() : null;
  } catch (error) {
    console.error('Error getting family info:', error);
    return null;
  }
}

export async function updateFamilyInfo(updates) {
  if (!useFirebase || !familyId) return;
  
  try {
    const familyRef = doc(db, 'families', familyId);
    await updateDoc(familyRef, updates);
  } catch (error) {
    console.error('Error updating family info:', error);
  }
}

// ============================================
// PATH HELPERS
// ============================================

function getWalletPath() {
  if (!familyId) return null;
  return `families/${familyId}/wallets/${walletId}`;
}

function getWalletRef() {
  if (!useFirebase || !familyId) return null;
  return doc(db, 'families', familyId, 'wallets', walletId);
}

function getTransactionsRef() {
  if (!useFirebase || !familyId) return null;
  return collection(db, 'families', familyId, 'wallets', walletId, 'transactions');
}

function getGoalsRef() {
  if (!useFirebase || !familyId) return null;
  return collection(db, 'families', familyId, 'wallets', walletId, 'goals');
}

// ============================================
// LOCAL STORAGE HELPERS
// ============================================

function getStorageKey(key) {
  // Include familyId in storage key for multi-family support
  const prefix = familyId ? `kidswallet_${familyId}_` : 'kidswallet_';
  return `${prefix}${key}`;
}

export function getLocalData(key, defaultValue = null) {
  try {
    const data = localStorage.getItem(getStorageKey(key));
    return data ? JSON.parse(data) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setLocalData(key, value) {
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(value));
  } catch (error) {
    console.error('localStorage save failed:', error);
  }
}

// ============================================
// WALLET DATA
// ============================================

const defaultWalletState = {
  balance: 0,
  totalDeposits: 0,
  totalSpent: 0,
  totalEarned: 0,
  totalInterest: 0,
  settings: {
    interestRate: 5,
    interestDay: 1,
    lastInterestDate: null,
    parentPin: null,
    kidPin: null,
    allowanceAmount: 5,
    allowanceFrequency: 'biweekly',
    lastAllowanceDate: null
  }
};

export async function getWalletData() {
  if (useFirebase && familyId) {
    try {
      const walletRef = getWalletRef();
      const docSnap = await getDoc(walletRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setLocalData('wallet', data);
        return data;
      }
    } catch (error) {
      console.log('Firebase read failed, using local:', error);
    }
  }
  
  return getLocalData('wallet', defaultWalletState);
}

export async function updateWalletData(updates) {
  const current = await getWalletData();
  const updated = { ...current, ...updates, lastUpdated: new Date().toISOString() };
  
  setLocalData('wallet', updated);
  
  if (useFirebase && familyId) {
    try {
      const walletRef = getWalletRef();
      await setDoc(walletRef, { ...updated, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.log('Firebase update failed:', error);
    }
  }
  
  return updated;
}

export function subscribeToWallet(callback) {
  if (!useFirebase || !familyId) {
    getWalletData().then(callback);
    return () => {};
  }
  
  const walletRef = getWalletRef();
  return onSnapshot(walletRef, (doc) => {
    if (doc.exists()) {
      const data = doc.data();
      setLocalData('wallet', data);
      callback(data);
    }
  }, (error) => {
    console.log('Wallet subscription error:', error);
    getWalletData().then(callback);
  });
}

// ============================================
// TRANSACTIONS
// ============================================

export async function getTransactions() {
  if (useFirebase && familyId) {
    try {
      const txRef = getTransactionsRef();
      const q = query(txRef, orderBy('date', 'desc'));
      const snapshot = await getDocs(q); // FIXED: was getDoc
      const transactions = [];
      snapshot.forEach(doc => {
        transactions.push({ id: doc.id, ...doc.data() });
      });
      setLocalData('transactions', transactions);
      return transactions;
    } catch (error) {
      console.log('Firebase transactions read failed:', error);
    }
  }
  
  return getLocalData('transactions', []);
}

export async function addTransaction(transaction) {
  const tx = {
    ...transaction,
    date: transaction.date || new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  
  const transactions = getLocalData('transactions', []);
  const localTx = { ...tx, id: `local_${Date.now()}` };
  transactions.unshift(localTx);
  setLocalData('transactions', transactions);
  
  if (useFirebase && familyId) {
    try {
      const txRef = getTransactionsRef();
      const docRef = await addDoc(txRef, { ...tx, createdAt: serverTimestamp() });
      localTx.id = docRef.id;
      setLocalData('transactions', transactions);
      return docRef.id;
    } catch (error) {
      console.log('Firebase transaction add failed:', error);
    }
  }
  
  return localTx.id;
}

export async function updateTransaction(transactionId, updates) {
  const transactions = getLocalData('transactions', []);
  const index = transactions.findIndex(tx => tx.id === transactionId);
  if (index !== -1) {
    transactions[index] = { ...transactions[index], ...updates, updatedAt: new Date().toISOString() };
    setLocalData('transactions', transactions);
  }
  
  if (useFirebase && familyId && !transactionId.startsWith('local_')) {
    try {
      const txRef = doc(db, 'families', familyId, 'wallets', walletId, 'transactions', transactionId);
      await updateDoc(txRef, { ...updates, updatedAt: serverTimestamp() });
    } catch (error) {
      console.log('Firebase transaction update failed:', error);
    }
  }
}

export async function deleteTransaction(transactionId) {
  const transactions = getLocalData('transactions', []);
  const filtered = transactions.filter(tx => tx.id !== transactionId);
  setLocalData('transactions', filtered);
  
  if (useFirebase && familyId && !transactionId.startsWith('local_')) {
    try {
      await deleteDoc(doc(db, 'families', familyId, 'wallets', walletId, 'transactions', transactionId));
    } catch (error) {
      console.log('Firebase transaction delete failed:', error);
    }
  }
}

export function subscribeToTransactions(callback) {
  if (!useFirebase || !familyId) {
    callback(getLocalData('transactions', []));
    return () => {};
  }
  
  const txRef = getTransactionsRef();
  const q = query(txRef, orderBy('date', 'desc'));
  
  return onSnapshot(q, (snapshot) => {
    const transactions = [];
    snapshot.forEach(doc => {
      transactions.push({ id: doc.id, ...doc.data() });
    });
    setLocalData('transactions', transactions);
    callback(transactions);
  }, (error) => {
    console.log('Transactions subscription error:', error);
    callback(getLocalData('transactions', []));
  });
}

// ============================================
// SAVINGS GOALS
// ============================================

export async function getGoals() {
  if (useFirebase && familyId) {
    try {
      const goalsRef = getGoalsRef();
      const q = query(goalsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q); // FIXED: was getDoc
      const goals = [];
      snapshot.forEach(doc => {
        goals.push({ id: doc.id, ...doc.data() });
      });
      setLocalData('goals', goals);
      return goals;
    } catch (error) {
      console.log('Firebase goals read failed:', error);
    }
  }
  
  return getLocalData('goals', []);
}

export async function addGoal(goal) {
  const g = {
    ...goal,
    createdAt: new Date().toISOString(),
    completed: false
  };
  
  const goals = getLocalData('goals', []);
  const localGoal = { ...g, id: `local_${Date.now()}` };
  goals.unshift(localGoal);
  setLocalData('goals', goals);
  
  if (useFirebase && familyId) {
    try {
      const goalsRef = getGoalsRef();
      const docRef = await addDoc(goalsRef, { ...g, createdAt: serverTimestamp() });
      localGoal.id = docRef.id;
      setLocalData('goals', goals);
      return docRef.id;
    } catch (error) {
      console.log('Firebase goal add failed:', error);
    }
  }
  
  return localGoal.id;
}

export async function updateGoal(goalId, updates) {
  const goals = getLocalData('goals', []);
  const index = goals.findIndex(g => g.id === goalId);
  if (index !== -1) {
    goals[index] = { ...goals[index], ...updates };
    setLocalData('goals', goals);
  }
  
  if (useFirebase && familyId && !goalId.startsWith('local_')) {
    try {
      await updateDoc(doc(db, 'families', familyId, 'wallets', walletId, 'goals', goalId), updates);
    } catch (error) {
      console.log('Firebase goal update failed:', error);
    }
  }
}

export async function deleteGoal(goalId) {
  const goals = getLocalData('goals', []);
  const filtered = goals.filter(g => g.id !== goalId);
  setLocalData('goals', filtered);
  
  if (useFirebase && familyId && !goalId.startsWith('local_')) {
    try {
      await deleteDoc(doc(db, 'families', familyId, 'wallets', walletId, 'goals', goalId));
    } catch (error) {
      console.log('Firebase goal delete failed:', error);
    }
  }
}

export function subscribeToGoals(callback) {
  if (!useFirebase || !familyId) {
    callback(getLocalData('goals', []));
    return () => {};
  }
  
  const goalsRef = getGoalsRef();
  const q = query(goalsRef, orderBy('createdAt', 'desc'));
  
  return onSnapshot(q, (snapshot) => {
    const goals = [];
    snapshot.forEach(doc => {
      goals.push({ id: doc.id, ...doc.data() });
    });
    setLocalData('goals', goals);
    callback(goals);
  }, (error) => {
    console.log('Goals subscription error:', error);
    callback(getLocalData('goals', []));
  });
}

// ============================================
// UI HELPERS
// ============================================

export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast active ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(amount || 0);
}

export function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

export function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// ============================================
// INTEREST CALCULATION
// ============================================

export function shouldApplyInterest(settings) {
  if (!settings?.interestRate) return false;
  
  const now = new Date();
  const today = now.getDate();
  const interestDay = settings.interestDay || 1;
  
  if (today !== interestDay) return false;
  
  if (settings.lastInterestDate) {
    const lastDate = new Date(settings.lastInterestDate);
    if (lastDate.getMonth() === now.getMonth() && 
        lastDate.getFullYear() === now.getFullYear()) {
      return false;
    }
  }
  
  return true;
}

export function calculateInterest(balance, rate) {
  return balance * (rate / 100);
}

// ============================================
// AUTH UI HELPER
// ============================================

export function requireAuth(onAuthenticated, onUnauthenticated) {
  if (!useFirebase) {
    // No Firebase = no auth required, proceed
    onAuthenticated(null);
    return () => {};
  }
  
  return onAuthChange((user) => {
    if (user) {
      onAuthenticated(user);
    } else {
      onUnauthenticated();
    }
  });
}

// Export Firebase availability
export { useFirebase, db, auth };

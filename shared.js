// KidsWallet Shared Utilities
// Firebase and common state management

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAavO4IE21FEwBeY7fuFdBFYc9dflpLk90",
  authDomain: "kidswallet-406a6.firebaseapp.com",
  projectId: "kidswallet-406a6",
  storageBucket: "kidswallet-406a6.firebasestorage.app",
  messagingSenderId: "367658453381",
  appId: "1:367658453381:web:790006549937f9f7fc5cec"
};

// Initialize Firebase
let app, db;
let useFirebase = false;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  useFirebase = true;
  console.log('Firebase initialized');
} catch (error) {
  console.log('Firebase init failed, using localStorage only', error);
}

// Wallet ID
const WALLET_ID = 'main_wallet';

// ============================================
// LOCAL STORAGE HELPERS
// ============================================

export function getLocalData(key, defaultValue = null) {
  try {
    const data = localStorage.getItem(`kidswallet_${key}`);
    return data ? JSON.parse(data) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setLocalData(key, value) {
  try {
    localStorage.setItem(`kidswallet_${key}`, JSON.stringify(value));
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
  totalInterest: 0,
  settings: {
    interestRate: 5,
    interestDay: 1, // Day of month (1 = 1st)
    lastInterestDate: null,
    parentPin: null,
    allowanceAmount: 5,
    allowanceFrequency: 'biweekly',
    lastAllowanceDate: null
  }
};

export async function getWalletData() {
  // Try Firebase first
  if (useFirebase) {
    try {
      const docRef = doc(db, 'wallets', WALLET_ID);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setLocalData('wallet', data); // Sync to local
        return data;
      }
    } catch (error) {
      console.log('Firebase read failed, using local:', error);
    }
  }
  
  // Fallback to localStorage
  return getLocalData('wallet', defaultWalletState);
}

export async function updateWalletData(updates) {
  // Get current data
  const current = await getWalletData();
  const updated = { ...current, ...updates, lastUpdated: new Date().toISOString() };
  
  // Save locally first
  setLocalData('wallet', updated);
  
  // Try Firebase
  if (useFirebase) {
    try {
      const docRef = doc(db, 'wallets', WALLET_ID);
      await setDoc(docRef, { ...updated, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.log('Firebase update failed:', error);
    }
  }
  
  return updated;
}

export function subscribeToWallet(callback) {
  if (!useFirebase) {
    // No real-time updates for localStorage, just call once
    getWalletData().then(callback);
    return () => {};
  }
  
  const docRef = doc(db, 'wallets', WALLET_ID);
  return onSnapshot(docRef, (doc) => {
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
  if (useFirebase) {
    try {
      const q = query(
        collection(db, 'wallets', WALLET_ID, 'transactions'),
        orderBy('date', 'desc')
      );
      const snapshot = await getDoc(q);
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
  
  // Add to local
  const transactions = getLocalData('transactions', []);
  const localTx = { ...tx, id: `local_${Date.now()}` };
  transactions.unshift(localTx);
  setLocalData('transactions', transactions);
  
  // Try Firebase
  if (useFirebase) {
    try {
      const colRef = collection(db, 'wallets', WALLET_ID, 'transactions');
      const docRef = await addDoc(colRef, { ...tx, createdAt: serverTimestamp() });
      // Update local with real ID
      localTx.id = docRef.id;
      setLocalData('transactions', transactions);
      return docRef.id;
    } catch (error) {
      console.log('Firebase transaction add failed:', error);
    }
  }
  
  return localTx.id;
}

export async function deleteTransaction(transactionId) {
  // Remove from local
  const transactions = getLocalData('transactions', []);
  const filtered = transactions.filter(tx => tx.id !== transactionId);
  setLocalData('transactions', filtered);
  
  // Try Firebase
  if (useFirebase && !transactionId.startsWith('local_')) {
    try {
      await deleteDoc(doc(db, 'wallets', WALLET_ID, 'transactions', transactionId));
    } catch (error) {
      console.log('Firebase transaction delete failed:', error);
    }
  }
}

export function subscribeToTransactions(callback) {
  if (!useFirebase) {
    callback(getLocalData('transactions', []));
    return () => {};
  }
  
  const q = query(
    collection(db, 'wallets', WALLET_ID, 'transactions'),
    orderBy('date', 'desc')
  );
  
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
  if (useFirebase) {
    try {
      const q = query(
        collection(db, 'wallets', WALLET_ID, 'goals'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDoc(q);
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
  
  // Add to local
  const goals = getLocalData('goals', []);
  const localGoal = { ...g, id: `local_${Date.now()}` };
  goals.unshift(localGoal);
  setLocalData('goals', goals);
  
  // Try Firebase
  if (useFirebase) {
    try {
      const colRef = collection(db, 'wallets', WALLET_ID, 'goals');
      const docRef = await addDoc(colRef, { ...g, createdAt: serverTimestamp() });
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
  // Update local
  const goals = getLocalData('goals', []);
  const index = goals.findIndex(g => g.id === goalId);
  if (index !== -1) {
    goals[index] = { ...goals[index], ...updates };
    setLocalData('goals', goals);
  }
  
  // Try Firebase
  if (useFirebase && !goalId.startsWith('local_')) {
    try {
      await updateDoc(doc(db, 'wallets', WALLET_ID, 'goals', goalId), updates);
    } catch (error) {
      console.log('Firebase goal update failed:', error);
    }
  }
}

export async function deleteGoal(goalId) {
  // Remove from local
  const goals = getLocalData('goals', []);
  const filtered = goals.filter(g => g.id !== goalId);
  setLocalData('goals', filtered);
  
  // Try Firebase
  if (useFirebase && !goalId.startsWith('local_')) {
    try {
      await deleteDoc(doc(db, 'wallets', WALLET_ID, 'goals', goalId));
    } catch (error) {
      console.log('Firebase goal delete failed:', error);
    }
  }
}

export function subscribeToGoals(callback) {
  if (!useFirebase) {
    callback(getLocalData('goals', []));
    return () => {};
  }
  
  const q = query(
    collection(db, 'wallets', WALLET_ID, 'goals'),
    orderBy('createdAt', 'desc')
  );
  
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
  }).format(amount);
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

// ============================================
// INTEREST CALCULATION
// ============================================

export function shouldApplyInterest(settings) {
  if (!settings?.interestRate) return false;
  
  const now = new Date();
  const today = now.getDate();
  const interestDay = settings.interestDay || 1;
  
  // Check if it's the interest day
  if (today !== interestDay) return false;
  
  // Check if we already applied interest this month
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
  // Monthly compound interest
  return balance * (rate / 100);
}

// Export Firebase availability
export { useFirebase };

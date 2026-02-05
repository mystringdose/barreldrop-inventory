import { writable } from "svelte/store";
import { api } from "./api.js";

export const authStore = writable({ user: null, loading: true, error: null });

export async function loadCurrentUser() {
  authStore.update((state) => ({ ...state, loading: true }));
  try {
    const { user } = await api.me();
    authStore.set({ user, loading: false, error: null });
    if (user?.forcePasswordChange) {
      location.hash = "#/change-password";
    }
  } catch (err) {
    authStore.set({ user: null, loading: false, error: null });
  }
}

export async function login(email, password) {
  authStore.update((state) => ({ ...state, loading: true, error: null }));
  try {
    const { user } = await api.login(email, password);
    authStore.set({ user, loading: false, error: null });
  } catch (err) {
    authStore.set({ user: null, loading: false, error: err.message || "Login failed" });
  }
}

export async function logout() {
  await api.logout();
  authStore.set({ user: null, loading: false, error: null });
}

<script>
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api.js";
  import { authStore } from "../lib/stores.js";
  import { get } from "svelte/store";

  let users = [];
  let loading = true;
  let error = "";

  let authUnsub = null;
  let authTimeout = null;
  let accessDenied = false;

  let name = "";
  let email = "";
  let password = "";
  let role = "user";

  // cursor pagination state
  let limit = 20;
  let nextCursor = null;
  let prevCursor = null;
  let cursorStack = [];
  let currentCursor = null;

  async function deleteUser(userToDelete) {
    if (!confirm(`Delete user ${userToDelete.name}? This cannot be undone.`)) return;
    try {
      await api.deleteUser(userToDelete._id);
      await load({ resetStack: true });
    } catch (err) {
      error = err.message || "Unable to delete user.";
    }
  }

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const params = { limit };
      if (cursorParam) params.cursor = cursorParam;
      if (direction) params.direction = direction;
      const res = await api.getUsers(params);
      users = res.users || [];
      nextCursor = res.nextCursor || null;
      prevCursor = res.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }
    } catch (err) {
      error = err.message || "Unable to load users.";
    } finally {
      loading = false;
    }
  }

  async function createUser() {
    try {
      await api.createUser({ name, email, password, role });
      name = "";
      email = "";
      password = "";
      role = "user";
      await load();
    } catch (err) {
      error = err.message || "Unable to create user.";
    }
  }

  async function toggleActive(user) {
    await api.updateUser(user._id, { active: !user.active });
    await load();
  }

  onMount(() => {
    const state = get(authStore);
    // If auth already loaded and user isn't admin, show access denied and redirect
    if (!state.loading && state.user?.role !== "admin") {
      redirectToHome();
      return;
    }

    // Fallback timeout: if auth remains loading for too long, redirect to avoid lockup
    authTimeout = setTimeout(() => {
      const s = get(authStore);
      if (s.loading) {
        console.warn("Auth still loading after timeout; redirecting away from Users page");
        error = "Unable to verify session. Redirecting...";
        redirectToHome();
      }
    }, 10000);

    // Wait for auth to finish loading
    authUnsub = authStore.subscribe((s) => {
      if (!s.loading) {
        clearTimeout(authTimeout);
        if (s.user?.role !== "admin") {
          redirectToHome();
        } else {
          load({ resetStack: true });
        }
        // unsubscribe
        if (authUnsub) authUnsub();
      }
    });
  });

  onDestroy(() => {
    if (authUnsub) authUnsub();
    if (authTimeout) clearTimeout(authTimeout);
  });

  function redirectToHome() {
    accessDenied = true;
    error = "Access denied — redirecting...";
    setTimeout(() => {
      location.hash = "#/";
    }, 1500);
  }
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Users</h2>

{#if accessDenied}
  <div class="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 mb-4">Access denied — redirecting...</div>
{/if}

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <h3 class="font-semibold text-slate-900 mb-2">Add User</h3>
  <div class="grid md:grid-cols-4 gap-3 text-sm">
    <input class="border rounded px-3 py-2" placeholder="Name" bind:value={name} />
    <input class="border rounded px-3 py-2" placeholder="Email" type="email" bind:value={email} />
    <input class="border rounded px-3 py-2" placeholder="Password" type="password" bind:value={password} />
    <select class="border rounded px-3 py-2" bind:value={role}>
      <option value="user">User</option>
      <option value="admin">Admin</option>
    </select>
  </div>
  <button class="mt-3 bg-slate-900 text-white px-4 py-2 rounded" on:click={createUser}>
    Save User
  </button>
</div>

{#if loading}
  <p class="text-slate-500">Loading...</p>
{:else if error}
  <p class="text-rose-600">{error}</p>
{:else}
  <div class="bg-white rounded shadow-sm">
    <div class="p-4 flex gap-3 items-center">
      <label class="text-sm">Per page</label>
      <input class="border rounded px-3 py-1 w-20 text-sm" type="number" min="1" bind:value={limit} on:change={() => load({ resetStack: true })} />
      <div class="ml-auto text-sm text-slate-500">{#if !currentCursor}Newest{:else}Page{/if} • {users.length} users</div>
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-100 text-slate-600">
        <tr>
          <th class="text-left px-3 py-2">Name</th>
          <th class="text-left px-3 py-2">Email</th>
          <th class="text-left px-3 py-2">Role</th>
          <th class="text-left px-3 py-2">Active</th>
          <th class="text-left px-3 py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each users as user}
          <tr class="border-t">
            <td class="px-3 py-2">{user.name}</td>
            <td class="px-3 py-2">{user.email}</td>
            <td class="px-3 py-2 capitalize">{user.role}</td>
            <td class="px-3 py-2">{user.active ? "Yes" : "No"}</td>
            <td class="px-3 py-2">
              <button class="text-xs border rounded px-2 py-1" on:click={() => toggleActive(user)}>
                {user.active ? "Deactivate" : "Activate"}
              </button>
              {#if $authStore.user?.role === "admin"}
                <button
                  class="text-xs border rounded px-2 py-1 ml-2 text-rose-600"
                  on:click={() => deleteUser(user)}
                  disabled={user._id === $authStore.user?.id}
                  title={user._id === $authStore.user?.id ? "You cannot delete your own account" : "Delete user"}
                >
                  Delete
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="p-3 flex justify-between">
      <button class="px-3 py-2 border rounded" on:click={() => {
        if (cursorStack.length === 0 && !prevCursor) return;
        const previous = cursorStack.length ? cursorStack.pop() : prevCursor;
        currentCursor = previous || null;
        load({ cursorParam: previous, direction: previous ? 'prev' : 'prev' });
      }} disabled={cursorStack.length === 0 && !prevCursor}>Previous</button>
      <button class="px-3 py-2 border rounded" on:click={() => {
        if (!nextCursor) return;
        cursorStack.push(currentCursor);
        currentCursor = nextCursor;
        load({ cursorParam: nextCursor, direction: 'next' });
      }} disabled={!nextCursor}>Next</button>
    </div>
  </div>
{/if}

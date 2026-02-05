<script>
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api.js";
  import { authStore } from "../lib/stores.js";
  import { get } from "svelte/store";

  let logs = [];
  let loading = true;
  let error = "";

  let action = "";
  let actor = "";
  let limit = 20;
  let start = "";
  let end = "";

  // Cursor-based paging state
  let nextCursor = null;
  let prevCursor = null; // returned by server but we rely primarily on a simple stack for prev navigation
  let cursorStack = []; // previous cursors for back navigation
  let currentCursor = null; // the cursor used to load the current page; null for newest

  let authUnsub = null;
  let authTimeout = null;
  let accessDenied = false;

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const params = { action: action || undefined, actor: actor || undefined, limit };
      if (start) params.start = start;
      if (end) params.end = end;
      if (cursorParam) params.cursor = cursorParam;
      if (direction) params.direction = direction;
      const res = await api.getAudit(params);
      logs = res.logs || [];
      nextCursor = res.nextCursor || null;
      prevCursor = res.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }
    } catch (err) {
      error = err.message || "Unable to load audit logs.";
    } finally {
      loading = false;
    }
  }

  function prev() {
    if (cursorStack.length === 0) {
      // If no stack, and we have a prevCursor, try using it (edge case)
      if (!prevCursor) return;
      load({ cursorParam: prevCursor, direction: "prev" });
      currentCursor = prevCursor;
      return;
    }

    const previous = cursorStack.pop();
    currentCursor = previous || null;
    const direction = previous ? "prev" : undefined;
    load({ cursorParam: previous, direction });
  }

  function next() {
    if (!nextCursor) return;
    cursorStack.push(currentCursor);
    currentCursor = nextCursor;
    load({ cursorParam: nextCursor, direction: "next" });
  }

  onMount(() => {
    const state = get(authStore);
    if (!state.loading && state.user?.role !== "admin") {
      redirectToHome();
      return;
    }

    authTimeout = setTimeout(() => {
      const s = get(authStore);
      if (s.loading) {
        error = "Unable to verify session. Redirecting...";
        redirectToHome();
      }
    }, 10000);

    authUnsub = authStore.subscribe((s) => {
      if (!s.loading) {
        clearTimeout(authTimeout);
        if (s.user?.role !== "admin") {
          redirectToHome();
        } else {
          load({ resetStack: true });
        }
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
    }, 1200);
  }
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Audit Logs</h2>

{#if accessDenied}
  <div class="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 mb-4">Access denied — redirecting...</div>
{/if}

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <div class="flex gap-3 items-center flex-wrap">
    <input class="border rounded px-3 py-2 text-sm" placeholder="Action (e.g. user.create)" bind:value={action} />
    <input class="border rounded px-3 py-2 text-sm" placeholder="Actor email" bind:value={actor} />
    <input class="border rounded px-3 py-2 text-sm" type="date" bind:value={start} title="Start date" />
    <input class="border rounded px-3 py-2 text-sm" type="date" bind:value={end} title="End date" />
    <input class="border rounded px-3 py-2 w-24 text-sm" type="number" min="1" bind:value={limit} />
    <button class="bg-slate-900 text-white px-3 py-2 rounded text-sm" on:click={() => { load({ cursorParam: null, direction: undefined, resetStack: true }); }}>Search</button>
    <div class="ml-auto text-sm text-slate-500">{#if !currentCursor}Newest{:else}Page{/if} • Showing {logs.length} items</div>
  </div>
</div>

{#if loading}
  <p class="text-slate-500">Loading...</p>
{:else if error}
  <p class="text-rose-600">{error}</p>
{:else}
  <div class="bg-white rounded shadow-sm">
    <table class="w-full text-sm">
      <thead class="bg-slate-100 text-slate-600">
        <tr>
          <th class="text-left px-3 py-2">Time</th>
          <th class="text-left px-3 py-2">Action</th>
          <th class="text-left px-3 py-2">Actor</th>
          <th class="text-left px-3 py-2">Target</th>
          <th class="text-left px-3 py-2">IP</th>
          <th class="text-left px-3 py-2">Meta</th>
        </tr>
      </thead>
      <tbody>
        {#each logs as log}
          <tr class="border-t align-top">
            <td class="px-3 py-2">{new Date(log.createdAt).toLocaleString()}</td>
            <td class="px-3 py-2">{log.action}</td>
            <td class="px-3 py-2">{log.actor?.email || log.actorId || 'system'}</td>
            <td class="px-3 py-2">{log.targetType}{log.targetId ? ` / ${log.targetId}` : ''}</td>
            <td class="px-3 py-2">{log.ip || ''}</td>
            <td class="px-3 py-2"><pre class="text-xs whitespace-pre-wrap">{JSON.stringify(log.meta || {}, null, 2)}</pre></td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="p-3 flex justify-between">
      <button class="px-3 py-2 border rounded" on:click={prev} disabled={cursorStack.length === 0 && !prevCursor}>Previous</button>
      <button class="px-3 py-2 border rounded" on:click={next} disabled={!nextCursor}>Next</button>
    </div>
  </div>
{/if}

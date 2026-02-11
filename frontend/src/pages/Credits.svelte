<script>
  import { onDestroy, onMount } from "svelte";
  import { api } from "../lib/api.js";

  let credits = [];
  let error = "";
  let loading = true;
  let creating = false;
  let convertingId = null;

  // cursor pagination for credits
  let limit = 20;
  let nextCursor = null;
  let prevCursor = null;
  let cursorStack = [];
  let currentCursor = null;

  let start = "";
  let end = "";
  let status = "all";

  let customerName = "";
  let customerContact = "";
  let notes = "";

  let lineItemId = "";
  let lineItemSearch = "";
  let lineQty = "";
  let creditLines = [];

  const ITEM_SEARCH_LIMIT = 20;
  const ITEM_SEARCH_DEBOUNCE_MS = 250;

  let selectedItem = null;
  let showItemResults = false;
  let itemResults = [];
  let itemSearchLoading = false;
  let itemSearchError = "";
  let highlightedItemIndex = -1;
  let itemSearchTimer = null;
  let latestItemSearchId = 0;

  $: selectedSellingPrice = Number(selectedItem?.sellingPrice ?? 0);

  function itemLabel(item) {
    return `${item.name} (${item.sku})`;
  }

  function itemsSummary(items) {
    if (!items || items.length === 0) return "";
    return items
      .map((line) => {
        const name = (line.item && line.item.name) ? line.item.name : (line.item || line.itemId);
        return `${name} x${line.quantity}`;
      })
      .join(", ");
  }

  function doneByLabel(credit) {
    if (credit?.createdBy?.name) return credit.createdBy.name;
    if (credit?.createdBy?.email) return credit.createdBy.email;
    return "—";
  }

  async function runItemSearch(rawTerm = lineItemSearch) {
    const term = String(rawTerm || "").trim();
    const requestId = ++latestItemSearchId;
    itemSearchLoading = true;
    itemSearchError = "";

    try {
      const res = await api.getItems({ limit: ITEM_SEARCH_LIMIT, q: term });
      if (requestId !== latestItemSearchId) return;

      itemResults = res.items || [];
      highlightedItemIndex = itemResults.length ? 0 : -1;
    } catch (err) {
      if (requestId !== latestItemSearchId) return;
      itemResults = [];
      highlightedItemIndex = -1;
      itemSearchError = err.message || "Unable to search items.";
    } finally {
      if (requestId === latestItemSearchId) {
        itemSearchLoading = false;
      }
    }
  }

  function queueItemSearch(rawTerm = lineItemSearch) {
    if (itemSearchTimer) clearTimeout(itemSearchTimer);
    itemSearchTimer = setTimeout(() => {
      runItemSearch(rawTerm);
    }, ITEM_SEARCH_DEBOUNCE_MS);
  }

  function onItemSearchFocus() {
    showItemResults = true;
    queueItemSearch(lineItemSearch);
  }

  function onItemSearchInput(event) {
    lineItemSearch = event.currentTarget.value;
    showItemResults = true;
    itemSearchError = "";
    itemResults = [];
    highlightedItemIndex = -1;

    if (lineItemId && selectedItem && lineItemSearch !== itemLabel(selectedItem)) {
      lineItemId = "";
      selectedItem = null;
    }

    queueItemSearch(lineItemSearch);
  }

  function onItemSearchKeydown(event) {
    if (!showItemResults) return;
    if (!itemResults.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightedItemIndex = Math.min(highlightedItemIndex + 1, itemResults.length - 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightedItemIndex = Math.max(highlightedItemIndex - 1, 0);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const candidate = itemResults[highlightedItemIndex];
      if (candidate && candidate.status !== "frozen") {
        chooseItem(candidate);
      }
      return;
    }

    if (event.key === "Escape") {
      showItemResults = false;
    }
  }

  function onItemSearchBlur() {
    setTimeout(() => {
      showItemResults = false;
    }, 120);
  }

  function chooseItem(item) {
    lineItemId = item._id;
    selectedItem = item;
    lineItemSearch = itemLabel(item);
    showItemResults = false;
    highlightedItemIndex = -1;
  }

  function addLine() {
    if (!lineItemId || !lineQty || !selectedItem) return;
    if (selectedItem.status === "frozen") return;
    if (Number(lineQty) <= 0) return;

    creditLines = [
      ...creditLines,
      {
        itemId: lineItemId,
        name: selectedItem.name,
        quantity: Number(lineQty),
        unitPrice: Number(selectedItem.sellingPrice ?? 0),
      },
    ];

    lineItemId = "";
    lineItemSearch = "";
    lineQty = "";
    selectedItem = null;
    itemResults = [];
    highlightedItemIndex = -1;
    itemSearchError = "";
  }

  function removeLine(index) {
    creditLines = creditLines.filter((_, i) => i !== index);
  }

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const params = { limit, status };
      if (cursorParam) params.cursor = cursorParam;
      if (direction) params.direction = direction;
      if (start) params.start = start;
      if (end) params.end = end;

      const res = await api.getCredits(params);
      credits = res.credits || [];
      nextCursor = res.nextCursor || null;
      prevCursor = res.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }
    } catch (err) {
      error = err.message || "Unable to load credits.";
    } finally {
      loading = false;
    }
  }

  async function submitCredit() {
    if (creditLines.length === 0 || !customerName.trim()) return;
    creating = true;
    error = "";
    try {
      await api.createCredit({
        customerName: customerName.trim(),
        customerContact: customerContact.trim() || undefined,
        notes: notes.trim() || undefined,
        items: creditLines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
        })),
      });

      customerName = "";
      customerContact = "";
      notes = "";
      creditLines = [];
      await load({ resetStack: true });
    } catch (err) {
      error = err.message || "Unable to create credit.";
    } finally {
      creating = false;
    }
  }

  async function convertCredit(creditId) {
    convertingId = creditId;
    error = "";
    try {
      await api.convertCredit(creditId);
      await load({ resetStack: true });
    } catch (err) {
      error = err.message || "Unable to convert credit.";
    } finally {
      convertingId = null;
    }
  }

  onMount(() => {
    load({ resetStack: true });
    runItemSearch("");
  });

  onDestroy(() => {
    if (itemSearchTimer) clearTimeout(itemSearchTimer);
    latestItemSearchId += 1;
  });
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Credits</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <h3 class="font-semibold text-slate-900 mb-2">New Credit</h3>
  <div class="grid md:grid-cols-3 gap-3 text-sm mb-3">
    <input class="border rounded px-3 py-2" placeholder="Customer name" bind:value={customerName} />
    <input class="border rounded px-3 py-2" placeholder="Customer contact (optional)" bind:value={customerContact} />
    <input class="border rounded px-3 py-2" placeholder="Notes (optional)" bind:value={notes} />
  </div>

  <div class="grid md:grid-cols-4 gap-3 text-sm">
    <div class="relative">
      <input
        class="border rounded px-3 py-2 w-full"
        placeholder="Search item or SKU"
        value={lineItemSearch}
        on:focus={onItemSearchFocus}
        on:input={onItemSearchInput}
        on:keydown={onItemSearchKeydown}
        on:blur={onItemSearchBlur}
      />
      {#if showItemResults}
        <div class="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded border bg-white shadow">
          {#if itemSearchLoading}
            <div class="px-3 py-2 text-slate-500">Searching...</div>
          {:else if itemSearchError}
            <div class="px-3 py-2 text-rose-600">{itemSearchError}</div>
          {:else if itemResults.length === 0}
            <div class="px-3 py-2 text-slate-500">No matching items</div>
          {:else}
            {#each itemResults as item, idx}
              <button
                type="button"
                class={`block w-full px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${highlightedItemIndex === idx ? "bg-slate-100" : "hover:bg-slate-50"}`}
                on:mousedown|preventDefault={() => chooseItem(item)}
                on:mouseenter={() => (highlightedItemIndex = idx)}
                disabled={item.status === "frozen"}
              >
                <p class="text-sm text-slate-900">{item.name}</p>
                <p class="text-xs text-slate-500">
                  {item.sku} · ${Number(item.sellingPrice ?? 0).toFixed(2)} · {item.availableQuantity} available{item.status === "frozen" ? " · Frozen" : ""}
                </p>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    <input class="border rounded px-3 py-2" placeholder="Qty" type="number" min="1" bind:value={lineQty} />
    <input class="border rounded px-3 py-2 bg-slate-50 text-slate-700" value={`$${selectedSellingPrice.toFixed(2)}`} readonly />
    <button class="bg-slate-900 text-white rounded px-3 py-2" on:click={addLine}>Add</button>
  </div>

  {#if creditLines.length > 0}
    <div class="mt-4">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="text-left px-3 py-2">Item</th>
            <th class="text-left px-3 py-2">Qty</th>
            <th class="text-left px-3 py-2">Unit Price</th>
            <th class="text-left px-3 py-2">Line Total</th>
            <th class="text-left px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each creditLines as line, idx}
            <tr class="border-t">
              <td class="px-3 py-2">{line.name}</td>
              <td class="px-3 py-2">{line.quantity}</td>
              <td class="px-3 py-2">${line.unitPrice.toFixed(2)}</td>
              <td class="px-3 py-2">${(line.unitPrice * line.quantity).toFixed(2)}</td>
              <td class="px-3 py-2">
                <button class="text-xs border rounded px-2 py-1" on:click={() => removeLine(idx)}>Remove</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="mt-3 flex items-center justify-between">
        <p class="text-sm text-slate-600">
          Total: ${creditLines.reduce((sum, line) => sum + (line.unitPrice * line.quantity), 0).toFixed(2)}
        </p>
        <button class="bg-emerald-600 text-white px-4 py-2 rounded disabled:opacity-60" on:click={submitCredit} disabled={creating || !customerName.trim()}>
          {creating ? "Saving..." : "Save Credit"}
        </button>
      </div>
    </div>
  {/if}
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
      <label class="text-sm">Status</label>
      <select class="border rounded px-3 py-1 text-sm" bind:value={status} on:change={() => load({ resetStack: true })}>
        <option value="all">All</option>
        <option value="open">Open</option>
        <option value="converted">Converted</option>
      </select>
      <label class="text-sm">Start</label>
      <input class="border rounded px-3 py-1 text-sm" type="date" bind:value={start} on:change={() => load({ resetStack: true })} />
      <label class="text-sm">End</label>
      <input class="border rounded px-3 py-1 text-sm" type="date" bind:value={end} on:change={() => load({ resetStack: true })} />
      <div class="ml-auto text-sm text-slate-500">{#if !currentCursor}Newest{:else}Page{/if} • {credits.length} credits</div>
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-100 text-slate-600">
        <tr>
          <th class="text-left px-3 py-2">Credited At</th>
          <th class="text-left px-3 py-2">Customer</th>
          <th class="text-left px-3 py-2">Done By</th>
          <th class="text-left px-3 py-2">Items</th>
          <th class="text-left px-3 py-2">Total</th>
          <th class="text-left px-3 py-2">Status</th>
          <th class="text-left px-3 py-2">Action</th>
        </tr>
      </thead>
      <tbody>
        {#each credits as credit}
          <tr class="border-t align-top">
            <td class="px-3 py-2 align-top">{new Date(credit.creditedAt).toLocaleString()}</td>
            <td class="px-3 py-2 align-top">
              <div>{credit.customerName}</div>
              {#if credit.customerContact}
                <div class="text-xs text-slate-500">{credit.customerContact}</div>
              {/if}
            </td>
            <td class="px-3 py-2 align-top">{doneByLabel(credit)}</td>
            <td class="px-3 py-2 text-sm">
              {#if credit.items && credit.items.length}
                <div class="truncate text-sm" style="max-width:32rem" title={itemsSummary(credit.items)}>
                  {itemsSummary(credit.items)}
                </div>
              {:else}
                <span class="text-slate-500">—</span>
              {/if}
            </td>
            <td class="px-3 py-2">${Number(credit.totalAmount || 0).toFixed(2)}</td>
            <td class="px-3 py-2 capitalize">{credit.status}</td>
            <td class="px-3 py-2">
              {#if credit.status === "open"}
                <button
                  class="text-xs border rounded px-2 py-1 disabled:opacity-60"
                  on:click={() => convertCredit(credit._id)}
                  disabled={convertingId === credit._id}
                >
                  {convertingId === credit._id ? "Converting..." : "Convert to Sale"}
                </button>
              {:else}
                <span class="text-xs text-slate-500">Converted</span>
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
        load({ cursorParam: previous, direction: "prev" });
      }} disabled={cursorStack.length === 0 && !prevCursor}>Previous</button>
      <button class="px-3 py-2 border rounded" on:click={() => {
        if (!nextCursor) return;
        cursorStack.push(currentCursor);
        currentCursor = nextCursor;
        load({ cursorParam: nextCursor, direction: "next" });
      }} disabled={!nextCursor}>Next</button>
    </div>
  </div>
{/if}

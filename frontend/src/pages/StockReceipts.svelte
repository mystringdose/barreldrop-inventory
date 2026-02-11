<script>
  import { onDestroy, onMount } from "svelte";
  import { api, apiUrl } from "../lib/api.js";

  let receipts = [];
  let loading = true;
  let error = "";

  // cursor paging
  let limit = 20;
  let nextCursor = null;
  let prevCursor = null;
  let cursorStack = [];
  let currentCursor = null;

  const ITEM_SEARCH_LIMIT = 20;
  const ITEM_SEARCH_DEBOUNCE_MS = 250;

  let itemId = "";
  let itemSearch = "";
  let selectedItem = null;
  let itemResults = [];
  let showItemResults = false;
  let itemSearchLoading = false;
  let itemSearchError = "";
  let highlightedItemIndex = -1;
  let itemSearchTimer = null;
  let latestItemSearchId = 0;
  let quantity = "";
  let unitCost = "";
  let supplier = "";
  let invoiceFile = null;

  function itemLabel(item) {
    return `${item.name} (${item.sku})`;
  }

  async function runItemSearch(rawTerm = itemSearch) {
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

  function queueItemSearch(rawTerm = itemSearch) {
    if (itemSearchTimer) clearTimeout(itemSearchTimer);
    itemSearchTimer = setTimeout(() => {
      runItemSearch(rawTerm);
    }, ITEM_SEARCH_DEBOUNCE_MS);
  }

  function onItemSearchFocus() {
    showItemResults = true;
    queueItemSearch(itemSearch);
  }

  function onItemSearchInput(event) {
    itemSearch = event.currentTarget.value;
    showItemResults = true;
    itemSearchError = "";
    itemResults = [];
    highlightedItemIndex = -1;

    if (itemId && selectedItem && itemSearch !== itemLabel(selectedItem)) {
      itemId = "";
      selectedItem = null;
    }

    queueItemSearch(itemSearch);
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
      if (candidate) {
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
    itemId = item._id;
    selectedItem = item;
    itemSearch = itemLabel(item);
    showItemResults = false;
    highlightedItemIndex = -1;
  }

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const receiptsRes = await api.getReceipts({ limit, cursor: cursorParam, direction });
      receipts = receiptsRes.receipts || [];
      nextCursor = receiptsRes.nextCursor || null;
      prevCursor = receiptsRes.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }
    } catch (err) {
      error = err.message || "Unable to load receipts.";
    } finally {
      loading = false;
    }
  }

  async function submitReceipt() {
    try {
      if (!itemId || !quantity || !unitCost) {
        throw new Error("Item, quantity and unit cost are required");
      }
      if (Number(quantity) <= 0) throw new Error("Quantity must be greater than 0");
      if (Number(unitCost) < 0) throw new Error("Unit cost must be >= 0");
      if (!invoiceFile) {
        throw new Error("Invoice file is required");
      }

      let invoiceKey = null;
      try {
        const presign = await api.request("/stock-receipts/presign", {
          method: "POST",
          body: { filename: invoiceFile.name, contentType: invoiceFile.type || "application/octet-stream" },
        });

        const uploadUrl = presign.upload.url;
        invoiceKey = presign.upload.key;

        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": invoiceFile.type || "application/octet-stream" },
          body: invoiceFile,
        });

        if (!uploadRes.ok) {
          throw new Error("S3 upload failed");
        }

        await api.request("/stock-receipts", {
          method: "POST",
          body: {
            itemId,
            quantity: Number(quantity),
            unitCost: Number(unitCost),
            supplier: supplier || undefined,
            invoiceKey,
          },
        });
      } catch (presignErr) {
        const form = new FormData();
        form.append("itemId", itemId);
        form.append("quantity", quantity);
        form.append("unitCost", unitCost);
        if (supplier) form.append("supplier", supplier);
        if (invoiceFile) form.append("invoice", invoiceFile);

        const res = await fetch(`${apiUrl("")}/stock-receipts`, {
          method: "POST",
          credentials: "include",
          body: form,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Unable to add receipt");
        }
      }

      itemId = "";
      itemSearch = "";
      selectedItem = null;
      itemResults = [];
      highlightedItemIndex = -1;
      quantity = "";
      unitCost = "";
      supplier = "";
      invoiceFile = null;

      await load();
    } catch (err) {
      error = err.message || "Unable to add receipt";
    }
  }

  onMount(() => {
    load({ resetStack: true });
    runItemSearch("");

    // If the page was opened with ?itemId=..., preselect it when possible.
    try {
      const hash = window.location.hash || "";
      const qs = hash.includes("?") ? new URLSearchParams(hash.split("?")[1]) : new URLSearchParams("");
      const pre = qs.get("itemId");
      if (pre) {
        itemId = pre;
        runItemSearch(pre).then(() => {
          const exact = itemResults.find((it) => it._id === pre);
          if (exact) {
            chooseItem(exact);
          } else {
            itemId = "";
          }
        });
      }
    } catch (e) {
      // ignore
    }
  });

  onDestroy(() => {
    if (itemSearchTimer) clearTimeout(itemSearchTimer);
    latestItemSearchId += 1;
  });
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Stock Receipts</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <h3 class="font-semibold text-slate-900 mb-2">Add Stock (Invoice Required)</h3>
  <div class="grid md:grid-cols-3 gap-3 text-sm">
    <div class="relative">
      <input
        class="border rounded px-3 py-2 w-full"
        placeholder="Search item or SKU"
        value={itemSearch}
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
                class={`block w-full px-3 py-2 text-left ${highlightedItemIndex === idx ? "bg-slate-100" : "hover:bg-slate-50"}`}
                on:mousedown|preventDefault={() => chooseItem(item)}
                on:mouseenter={() => (highlightedItemIndex = idx)}
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
    <input class="border rounded px-3 py-2" placeholder="Quantity" type="number" min="1" bind:value={quantity} />
    <input class="border rounded px-3 py-2" placeholder="Unit cost" type="number" min="0" bind:value={unitCost} />
    <input class="border rounded px-3 py-2" placeholder="Supplier" bind:value={supplier} />
    <input class="border rounded px-3 py-2" type="file" accept="application/pdf,image/*" on:change={(e) => (invoiceFile = e.target.files[0])} />
  </div>
  <button class="mt-3 bg-slate-900 text-white px-4 py-2 rounded" on:click={submitReceipt}>
    Save Receipt
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
      <div class="ml-auto text-sm text-slate-500">{#if !currentCursor}Newest{:else}Page{/if} • {receipts.length} receipts</div>
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-100 text-slate-600">
        <tr>
          <th class="text-left px-3 py-2">Item</th>
          <th class="text-left px-3 py-2">Qty</th>
          <th class="text-left px-3 py-2">Unit Cost</th>
          <th class="text-left px-3 py-2">Remaining</th>
          <th class="text-left px-3 py-2">Invoice</th>
        </tr>
      </thead>
      <tbody>
        {#each receipts as receipt}
          <tr class="border-t">
            <td class="px-3 py-2">{receipt.item?.name}</td>
            <td class="px-3 py-2">{receipt.quantity}</td>
            <td class="px-3 py-2">${receipt.unitCost.toFixed(2)}</td>
            <td class="px-3 py-2">{receipt.remainingQuantity}</td>
            <td class="px-3 py-2">
              {#if receipt.invoiceUrl}
                <a class="text-xs text-blue-600" href={receipt.invoiceUrl} target="_blank">View</a>
              {:else}
                <a class="text-xs text-blue-600" href={`${apiUrl("/uploads/")}${receipt.invoiceFile}`} target="_blank">View</a>
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

<script>
  import { onMount } from "svelte";
  import { api, apiUrl } from "../lib/api.js";

  let items = [];
  let sales = [];
  let error = "";
  let loading = true;

  // cursor pagination for sales
  let limit = 20;
  let nextCursor = null;
  let prevCursor = null;
  let cursorStack = [];
  let currentCursor = null;

  // Items summary helper — compact, comma-separated list (tooltip shows full list)
  function itemsSummary(items) {
    if (!items || items.length === 0) return "";
    return items
      .map((line) => {
        const name = (line.item && line.item.name) ? line.item.name : (line.item || line.itemId);
        return `${name} x${line.quantity}`;
      })
      .join(", ");
  }

  let start = "";
  let end = "";

  let lineItemId = "";
  let lineQty = "";
  let saleLines = [];
  $: selectedItem = items.find((i) => i._id === lineItemId);
  $: selectedSellingPrice = Number(selectedItem?.sellingPrice ?? 0);

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const params = { limit };
      if (cursorParam) params.cursor = cursorParam;
      if (direction) params.direction = direction;
      if (start) params.start = start;
      if (end) params.end = end;
      const [itemsRes, salesRes] = await Promise.all([api.listItems(), api.getSales(params)]);
      items = itemsRes.items;
      sales = salesRes.sales || [];
      nextCursor = salesRes.nextCursor || null;
      prevCursor = salesRes.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }
    } catch (err) {
      error = err.message || "Unable to load sales.";
    } finally {
      loading = false;
    }
  }

  function addLine() {
    if (!lineItemId || !lineQty) return;
    const item = items.find((i) => i._id === lineItemId);
    if (!item) return;
    saleLines = [
      ...saleLines,
      {
        itemId: lineItemId,
        name: item?.name,
        quantity: Number(lineQty),
        unitPrice: Number(item.sellingPrice ?? 0),
      },
    ];
    lineItemId = "";
    lineQty = "";
  }

  async function submitSale() {
    if (saleLines.length === 0) return;
    try {
      await api.createSale({
        items: saleLines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
        })),
      });
      saleLines = [];
      await load();
    } catch (err) {
      error = err.message || "Unable to create sale.";
    }
  }

  onMount(() => load({ resetStack: true }));
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Sales</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <h3 class="font-semibold text-slate-900 mb-2">New Sale</h3>
  <div class="grid md:grid-cols-4 gap-3 text-sm">
    <select class="border rounded px-3 py-2" bind:value={lineItemId}>
      <option value="">Select Item</option>
      {#each items as item}
        <option value={item._id} disabled={item.status === "frozen"}>
          {item.name} (${Number(item.sellingPrice ?? 0).toFixed(2)} • {item.availableQuantity} available)
        </option>
      {/each}
    </select>
    <input class="border rounded px-3 py-2" placeholder="Qty" type="number" min="1" bind:value={lineQty} />
    <input class="border rounded px-3 py-2 bg-slate-50 text-slate-700" value={`$${selectedSellingPrice.toFixed(2)}`} readonly />
    <button class="bg-slate-900 text-white rounded px-3 py-2" on:click={addLine}>Add</button>
  </div>

  {#if saleLines.length > 0}
    <div class="mt-4">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="text-left px-3 py-2">Item</th>
            <th class="text-left px-3 py-2">Qty</th>
            <th class="text-left px-3 py-2">Unit Price</th>
          </tr>
        </thead>
        <tbody>
          {#each saleLines as line}
            <tr class="border-t">
              <td class="px-3 py-2">{line.name}</td>
              <td class="px-3 py-2">{line.quantity}</td>
              <td class="px-3 py-2">${line.unitPrice.toFixed(2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button class="mt-3 bg-emerald-600 text-white px-4 py-2 rounded" on:click={submitSale}>
        Submit Sale
      </button>
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
      <label class="text-sm">Start</label>
      <input class="border rounded px-3 py-1 text-sm" type="date" bind:value={start} on:change={() => load({ resetStack: true })} />
      <label class="text-sm">End</label>
      <input class="border rounded px-3 py-1 text-sm" type="date" bind:value={end} on:change={() => load({ resetStack: true })} />
      <div class="ml-auto text-sm text-slate-500">{#if !currentCursor}Newest{:else}Page{/if} • {sales.length} sales</div>
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-100 text-slate-600">
        <tr>
          <th class="text-left px-3 py-2">Sold At</th>
          <th class="text-left px-3 py-2">Items</th>
          <th class="text-left px-3 py-2">Total</th>
          <th class="text-left px-3 py-2">Profit</th>
          <th class="text-left px-3 py-2">Receipt</th>
        </tr>
      </thead>
      <tbody>
        {#each sales as sale}
          <tr class="border-t align-top">
            <td class="px-3 py-2 align-top">{new Date(sale.soldAt).toLocaleString()}</td>
            <td class="px-3 py-2 text-sm">
              {#if sale.items && sale.items.length}
                <div class="truncate text-sm" style="max-width:40rem" title={itemsSummary(sale.items)}>
                  {itemsSummary(sale.items)}
                </div>
              {:else}
                <span class="text-slate-500">—</span>
              {/if}
            </td>
            <td class="px-3 py-2">${sale.totalRevenue.toFixed(2)}</td>
            <td class="px-3 py-2">${sale.profit.toFixed(2)}</td>
            <td class="px-3 py-2">
              <a class="text-sm text-sky-600 hover:underline" href={apiUrl(`/sales/${sale._id}/receipt`)} target="_blank" rel="noopener">Download PDF</a>
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

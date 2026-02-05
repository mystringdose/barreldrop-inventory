<script>
  import { onMount } from "svelte";
  import { api, apiUrl } from "../lib/api.js";

  let items = [];
  let receipts = [];
  let loading = true;
  let error = "";

  // cursor paging
  let limit = 20;
  let nextCursor = null;
  let prevCursor = null;
  let cursorStack = [];
  let currentCursor = null;

  let itemId = "";
  let quantity = "";
  let unitCost = "";
  let supplier = "";
  let invoiceFile = null;

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const [itemsRes, receiptsRes] = await Promise.all([api.listItems(), api.getReceipts({ limit, cursor: cursorParam, direction })]);
      items = itemsRes.items;
      receipts = receiptsRes.receipts || [];
      nextCursor = receiptsRes.nextCursor || null;
      prevCursor = receiptsRes.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }

      // If the page was opened with ?itemId=..., preselect it
      try {
        const hash = window.location.hash || "";
        const qs = hash.includes("?") ? new URLSearchParams(hash.split("?")[1]) : new URLSearchParams("");
        const pre = qs.get("itemId");
        if (pre) itemId = pre;
      } catch (e) {
        // ignore
      }

    } catch (err) {
      error = err.message || "Unable to load receipts.";
    } finally {
      loading = false;
    }
  }

  async function submitReceipt() {
    try {
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
      quantity = "";
      unitCost = "";
      supplier = "";
      invoiceFile = null;

      await load();
    } catch (err) {
      error = err.message || "Unable to add receipt";
    }
  }

  onMount(() => load({ resetStack: true }));
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Stock Receipts</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <h3 class="font-semibold text-slate-900 mb-2">Add Stock (Invoice Required)</h3>
  <div class="grid md:grid-cols-3 gap-3 text-sm">
    <select class="border rounded px-3 py-2" bind:value={itemId}>
      <option value="">Select Item</option>
      {#each items as item}
        <option value={item._id}>{item.name} ({item.sku})</option>
      {/each}
    </select>
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

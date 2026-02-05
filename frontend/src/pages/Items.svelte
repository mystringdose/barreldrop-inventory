<script>
  import { onMount } from "svelte";
  import { api, apiUrl } from "../lib/api.js";
  import { authStore } from "../lib/stores.js";
  import BarcodeScanner from "../components/BarcodeScanner.svelte";

  let items = [];
  let loading = true;
  let error = "";

  const categories = ["whiskey", "wine", "rum", "beer", "vodka", "gin", "other"];

  let name = "";
  let sku = "";
  let category = "";
  let size = "";
  let abv = "";
  let buyingPrice = "";
  let sellingPrice = "";
  let reorderLevel = "";
  let bulkFile = null;
  let editingId = null;
  let editForm = {
    name: "",
    sku: "",
    category: "",
    size: "",
    abv: "",
    buyingPrice: "",
    sellingPrice: "",
    reorderLevel: "",
  };

  // Inline Add Stock modal state
  let showStockModal = false;
  let stockItemId = "";
  let stockQuantity = "";
  let stockUnitCost = "";
  let stockSupplier = "";
  let stockInvoiceFile = null;
  let stockError = "";
  let stockLoading = false;

  function openAddStock(item) {
    showStockModal = true;
    stockItemId = item?._id || "";
    stockQuantity = "";
    stockUnitCost = "";
    stockSupplier = "";
    stockInvoiceFile = null;
    stockError = "";
  }

  function handleStockFileChange(e) {
    stockInvoiceFile = e.target.files[0];
  }

  async function submitStock() {
    try {
      stockLoading = true;
      stockError = "";
      if (!stockItemId || !stockQuantity || !stockUnitCost) {
        throw new Error("Item, quantity and unit cost are required");
      }
      if (Number(stockQuantity) <= 0) throw new Error("Quantity must be greater than 0");
      if (Number(stockUnitCost) < 0) throw new Error("Unit cost must be >= 0");

      // Invoice file required
      if (!stockInvoiceFile) throw new Error("Invoice file is required");

      let invoiceKey = null;
      try {
        const presign = await api.request("/stock-receipts/presign", {
          method: "POST",
          body: { filename: stockInvoiceFile.name, contentType: stockInvoiceFile.type || "application/octet-stream" },
        });

        const uploadUrl = presign.upload.url;
        invoiceKey = presign.upload.key;

        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": stockInvoiceFile.type || "application/octet-stream" },
          body: stockInvoiceFile,
        });

        if (!uploadRes.ok) {
          throw new Error("S3 upload failed");
        }

        await api.request("/stock-receipts", {
          method: "POST",
          body: {
            itemId: stockItemId,
            quantity: Number(stockQuantity),
            unitCost: Number(stockUnitCost),
            supplier: stockSupplier || undefined,
            invoiceKey,
          },
        });
      } catch (presignErr) {
        const form = new FormData();
        form.append("itemId", stockItemId);
        form.append("quantity", stockQuantity);
        form.append("unitCost", stockUnitCost);
        if (stockSupplier) form.append("supplier", stockSupplier);
        if (stockInvoiceFile) form.append("invoice", stockInvoiceFile);

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

      showStockModal = false;
      await load();
    } catch (err) {
      stockError = err.message || "Unable to add stock";
    } finally {
      stockLoading = false;
    }
  }

  // cursor pagination state
  let limit = 50;
  let nextCursor = null;
  let prevCursor = null;
  let cursorStack = [];
  let currentCursor = null;

  async function load({ cursorParam = null, direction = undefined, resetStack = false } = {}) {
    loading = true;
    error = "";
    try {
      const params = { limit };
      if (cursorParam) params.cursor = cursorParam;
      if (direction) params.direction = direction;
      const res = await api.getItems(params);
      items = res.items || [];
      nextCursor = res.nextCursor || null;
      prevCursor = res.prevCursor || null;
      if (resetStack) {
        cursorStack = [];
        currentCursor = cursorParam || null;
      }
    } catch (err) {
      error = err.message || "Unable to load items.";
    } finally {
      loading = false;
    }
  }

  async function createItem() {
    try {
      error = "";
      if (buyingPrice !== "" && Number(buyingPrice) < 0) throw new Error("Buying price must be >= 0");
      if (sellingPrice !== "" && Number(sellingPrice) < 0) throw new Error("Selling price must be >= 0");
      if (buyingPrice !== "" && sellingPrice !== "" && Number(sellingPrice) < Number(buyingPrice)) throw new Error("Selling price should be >= buying price");

      await api.createItem({
        name,
        sku,
        category,
        size,
        abv: abv ? Number(abv) : undefined,
        buyingPrice: buyingPrice ? Number(buyingPrice) : undefined,
        sellingPrice: sellingPrice ? Number(sellingPrice) : undefined,
        reorderLevel: reorderLevel ? Number(reorderLevel) : undefined,
      });
      name = "";
      sku = "";
      category = "";
      size = "";
      abv = "";
      buyingPrice = "";
      sellingPrice = "";
      reorderLevel = "";
      await load();
    } catch (err) {
      error = err.message || "Unable to create item.";
    }
  }

  async function startEdit(item) {
    editingId = item._id;
    editForm = {
      name: item.name,
      sku: item.sku,
      category: item.category || "",
      size: item.size || "",
      abv: item.abv ?? "",
      buyingPrice: item.buyingPrice ?? "",
      sellingPrice: item.sellingPrice ?? "",
      reorderLevel: item.reorderLevel ?? "",
    };
  }

  async function saveEdit() {
    try {
      error = "";
      if (editForm.buyingPrice !== "" && Number(editForm.buyingPrice) < 0) throw new Error("Buying price must be >= 0");
      if (editForm.sellingPrice !== "" && Number(editForm.sellingPrice) < 0) throw new Error("Selling price must be >= 0");
      if (editForm.buyingPrice !== "" && editForm.sellingPrice !== "" && Number(editForm.sellingPrice) < Number(editForm.buyingPrice)) throw new Error("Selling price should be >= buying price");

      await api.updateItem(editingId, {
        name: editForm.name,
        sku: editForm.sku,
        category: editForm.category || undefined,
        size: editForm.size || undefined,
        abv: editForm.abv !== "" ? Number(editForm.abv) : undefined,
        buyingPrice: editForm.buyingPrice !== "" ? Number(editForm.buyingPrice) : undefined,
        sellingPrice: editForm.sellingPrice !== "" ? Number(editForm.sellingPrice) : undefined,
        reorderLevel: editForm.reorderLevel !== "" ? Number(editForm.reorderLevel) : undefined,
      });
      editingId = null;
      await load();
    } catch (err) {
      error = err.message || "Unable to update item.";
    }
  }

  async function uploadBulk() {
    if (!bulkFile) return;
    try {
      const form = new FormData();
      form.append("file", bulkFile);

      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:4000"}/items/bulk`, {
        method: "POST",
        credentials: "include",
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Bulk upload failed");
      }

      bulkFile = null;
      await load();
    } catch (err) {
      error = err.message || "Bulk upload failed";
    }
  }

  async function toggleStatus(item) {
    const nextStatus = item.status === "active" ? "frozen" : "active";
    await api.updateItemStatus(item._id, nextStatus);
    await load();
  }

  onMount(() => load({ resetStack: true }));
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Stock Items</h2>

{#if $authStore.user?.role === "admin"}
  <div class="bg-white rounded shadow-sm p-4 mb-6">
    <h3 class="font-semibold text-slate-900 mb-2">Add Item</h3>
    <div class="grid md:grid-cols-3 gap-3 text-sm">
      <input class="border rounded px-3 py-2" placeholder="Name" bind:value={name} />
      <input class="border rounded px-3 py-2" placeholder="SKU" bind:value={sku} />
      <select class="border rounded px-3 py-2" bind:value={category}>
        <option value="">Category</option>
        {#each categories as c}
          <option value={c}>{c}</option>
        {/each}
      </select>
      <input class="border rounded px-3 py-2" placeholder="Size" bind:value={size} />
      <input class="border rounded px-3 py-2" placeholder="ABV" type="number" min="0" max="100" bind:value={abv} />
      <input class="border rounded px-3 py-2" placeholder="Buying price" type="number" min="0" step="0.01" bind:value={buyingPrice} />
      <input class="border rounded px-3 py-2" placeholder="Selling price" type="number" min="0" step="0.01" bind:value={sellingPrice} />
      <input class="border rounded px-3 py-2" placeholder="Reorder level" type="number" min="0" bind:value={reorderLevel} />
    </div>
    <div class="mt-3">
      <BarcodeScanner onDetect={(code) => (sku = code)} />
    </div>
    <button class="mt-3 bg-slate-900 text-white px-4 py-2 rounded" on:click={createItem}>
      Save Item
    </button>
  </div>

  {#if editingId}
    <div class="bg-white rounded shadow-sm p-4 mb-6">
      <h3 class="font-semibold text-slate-900 mb-2">Edit Item</h3>
      <div class="grid md:grid-cols-3 gap-3 text-sm">
        <input class="border rounded px-3 py-2" placeholder="Name" bind:value={editForm.name} />
        <input class="border rounded px-3 py-2" placeholder="SKU" bind:value={editForm.sku} />
        <select class="border rounded px-3 py-2" bind:value={editForm.category}>
          <option value="">Category</option>
          {#each categories as c}
            <option value={c}>{c}</option>
          {/each}
        </select>
        <input class="border rounded px-3 py-2" placeholder="Size" bind:value={editForm.size} />
        <input class="border rounded px-3 py-2" placeholder="ABV" type="number" min="0" max="100" bind:value={editForm.abv} />
        <input class="border rounded px-3 py-2" placeholder="Buying price" type="number" min="0" step="0.01" bind:value={editForm.buyingPrice} />
        <input class="border rounded px-3 py-2" placeholder="Selling price" type="number" min="0" step="0.01" bind:value={editForm.sellingPrice} />
        <input class="border rounded px-3 py-2" placeholder="Reorder level" type="number" min="0" bind:value={editForm.reorderLevel} />
      </div>
      <div class="mt-3">
        <button class="bg-slate-900 text-white px-4 py-2 rounded mr-2" on:click={saveEdit}>
          Save Changes
        </button>
        <button class="border px-4 py-2 rounded" on:click={() => (editingId = null)}>
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <div class="bg-white rounded shadow-sm p-4 mb-6">
    <h3 class="font-semibold text-slate-900 mb-2">Bulk Import (CSV)</h3>
    <p class="text-xs text-slate-500 mb-2">Columns: name, sku, category, size, abv, reorderLevel, buyingPrice, sellingPrice</p>
    <input class="border rounded px-3 py-2 text-sm" type="file" accept=".csv" on:change={(e) => (bulkFile = e.target.files[0])} />
    <button class="ml-2 bg-slate-900 text-white px-4 py-2 rounded text-sm" on:click={uploadBulk}>
      Upload CSV
    </button>
  </div>
{/if}

{#if showStockModal}
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div class="bg-white rounded p-4 w-full max-w-md">
      <h3 class="font-semibold mb-2">Add Stock</h3>
      <div class="grid gap-2 text-sm">
        <select class="border rounded px-3 py-2" bind:value={stockItemId}>
          <option value="">Select Item</option>
          {#each items as it}
            <option value={it._id}>{it.name} ({it.sku})</option>
          {/each}
        </select>
        <input class="border rounded px-3 py-2" placeholder="Quantity" type="number" min="1" bind:value={stockQuantity} />
        <input class="border rounded px-3 py-2" placeholder="Unit cost" type="number" min="0" step="0.01" bind:value={stockUnitCost} />
        <input class="border rounded px-3 py-2" placeholder="Supplier" bind:value={stockSupplier} />
        <input class="border rounded px-3 py-2" type="file" accept="application/pdf,image/*" on:change={handleStockFileChange} />
        {#if stockError}
          <p class="text-xs text-rose-600 mt-1">{stockError}</p>
        {/if}
        <div class="flex justify-end gap-2 mt-2">
          <button class="border px-4 py-2 rounded" on:click={() => (showStockModal = false)}>Cancel</button>
          <button class="bg-slate-900 text-white px-4 py-2 rounded" on:click={submitStock}>
            {stockLoading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if loading}
  <p class="text-slate-500">Loading...</p>
{:else if error}
  <p class="text-rose-600">{error}</p>
{:else}
  <div class="bg-white rounded shadow-sm">
    <div class="p-4 flex gap-3 items-center">
      <label class="text-sm">Per page</label>
      <input class="border rounded px-3 py-1 w-20 text-sm" type="number" min="1" bind:value={limit} on:change={() => load({ resetStack: true })} />
      <div class="ml-auto text-sm text-slate-500">{#if !currentCursor}A–Z{:else}Page{/if} • {items.length} items</div>
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-100 text-slate-600">
        <tr>
          <th class="text-left px-3 py-2">Item</th>
          <th class="text-left px-3 py-2">SKU</th>
          <th class="text-left px-3 py-2">Available</th>          <th class="text-left px-3 py-2">Price</th>          <th class="text-left px-3 py-2">Status</th>
          <th class="text-left px-3 py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each items as item}
          <tr class="border-t">
            <td class="px-3 py-2">{item.name}</td>
            <td class="px-3 py-2">{item.sku}</td>
            <td class="px-3 py-2">
              {item.availableQuantity}
              {#if item.lowStock}
                <span class="ml-2 text-xs text-rose-600">Low</span>
              {/if}
            </td>
            <td class="px-3 py-2">{item.sellingPrice ? `$${item.sellingPrice.toFixed(2)}` : "-"}</td>
            <td class="px-3 py-2 capitalize">{item.status}</td>
            <td class="px-3 py-2">
              {#if $authStore.user?.role === "admin"}
                <button class="text-xs border rounded px-2 py-1 mr-2" on:click={() => startEdit(item)}>
                  Edit
                </button>
                <button class="text-xs border rounded px-2 py-1 mr-2" on:click={() => openAddStock(item)}>
                  Add Stock
                </button>
                <button class="text-xs border rounded px-2 py-1" on:click={() => toggleStatus(item)}>
                  {item.status === "active" ? "Freeze" : "Unfreeze"}
                </button>
              {:else}
                <button class="text-xs border rounded px-2 py-1" on:click={() => toggleStatus(item)}>
                  {item.status === "active" ? "Freeze" : "Unfreeze"}
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

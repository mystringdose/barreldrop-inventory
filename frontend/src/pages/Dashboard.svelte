<script>
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";

  let items = [];
  let sales = [];
  let loading = true;
  let error = "";

  async function load() {
    loading = true;
    error = "";
    try {
      const [itemsRes, salesRes] = await Promise.all([api.listItems(), api.listSales()]);
      items = itemsRes.items;
      sales = salesRes.sales;
    } catch (err) {
      error = err.message || "Unable to load dashboard.";
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Overview</h2>

{#if loading}
  <p class="text-slate-500">Loading...</p>
{:else if error}
  <p class="text-rose-600">{error}</p>
{:else}
  <div class="grid md:grid-cols-3 gap-4 mb-6">
    <div class="bg-white rounded shadow-sm p-4">
      <p class="text-sm text-slate-500">Total Items</p>
      <p class="text-2xl font-semibold">{items.length}</p>
    </div>
    <div class="bg-white rounded shadow-sm p-4">
      <p class="text-sm text-slate-500">Recent Sales</p>
      <p class="text-2xl font-semibold">{sales.length}</p>
    </div>
    <div class="bg-white rounded shadow-sm p-4">
      <p class="text-sm text-slate-500">Low Stock Items</p>
      <p class="text-2xl font-semibold">{items.filter((i) => i.lowStock).length}</p>
    </div>
  </div>

  <div class="bg-white rounded shadow-sm p-4">
    <h3 class="font-semibold text-slate-900 mb-2">Low Stock</h3>
    {#if items.filter((i) => i.lowStock).length === 0}
      <p class="text-sm text-slate-500">No low stock alerts.</p>
    {:else}
      <ul class="text-sm text-slate-700">
        {#each items.filter((i) => i.lowStock) as item}
          <li class="py-1">{item.name} - {item.availableQuantity} left</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

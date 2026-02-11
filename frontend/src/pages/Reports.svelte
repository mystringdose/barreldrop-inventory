<script>
  import { api } from "../lib/api.js";
  import { authStore } from "../lib/stores.js";

  let start = "";
  let end = "";
  let sales = [];
  let profitLoss = null;
  let creditSummary = null;
  let creditRows = [];
  let error = "";
  let loading = false;

  async function loadReports() {
    loading = true;
    error = "";
    try {
      const params = {};
      if (start) params.start = start;
      if (end) params.end = end;

      const salesRes = await api.salesReport(params);
      sales = salesRes.sales;

      if ($authStore.user?.role === "admin") {
        const profitRes = await api.profitLoss(params);
        profitLoss = profitRes.profitLoss;
      }

      const creditRes = await api.creditReport(params);
      creditSummary = creditRes.summary;
      creditRows = creditRes.credits || [];
    } catch (err) {
      error = err.message || "Unable to load reports.";
    } finally {
      loading = false;
    }
  }
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Reports</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6">
  <div class="grid md:grid-cols-3 gap-3 text-sm">
    <div>
      <label class="text-sm text-slate-600">Start Date</label>
      <input class="mt-1 w-full border rounded px-3 py-2" type="date" bind:value={start} />
    </div>
    <div>
      <label class="text-sm text-slate-600">End Date</label>
      <input class="mt-1 w-full border rounded px-3 py-2" type="date" bind:value={end} />
    </div>
    <div class="flex items-end">
      <button class="bg-slate-900 text-white px-4 py-2 rounded" on:click={loadReports}>
        Run Report
      </button>
    </div>
  </div>
</div>

{#if loading}
  <p class="text-slate-500">Loading...</p>
{:else if error}
  <p class="text-rose-600">{error}</p>
{:else}
  {#if profitLoss}
    <div class="bg-white rounded shadow-sm p-4 mb-6">
      <h3 class="font-semibold text-slate-900 mb-2">Profit / Loss</h3>
      <div class="grid md:grid-cols-3 gap-4 text-sm">
        <div>
          <p class="text-slate-500">Revenue</p>
          <p class="text-lg font-semibold">${profitLoss.totalRevenue.toFixed(2)}</p>
        </div>
        <div>
          <p class="text-slate-500">Cost</p>
          <p class="text-lg font-semibold">${profitLoss.totalCost.toFixed(2)}</p>
        </div>
        <div>
          <p class="text-slate-500">Profit</p>
          <p class="text-lg font-semibold">${profitLoss.totalProfit.toFixed(2)}</p>
        </div>
      </div>
    </div>
  {/if}

  {#if creditSummary}
    <div class="bg-white rounded shadow-sm p-4 mb-6">
      <h3 class="font-semibold text-slate-900 mb-2">Credit Summary</h3>
      <div class="grid md:grid-cols-3 gap-4 text-sm">
        <div>
          <p class="text-slate-500">Total Credited</p>
          <p class="text-lg font-semibold">${Number(creditSummary.totalCreditedAmount || 0).toFixed(2)}</p>
        </div>
        <div>
          <p class="text-slate-500">Converted</p>
          <p class="text-lg font-semibold">${Number(creditSummary.totalConvertedAmount || 0).toFixed(2)}</p>
        </div>
        <div>
          <p class="text-slate-500">Outstanding</p>
          <p class="text-lg font-semibold">${Number(creditSummary.outstandingAmount || 0).toFixed(2)}</p>
        </div>
      </div>
      <div class="grid md:grid-cols-3 gap-4 text-sm mt-3">
        <div>
          <p class="text-slate-500">Credit Count</p>
          <p class="text-lg font-semibold">{creditSummary.totalCredits || 0}</p>
        </div>
        <div>
          <p class="text-slate-500">Open Credits</p>
          <p class="text-lg font-semibold">{creditSummary.openCredits || 0}</p>
        </div>
        <div>
          <p class="text-slate-500">Converted Credits</p>
          <p class="text-lg font-semibold">{creditSummary.convertedCredits || 0}</p>
        </div>
      </div>
    </div>
  {/if}

  <div class="bg-white rounded shadow-sm p-4">
    <h3 class="font-semibold text-slate-900 mb-2">Sales Report</h3>
    {#if sales.length === 0}
      <p class="text-sm text-slate-500">No sales in this range.</p>
    {:else}
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="text-left px-3 py-2">Date</th>
            <th class="text-left px-3 py-2">Total</th>
            <th class="text-left px-3 py-2">Profit</th>
          </tr>
        </thead>
        <tbody>
          {#each sales as sale}
            <tr class="border-t">
              <td class="px-3 py-2">{new Date(sale.soldAt).toLocaleString()}</td>
              <td class="px-3 py-2">${sale.totalRevenue.toFixed(2)}</td>
              <td class="px-3 py-2">${sale.profit.toFixed(2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="bg-white rounded shadow-sm p-4 mt-6">
    <h3 class="font-semibold text-slate-900 mb-2">Credit Report</h3>
    {#if creditRows.length === 0}
      <p class="text-sm text-slate-500">No credits in this range.</p>
    {:else}
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="text-left px-3 py-2">Date</th>
            <th class="text-left px-3 py-2">Customer</th>
            <th class="text-left px-3 py-2">Total</th>
            <th class="text-left px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each creditRows as credit}
            <tr class="border-t">
              <td class="px-3 py-2">{new Date(credit.creditedAt).toLocaleString()}</td>
              <td class="px-3 py-2">{credit.customerName}</td>
              <td class="px-3 py-2">${Number(credit.totalAmount || 0).toFixed(2)}</td>
              <td class="px-3 py-2 capitalize">{credit.status}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}

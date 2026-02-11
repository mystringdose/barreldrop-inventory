<script>
  import { onMount } from "svelte";
  import Router from "svelte-spa-router";
  import { authStore, loadCurrentUser, logout } from "./lib/stores.js";

  import Login from "./pages/Login.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Items from "./pages/Items.svelte";
  import Sales from "./pages/Sales.svelte";
  import Credits from "./pages/Credits.svelte";
  import Reports from "./pages/Reports.svelte";
  import Users from "./pages/Users.svelte";
  import StockReceipts from "./pages/StockReceipts.svelte";
  import ChangePassword from "./pages/ChangePassword.svelte";
  import ResetPassword from "./pages/ResetPassword.svelte";
  import Audit from "./pages/Audit.svelte";

  const routes = {
    "/": Dashboard,
    "/items": Items,
    "/stock": StockReceipts,
    "/sales": Sales,
    "/credits": Credits,
    "/reports": Reports,
    "/audit": Audit,
    "/users": Users,
    "/change-password": ChangePassword,
    "/reset-password": ResetPassword,
  };

  onMount(() => {
    loadCurrentUser();
  });
</script>

{#if $authStore.loading}
  <div class="min-h-screen flex items-center justify-center text-slate-600">Loading...</div>
{:else}
  {#if !$authStore.user}
    <Login />
  {:else}
    <div class="min-h-screen">
      <header class="bg-white shadow-sm">
        <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <img src="/barreldrop-logo.svg" alt="BarrelDrop" class="h-10 w-auto" />
            <div>
              <h1 class="text-xl font-semibold text-slate-900">Barrel Drop Inventory</h1>
              <p class="text-sm text-slate-500">Welcome, {$authStore.user.name}</p>
            </div>
          </div>
          <button class="text-sm text-slate-600 hover:text-slate-900" on:click={logout}>Log out</button>
        </div>
        <nav class="border-t bg-slate-50">
          <div class="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center gap-4 text-sm">
            <img src="/barreldrop-logo.svg" alt="BarrelDrop" class="h-7 w-auto hidden sm:block" />
            <a href="#/" class="text-slate-700 hover:text-slate-900">Dashboard</a>
            <a href="#/items" class="text-slate-700 hover:text-slate-900">Items</a>
            <a href="#/stock" class="text-slate-700 hover:text-slate-900">Stock Receipts</a>
            <a href="#/sales" class="text-slate-700 hover:text-slate-900">Sales</a>
            <a href="#/credits" class="text-slate-700 hover:text-slate-900">Credits</a>
            <a href="#/reports" class="text-slate-700 hover:text-slate-900">Reports</a>
            {#if $authStore.user.role === "admin"}
              <a href="#/users" class="text-slate-700 hover:text-slate-900">Users</a>
              <a href="#/audit" class="text-slate-700 hover:text-slate-900">Audit</a>
            {/if}
          </div>
        </nav>
      </header>

      <main class="max-w-6xl mx-auto px-4 py-6">
        <Router {routes} />
      </main>
    </div>
  {/if}
{/if}

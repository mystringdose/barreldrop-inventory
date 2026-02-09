<script>
  import { authStore, login } from "../lib/stores.js";
  import { api } from "../lib/api.js";

  let email = "";
  let password = "";
  let creating = false;
  let bootstrapMessage = "";

  // Forgot password state
  let forgot = false;
  let forgotEmail = "";
  let forgotMessage = "";
  let forgotLoading = false;

  async function handleSubmit() {
    const result = await login(email, password);
    // If logged in and forced to change password, redirect
    if ($authStore.user?.forcePasswordChange) {
      location.hash = "#/change-password";
    }
  }

  async function handleBootstrap() {
    creating = true;
    bootstrapMessage = "";
    try {
      await api.bootstrapUser({ name: "Admin", email, password, role: "admin" });
      bootstrapMessage = "Admin created. Please sign in.";
    } catch (err) {
      bootstrapMessage = err.message || "Unable to create admin.";
    } finally {
      creating = false;
    }
  }

  async function submitForgot() {
    forgotLoading = true;
    forgotMessage = "";
    try {
      await api.forgotPassword(forgotEmail);
      forgotMessage = "If that email exists, a reset link was sent.";
    } catch (err) {
      forgotMessage = err.message || "Unable to send reset email.";
    } finally {
      forgotLoading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center px-4">
  <div class="bg-white shadow-lg rounded-lg p-6 w-full max-w-md">
    <div class="mb-4 flex justify-center">
      <img src="/barreldrop-logo.svg" alt="BarrelDrop" class="h-16 w-auto" />
    </div>
    <h2 class="text-lg font-semibold text-slate-900">Sign in</h2>
    <p class="text-sm text-slate-500 mb-4">Use your Barrel Drop account.</p>

    <form on:submit|preventDefault={handleSubmit} class="space-y-3">
      <div>
        <label class="text-sm text-slate-600">Email</label>
        <input class="mt-1 w-full border rounded px-3 py-2" type="email" bind:value={email} required />
      </div>
      <div>
        <label class="text-sm text-slate-600">Password</label>
        <input class="mt-1 w-full border rounded px-3 py-2" type="password" bind:value={password} required />
      </div>

      {#if $authStore.error}
        <p class="text-sm text-rose-600">{$authStore.error}</p>
      {/if}

      <button class="w-full bg-slate-900 text-white py-2 rounded" type="submit">
        Sign in
      </button>
    </form>

    <div class="mt-3 text-sm text-center">
      {#if !forgot}
        <button class="text-xs text-slate-600 underline" on:click={() => (forgot = true)}>Forgot password?</button>
      {:else}
        <div class="space-y-2">
          <input class="mt-1 w-full border rounded px-3 py-2" type="email" placeholder="Email" bind:value={forgotEmail} />
          <div class="flex gap-2 justify-center">
            <button class="border px-3 py-1 rounded text-sm" on:click={() => (forgot = false)}>Cancel</button>
            <button class="bg-slate-900 text-white px-3 py-1 rounded text-sm" on:click={submitForgot} disabled={forgotLoading || !forgotEmail}>{forgotLoading ? "Sending..." : "Send reset"}</button>
          </div>
          {#if forgotMessage}
            <p class="text-xs text-slate-500">{forgotMessage}</p>
          {/if}
        </div>
      {/if}
    </div>

    <div class="mt-6 border-t pt-4">
      <p class="text-xs text-slate-500">First time? Create the initial admin account.</p>
      <button
        class="mt-2 w-full border border-slate-300 py-2 rounded text-sm"
        on:click={handleBootstrap}
        disabled={creating || !email || !password}
      >
        {creating ? "Creating..." : "Create Admin"}
      </button>
      {#if bootstrapMessage}
        <p class="text-xs text-slate-500 mt-2">{bootstrapMessage}</p>
      {/if}
    </div>
  </div>
</div>

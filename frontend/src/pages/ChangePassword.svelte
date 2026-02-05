<script>
  import { loadCurrentUser } from "../lib/stores.js";
  import { api } from "../lib/api.js";

  let currentPassword = "";
  let newPassword = "";
  let confirmPassword = "";
  let loading = false;
  let message = "";

  async function submit() {
    message = "";
    if (newPassword !== confirmPassword) {
      message = "Passwords do not match";
      return;
    }
    loading = true;
    try {
      await api.changePassword(currentPassword, newPassword);
      message = "Password changed successfully";
      await loadCurrentUser();
      location.hash = "#/";
    } catch (err) {
      message = err.message || "Unable to change password";
    } finally {
      loading = false;
    }
  }
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Change Password</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6 max-w-md">
  <div class="space-y-3">
    <input class="w-full border rounded px-3 py-2" type="password" placeholder="Current password" bind:value={currentPassword} />
    <input class="w-full border rounded px-3 py-2" type="password" placeholder="New password" bind:value={newPassword} />
    <input class="w-full border rounded px-3 py-2" type="password" placeholder="Confirm new password" bind:value={confirmPassword} />
    {#if message}
      <p class="text-xs text-rose-600">{message}</p>
    {/if}
    <div class="flex justify-end">
      <button class="bg-slate-900 text-white px-4 py-2 rounded" on:click={submit} disabled={loading}>{loading ? "Saving..." : "Save"}</button>
    </div>
  </div>
</div>

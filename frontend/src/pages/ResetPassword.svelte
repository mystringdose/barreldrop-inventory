<script>
  import { api } from "../lib/api.js";

  let token = "";
  let newPassword = "";
  let confirmPassword = "";
  let loading = false;
  let message = "";

  // read token from querystring
  try {
    const hash = window.location.hash || "";
    const qs = hash.includes("?") ? new URLSearchParams(hash.split("?")[1]) : new URLSearchParams("");
    token = qs.get("token") || "";
  } catch (e) {
    // ignore
  }

  async function submit() {
    message = "";
    if (newPassword !== confirmPassword) {
      message = "Passwords do not match";
      return;
    }
    loading = true;
    try {
      await api.resetPassword(token, newPassword);
      message = "Password reset. You can now sign in.";
      location.hash = "#/";
    } catch (err) {
      message = err.message || "Unable to reset password";
    } finally {
      loading = false;
    }
  }
</script>

<h2 class="text-lg font-semibold text-slate-900 mb-4">Reset Password</h2>

<div class="bg-white rounded shadow-sm p-4 mb-6 max-w-md">
  <div class="space-y-3">
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

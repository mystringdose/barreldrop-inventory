function resolveDefaultApiUrl() {
  if (typeof window === "undefined") return "http://localhost:4000";

  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4000";
  }

  if (hostname.startsWith("inventory.")) {
    return `${protocol}//api.${hostname.slice("inventory.".length)}`;
  }

  return `${protocol}//${hostname}`;
}

const API_URL = import.meta.env.VITE_API_URL || resolveDefaultApiUrl();

async function request(path, { method = "GET", body, headers } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Request failed");
  }

  return res.json();
}

export const api = {
  request,
  async login(email, password) {
    return request("/auth/login", { method: "POST", body: { email, password } });
  },
  async logout() {
    return request("/auth/logout", { method: "POST" });
  },
  async me() {
    return request("/auth/me");
  },
  async listItems() {
    return request("/items");
  },
  async getItems(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/items${qs ? `?${qs}` : ""}`);
  },
  async createItem(payload) {
    return request("/items", { method: "POST", body: payload });
  },
  async updateItem(id, payload) {
    return request(`/items/${id}`, { method: "PATCH", body: payload });
  },
  async getUsers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/users${qs ? `?${qs}` : ""}`);
  },
  async getSales(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/sales${qs ? `?${qs}` : ""}`);
  },
  async getReceipts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/stock-receipts${qs ? `?${qs}` : ""}`);
  },
  async updateItemStatus(id, status) {
    return request(`/items/${id}/status`, { method: "PATCH", body: { status } });
  },
  async listReceipts() {
    return request("/stock-receipts");
  },
  async listSales() {
    return request("/sales");
  },
  async createSale(payload) {
    return request("/sales", { method: "POST", body: payload });
  },
  async salesReport(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/sales${qs ? `?${qs}` : ""}`);
  },
  async profitLoss(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/profit-loss${qs ? `?${qs}` : ""}`);
  },
  async listUsers() {
    return request("/users");
  },
  async getAudit(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/audit${qs ? `?${qs}` : ""}`);
  },
  async createUser(payload) {
    return request("/users", { method: "POST", body: payload });
  },
  async updateUser(id, payload) {
    return request(`/users/${id}`, { method: "PATCH", body: payload });
  },
  async deleteUser(id) {
    return request(`/users/${id}`, { method: "DELETE" });
  },
  async bootstrapUser(payload) {
    return request("/users/bootstrap", { method: "POST", body: payload });
  },
  async forgotPassword(email) {
    return request("/auth/forgot-password", { method: "POST", body: { email } });
  },
  async resetPassword(token, newPassword) {
    return request("/auth/reset-password", { method: "POST", body: { token, newPassword } });
  },
  async changePassword(currentPassword, newPassword) {
    return request("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
  },
};

export function apiUrl(path) {
  return `${API_URL}${path}`;
}

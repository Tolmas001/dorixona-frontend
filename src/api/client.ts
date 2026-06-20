import type { Advertisement, ApiEnvelope, AuditLog, AuthState, BillingPlan, DashboardStats, OnlineOrder, Pharmacy, PharmacySubscription, PlatformSettings, Product, ProfitReport, Sale, ShiftReport, User } from '../types';
import { clearAuth, readAuth, saveAuth, storageKeys } from '../utils/storage';

const API_BASE = '';

type RequestOptions = RequestInit & { skipRefresh?: boolean };
type AuthEnvelope = ApiEnvelope<{
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: User;
}> & {
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: User;
};

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = localStorage.getItem(storageKeys.token);
  const hasBody = options.body !== undefined;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/refresh' && !options.skipRefresh && await refreshToken()) {
        return request<T>(path, { ...options, skipRefresh: true });
      }
      if (response.status === 401 && path !== '/auth/login' && path !== '/auth/register') {
        clearAuth();
      }
      throw new ApiError(data?.message || data?.error || 'Server bilan aloqa bo‘lmadi', response.status, data);
    }

    return data as T;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error instanceof Error ? error.message : 'Server bilan aloqa bo‘lmadi',
      0,
      null,
    );
  }
}

async function refreshToken(): Promise<boolean> {
  const refreshTokenValue = localStorage.getItem(storageKeys.refreshToken);
  if (!refreshTokenValue) return false;
  try {
    const data = await request<AuthEnvelope>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refreshTokenValue }),
      skipRefresh: true,
    });
    const token = data.token || data.accessToken || data.data?.token;
    if (!token) return false;
    saveAuth({
      token,
      refreshToken: data.refreshToken || data.data?.refreshToken || refreshTokenValue,
      user: data.user || data.data?.user || readAuth()?.user || {},
    });
    return true;
  } catch {
    return false;
  }
}

function unwrap<T>(envelope: ApiEnvelope<T>): T {
  return (envelope.data ?? envelope) as T;
}

export const api = {
  async login(email: string, password: string): Promise<AuthState> {
    const data = await request<AuthEnvelope>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const token = data.token || data.accessToken || data.data?.token;
    if (!token) throw new ApiError('Token qaytmadi', 400, data);
    return {
      token,
      refreshToken: data.refreshToken || data.data?.refreshToken,
      user: data.user || data.data?.user || {},
    };
  },

  async register(payload: { fullname: string; username?: string; email: string; password: string; phone: string }): Promise<ApiEnvelope<unknown>> {
    const fallbackUsername = payload.email.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30) || `user_${Date.now()}`;
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullname: payload.fullname,
        username: payload.username || fallbackUsername,
        email: payload.email,
        password: payload.password,
        phone: payload.phone,
      }),
    });
  },

  async me(): Promise<User> { return unwrap(await request<ApiEnvelope<User>>('/users/me')); },
  async updateMe(payload: Partial<User>): Promise<User> { return unwrap(await request<ApiEnvelope<User>>('/users/me', { method: 'PATCH', body: JSON.stringify(payload) })); },
  async products(): Promise<Product[]> { return unwrap(await request<ApiEnvelope<Product[]>>('/products')); },
  async createProduct(payload: Partial<Product>): Promise<Product> { return unwrap(await request<ApiEnvelope<Product>>('/products', { method: 'POST', body: JSON.stringify(payload) })); },
  async updateProduct(id: string, payload: Partial<Product>): Promise<Product> { return unwrap(await request<ApiEnvelope<Product>>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) })); },
  async uploadProductImage(id: string, file: File): Promise<Product> { const form = new FormData(); form.append('file', file); return unwrap(await request<ApiEnvelope<Product>>(`/products/${id}/image`, { method: 'POST', body: form })); },
  async deleteProduct(id: string): Promise<void> { await request<ApiEnvelope<unknown>>(`/products/${id}`, { method: 'DELETE' }); },
  async addStock(productId: string, payload: Record<string, unknown>): Promise<unknown> { return unwrap(await request<ApiEnvelope<unknown>>(`/products/${productId}/stock-batches`, { method: 'POST', body: JSON.stringify(payload) })); },
  async dashboard(): Promise<DashboardStats> { return unwrap(await request<ApiEnvelope<DashboardStats>>('/dashboard/stats')); },
  async sales(): Promise<Sale[]> { return unwrap(await request<ApiEnvelope<Sale[]>>('/sales')); },
  async createSale(payload: Record<string, unknown>): Promise<Sale> { return unwrap(await request<ApiEnvelope<Sale>>('/sales', { method: 'POST', body: JSON.stringify(payload) })); },
  async onlineOrders(): Promise<OnlineOrder[]> { return unwrap(await request<ApiEnvelope<OnlineOrder[]>>('/online-orders')); },
  async createOnlineOrder(payload: Record<string, unknown>): Promise<OnlineOrder> { return unwrap(await request<ApiEnvelope<OnlineOrder>>('/online-orders', { method: 'POST', body: JSON.stringify(payload) })); },
  async approveOrder(id: string): Promise<OnlineOrder> { return unwrap(await request<ApiEnvelope<OnlineOrder>>(`/online-orders/${id}/approve`, { method: 'PATCH' })); },
  async rejectOrder(id: string, reason = ''): Promise<OnlineOrder> { return unwrap(await request<ApiEnvelope<OnlineOrder>>(`/online-orders/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) })); },
  async superUsers(): Promise<User[]> { return unwrap(await request<ApiEnvelope<User[]>>('/super-admin/users')); },
  async superPharmacies(): Promise<Pharmacy[]> { return unwrap(await request<ApiEnvelope<Pharmacy[]>>('/super-admin/pharmacies')); },
  async updateUserRole(userId: string, role: string, pharmacyId?: string | null): Promise<User> { return unwrap(await request<ApiEnvelope<User>>(`/super-admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role, pharmacyId }) })); },
  async createPharmacy(payload: Pharmacy): Promise<Pharmacy> { return unwrap(await request<ApiEnvelope<Pharmacy>>('/super-admin/pharmacies', { method: 'POST', body: JSON.stringify(payload) })); },
  async updatePharmacy(id: string, payload: Partial<Pharmacy>): Promise<Pharmacy> { return unwrap(await request<ApiEnvelope<Pharmacy>>(`/super-admin/pharmacies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })); },
  async setPharmacyBlocked(id: string, blocked: boolean): Promise<Pharmacy> { return unwrap(await request<ApiEnvelope<Pharmacy>>(`/super-admin/pharmacies/${id}/${blocked ? 'block' : 'unblock'}`, { method: 'PATCH' })); },
  async setUserBlocked(id: string, blocked: boolean): Promise<User> { return unwrap(await request<ApiEnvelope<User>>(`/super-admin/users/${id}/${blocked ? 'block' : 'unblock'}`, { method: 'PATCH' })); },
  async superPharmacyDetail(id: string): Promise<Pharmacy> { return unwrap(await request<ApiEnvelope<Pharmacy>>(`/super-admin/pharmacies/${id}`)); },
  async globalStats(): Promise<Record<string, unknown>> { return unwrap(await request<ApiEnvelope<Record<string, unknown>>>('/super-admin/stats/global')); },
  async billingPlans(): Promise<BillingPlan[]> { return unwrap(await request<ApiEnvelope<BillingPlan[]>>('/billing/plans')); },
  async createBillingPlan(payload: BillingPlan): Promise<BillingPlan> { return unwrap(await request<ApiEnvelope<BillingPlan>>('/billing/plans', { method: 'POST', body: JSON.stringify(payload) })); },
  async updateBillingPlan(id: string, payload: Partial<BillingPlan>): Promise<BillingPlan> { return unwrap(await request<ApiEnvelope<BillingPlan>>(`/billing/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })); },
  async deleteBillingPlan(id: string): Promise<BillingPlan> { return unwrap(await request<ApiEnvelope<BillingPlan>>(`/billing/plans/${id}`, { method: 'DELETE' })); },
  async subscriptions(): Promise<PharmacySubscription[]> { return unwrap(await request<ApiEnvelope<PharmacySubscription[]>>('/billing/subscriptions')); },
  async assignSubscription(payload: { pharmacyId: string; planId: string; status?: string; autoRenew?: boolean }): Promise<unknown> { return unwrap(await request<ApiEnvelope<unknown>>('/billing/subscriptions', { method: 'POST', body: JSON.stringify(payload) })); },
  async updateSubscription(id: string, payload: Partial<PharmacySubscription>): Promise<PharmacySubscription> { return unwrap(await request<ApiEnvelope<PharmacySubscription>>(`/billing/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })); },
  async advertisements(activeOnly = false): Promise<Advertisement[]> { return unwrap(await request<ApiEnvelope<Advertisement[]>>(`/advertisements?activeOnly=${activeOnly ? 'true' : 'false'}`)); },
  async platformSettings(): Promise<PlatformSettings> { return unwrap(await request<ApiEnvelope<PlatformSettings>>('/platform-settings')); },
  async updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> { return unwrap(await request<ApiEnvelope<PlatformSettings>>('/platform-settings', { method: 'PUT', body: JSON.stringify({ settings }) })); },
  async createAdvertisement(payload: Advertisement): Promise<Advertisement> { return unwrap(await request<ApiEnvelope<Advertisement>>('/advertisements', { method: 'POST', body: JSON.stringify(payload) })); },
  async updateAdvertisement(id: string, payload: Partial<Advertisement>): Promise<Advertisement> { return unwrap(await request<ApiEnvelope<Advertisement>>(`/advertisements/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })); },
  async deleteAdvertisement(id: string): Promise<Advertisement> { return unwrap(await request<ApiEnvelope<Advertisement>>(`/advertisements/${id}`, { method: 'DELETE' })); },
  async uploadAdvertisementImage(id: string, file: File): Promise<Advertisement> { const form = new FormData(); form.append('file', file); return unwrap(await request<ApiEnvelope<Advertisement>>(`/advertisements/${id}/image`, { method: 'POST', body: form })); },
  async auditLogs(): Promise<AuditLog[]> { return unwrap(await request<ApiEnvelope<AuditLog[]>>('/audit-logs')); },
  async profitReport(): Promise<ProfitReport> { return unwrap(await request<ApiEnvelope<ProfitReport>>('/reports/profit')); },
  async shiftReport(): Promise<ShiftReport> { return unwrap(await request<ApiEnvelope<ShiftReport>>('/reports/shift')); },
};
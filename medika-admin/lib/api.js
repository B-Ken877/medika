const API_BASE = '/api';

export async function apiFetch(endpoint, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('medika_admin_token') : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();

  if (res.status === 401 || res.status === 403) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('medika_admin_token');
      localStorage.removeItem('medika_admin_user');
      window.location.href = '/login';
    }
  }

  if (!res.ok) {
    throw new Error(data.error || `Erreur ${res.status}`);
  }

  return data;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-HT', { style: 'decimal', minimumFractionDigits: 0 }).format(amount) + ' HTG';
}

export function formatDate(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDateShort(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function statusLabel(status) {
  const map = {
    'RECHERCHE_MEDECIN': 'En attente',
    'EN_COURS': 'En cours',
    'TERMINE': 'Terminée',
    'REFUSE': 'Refusée',
  };
  return map[status] || status;
}

export function statusBadge(status) {
  const map = {
    'RECHERCHE_MEDECIN': 'badge-yellow',
    'EN_COURS': 'badge-blue',
    'TERMINE': 'badge-green',
    'REFUSE': 'badge-red',
  };
  return map[status] || 'badge-gray';
}
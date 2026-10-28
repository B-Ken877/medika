'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Administrator login — Clinical Calm redesign.
 * Auth behavior unchanged: POST /api/admin/auth/login, token + user persisted
 * to localStorage, redirect to /dashboard.
 */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
      localStorage.setItem('medika_admin_token', data.token);
      localStorage.setItem('medika_admin_user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <span className="brand-mark" aria-hidden>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-word">Medika</span>
        </div>

        <h1 className="admin-login-title">Administration Medika</h1>
        <p className="admin-login-sub">Connectez-vous pour accéder à l&apos;espace d&apos;administration.</p>

        {error && (
          <div className="admin-login-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="admin-username">Nom d&apos;utilisateur</label>
            <input
              className="form-input"
              id="admin-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="admin-password">Mot de passe</label>
            <input
              className="form-input"
              id="admin-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary admin-login-submit">
            {loading ? (
              <>
                <span className="spin" aria-hidden /> Connexion…
              </>
            ) : (
              'Se connecter'
            )}
          </button>
        </form>

        <p className="admin-login-note">Accès réservé aux administrateurs Medika.</p>
      </div>
    </div>
  );
}

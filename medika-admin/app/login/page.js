'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #059669 0%, #047857 50%, #065f46 100%)'
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: 32, background: '#fff',
        borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: '#059669',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 24, marginBottom: 16
          }}>M</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Medika Admin</h1>
          <p style={{ fontSize: 14, color: '#6b7280' }}>Connectez-vous au panneau d&apos;administration</p>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', background: '#fee2e2', color: '#dc2626',
            borderRadius: 8, fontSize: 13, marginBottom: 16, fontWeight: 500
          }}>{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Nom d&apos;utilisateur</label>
            <input className="form-input" type="text" value={username}
              onChange={e => setUsername(e.target.value)} placeholder="admin" required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <input className="form-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="........" required />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: 15, marginTop: 8 }}>
            {loading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Connexion...
              </span>
            ) : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
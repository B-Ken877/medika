'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, AlertCircle, Activity } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      minHeight: '100vh',
      display: 'flex',
      background: '#060D18',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>

      {/* Left panel – brand */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 56px',
        background: 'linear-gradient(160deg, #060D18 0%, #0A1628 60%, #07361E 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>

        {/* Decorative glow orb */}
        <div style={{
          position: 'absolute',
          bottom: '-15%',
          left: '-10%',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(5,150,105,0.18) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          top: '15%',
          right: '-5%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(5,150,105,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 42, height: 42,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 900, fontSize: 20,
            boxShadow: '0 0 0 1px rgba(5,150,105,0.4), 0 8px 20px rgba(5,150,105,0.4)',
          }}>M</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 20, letterSpacing: '-0.04em' }}>Medika</div>
            <div style={{ color: 'rgba(148,163,184,0.6)', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Administration
            </div>
          </div>
        </div>

        {/* Center content */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(5,150,105,0.12)',
            border: '1px solid rgba(5,150,105,0.25)',
            borderRadius: 100,
            padding: '5px 14px',
            marginBottom: 28,
          }}>
            <Activity size={13} color="#10B981" />
            <span style={{ color: '#10B981', fontSize: 12, fontWeight: 600 }}>Plateforme active</span>
          </div>

          <h1 style={{
            color: '#fff', fontSize: 42, fontWeight: 900,
            letterSpacing: '-0.04em', lineHeight: 1.1,
            marginBottom: 16,
          }}>
            La santé,<br />
            <span style={{
              background: 'linear-gradient(135deg, #34D399, #059669)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>accessible à tous.</span>
          </h1>

          <p style={{
            color: 'rgba(148,163,184,0.75)', fontSize: 15, lineHeight: 1.7,
            maxWidth: 380, fontWeight: 400,
          }}>
            Gérez les médecins, les patients et les consultations depuis un seul panneau de contrôle sécurisé.
          </p>

          {/* Stats row */}
          <div style={{
            display: 'flex', gap: 28, marginTop: 44,
            paddingTop: 36,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            {[
              { value: '24/7', label: 'Disponibilité' },
              { value: 'SSL', label: 'Sécurisé' },
              { value: 'HTG', label: 'Devise locale' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 20, letterSpacing: '-0.03em' }}>{s.value}</div>
                <div style={{ color: 'rgba(148,163,184,0.5)', fontSize: 11, fontWeight: 600, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ color: 'rgba(148,163,184,0.3)', fontSize: 12, position: 'relative', zIndex: 1 }}>
          © {new Date().getFullYear()} Medika — Tous droits réservés
        </div>
      </div>

      {/* Right panel – form */}
      <div style={{
        width: 480,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        background: '#F0F4F8',
        flexShrink: 0,
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          <div style={{ marginBottom: 36 }}>
            <h2 style={{
              fontSize: 26, fontWeight: 800, color: '#0F172A',
              letterSpacing: '-0.04em', marginBottom: 8,
            }}>Connexion</h2>
            <p style={{ color: '#64748B', fontSize: 14, fontWeight: 400 }}>
              Accédez à votre panneau d&apos;administration
            </p>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 10,
              marginBottom: 20,
              color: '#DC2626',
              fontSize: 13.5,
              fontWeight: 500,
              animation: 'slideUp 150ms ease',
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 700,
                color: '#475569', marginBottom: 6, letterSpacing: '-0.01em'
              }}>
                Nom d&apos;utilisateur
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                required
                autoFocus
                style={{
                  width: '100%', padding: '11px 14px',
                  border: '1px solid #E2E8F0',
                  borderRadius: 10,
                  fontSize: 14, color: '#0F172A',
                  background: '#fff',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 150ms ease, box-shadow 150ms ease',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#059669';
                  e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#E2E8F0';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 700,
                color: '#475569', marginBottom: 6, letterSpacing: '-0.01em'
              }}>
                Mot de passe
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: '100%', padding: '11px 42px 11px 14px',
                    border: '1px solid #E2E8F0',
                    borderRadius: 10,
                    fontSize: 14, color: '#0F172A',
                    background: '#fff',
                    outline: 'none',
                    fontFamily: 'inherit',
                    transition: 'border-color 150ms ease, box-shadow 150ms ease',
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#059669';
                    e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = '#E2E8F0';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#94A3B8', padding: 2, display: 'flex',
                  }}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px 20px',
                background: loading
                  ? 'rgba(5,150,105,0.6)'
                  : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 14.5, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 150ms ease',
                fontFamily: 'inherit',
                letterSpacing: '-0.01em',
                boxShadow: loading ? 'none' : '0 4px 14px rgba(5,150,105,0.35)',
              }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{ width: 17, height: 17, borderWidth: 2 }} />
                  Connexion...
                </>
              ) : (
                'Se connecter →'
              )}
            </button>
          </form>

          <div style={{
            marginTop: 28, paddingTop: 24,
            borderTop: '1px solid #E2E8F0',
            textAlign: 'center',
            color: '#94A3B8', fontSize: 12, fontWeight: 500,
          }}>
            Accès réservé aux administrateurs Medika
          </div>
        </div>
      </div>

    </div>
  );
}

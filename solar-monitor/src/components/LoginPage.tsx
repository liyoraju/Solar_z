import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { Sun, Lock, Mail, Hash, Loader2, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inverterSn, setInverterSn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const accentColor = {
    morning: '#E87A2A',
    afternoon: '#1A7AE8',
    evening: '#C45D3A',
    night: '#5BA3F5',
  }[timeOfDay];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isRegister) {
        if (!inverterSn.trim()) {
          setError('Serial number is required');
          setLoading(false);
          return;
        }
        const result = await register(email, password, inverterSn.trim());
        if (!result.success) setError(result.error || 'Registration failed');
        else setSuccess('Account created successfully!');
      } else {
        const result = await login(email, password);
        if (!result.success) setError(result.error || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${themeColors.bg} transition-colors duration-[2000ms]`}>
      <div className={`w-full max-w-md rounded-2xl ${themeColors.surface} shadow-2xl p-8 border ${themeColors.border}`}>
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}20` }}
          >
            <Sun className="w-8 h-8" style={{ color: accentColor }} />
          </div>
          <h1 className={`text-2xl font-bold ${themeColors.text}`}>Solar Monitor</h1>
          <p className={`text-sm ${themeColors.textSecondary} mt-1`}>
            {isRegister ? 'Create your account' : 'Sign in to your account'}
          </p>
        </div>

        {/* Success message */}
        {success && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label className={`text-xs font-medium ${themeColors.textSecondary} mb-1.5 block`}>Email</label>
            <div className="relative">
              <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${themeColors.textSecondary}`} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm ${themeColors.bg} border ${themeColors.border} ${themeColors.text} focus:outline-none focus:ring-2`}
                style={{ focusRingColor: accentColor } as React.CSSProperties}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className={`text-xs font-medium ${themeColors.textSecondary} mb-1.5 block`}>Password</label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${themeColors.textSecondary}`} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className={`w-full pl-10 pr-10 py-2.5 rounded-xl text-sm ${themeColors.bg} border ${themeColors.border} ${themeColors.text} focus:outline-none focus:ring-2`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${themeColors.textSecondary} hover:${themeColors.text}`}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Inverter SN (register only) */}
          {isRegister && (
            <div>
              <label className={`text-xs font-medium ${themeColors.textSecondary} mb-1.5 block`}>Inverter Serial Number</label>
              <div className="relative">
                <Hash className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${themeColors.textSecondary}`} />
                <input
                  type="text"
                  value={inverterSn}
                  onChange={(e) => setInverterSn(e.target.value)}
                  placeholder="e.g. SUN-3K-G03-XXXXXX"
                  required
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm ${themeColors.bg} border ${themeColors.border} ${themeColors.text} focus:outline-none focus:ring-2`}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: accentColor }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isRegister ? 'Creating account...' : 'Signing in...'}
              </>
            ) : (
              isRegister ? 'Create Account' : 'Sign In'
            )}
          </button>
        </form>

        {/* Toggle login/register */}
        <div className="mt-6 text-center">
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); setSuccess(''); }}
            className={`text-sm ${themeColors.textSecondary} hover:${themeColors.text} transition-colors`}
            style={{ color: accentColor }}
          >
            {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
          </button>
        </div>
      </div>
    </div>
  );
};

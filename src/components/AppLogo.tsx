import React, { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';

export type AppLogoVariant =
  | 'symbol'
  | 'square'
  | 'full'
  | 'full-dark'
  | 'full-light'
  | 'mono-white'
  | 'mono-dark'
  | 'transparent';

interface AppLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: AppLogoVariant;
  src?: string;
  alt?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'square',
  src,
  alt = 'CanoShift',
}) => {
  const { isDark } = useTheme();
  const isDarkActive = isDark;

  const getCandidatePaths = (): string[] => {
    if (src) return [src];
    switch (variant) {
      case 'full':
        return isDarkActive
          ? [import.meta.env.BASE_URL + 'logo-full-dark.svg', import.meta.env.BASE_URL + 'logo.svg', import.meta.env.BASE_URL + 'logo-full-light.svg']
          : [import.meta.env.BASE_URL + 'logo-full-light.svg', import.meta.env.BASE_URL + 'logo-full-dark.svg', import.meta.env.BASE_URL + 'logo.svg'];
      case 'full-dark':
        return [import.meta.env.BASE_URL + 'logo-full-dark.svg', import.meta.env.BASE_URL + 'logo.svg'];
      case 'full-light':
        return [import.meta.env.BASE_URL + 'logo-full-light.svg'];
      case 'symbol':
        return [import.meta.env.BASE_URL + 'logo-symbol.svg', import.meta.env.BASE_URL + 'logo-symbol-transparent.svg', import.meta.env.BASE_URL + 'logo-symbol-square.svg', import.meta.env.BASE_URL + 'icon.svg'];
      case 'transparent':
        return [import.meta.env.BASE_URL + 'logo-symbol-transparent.svg', import.meta.env.BASE_URL + 'logo-symbol.svg'];
      case 'mono-white':
        return [import.meta.env.BASE_URL + 'logo-symbol-mono-white.svg', import.meta.env.BASE_URL + 'logo-symbol.svg'];
      case 'mono-dark':
        return [import.meta.env.BASE_URL + 'logo-symbol-mono-dark.svg', import.meta.env.BASE_URL + 'logo-symbol.svg'];
      case 'square':
      default:
        return [import.meta.env.BASE_URL + 'logo-symbol-square.svg', import.meta.env.BASE_URL + 'icon.svg', import.meta.env.BASE_URL + 'icon-192.png', import.meta.env.BASE_URL + 'logo.svg'];
    }
  };

  const candidates = getCandidatePaths();
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasErrorAll, setHasErrorAll] = useState(false);

  useEffect(() => {
    setCandidateIndex(0);
    setHasErrorAll(false);
  }, [isDarkActive, variant, src]);

  const handleImageError = () => {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((prev) => prev + 1);
    } else {
      setHasErrorAll(true);
    }
  };

  // If full logo with typography (rectangular)
  if (variant === 'full' || variant === 'full-dark' || variant === 'full-light') {
    const fullHeightClasses = {
      xs: 'h-8',
      sm: 'h-10',
      md: 'h-12',
      lg: 'h-16',
      xl: 'h-20',
    }[size];

    const currentSrc = candidates[candidateIndex];

    return (
      <div className={`inline-flex items-center select-none ${fullHeightClasses} ${className}`}>
        <img
          src={currentSrc}
          alt={alt}
          onError={handleImageError}
          className="h-full w-auto max-w-full object-contain pointer-events-none"
        />
      </div>
    );
  }

  // Square or symbol icons
  const sizeClasses = {
    xs: 'w-6 h-6 rounded-md',
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-16 h-16 rounded-2xl shadow-lg shadow-emerald-950/40',
    xl: 'w-20 h-20 rounded-3xl shadow-xl shadow-emerald-950/50',
  }[size];

  if (hasErrorAll) {
    return (
      <div
        className={`flex items-center justify-center bg-emerald-950 border border-emerald-500/30 text-emerald-400 shrink-0 ${sizeClasses} ${className}`}
        title={alt}
      >
        <svg
          className={size === 'sm' || size === 'xs' ? 'w-4 h-4 text-emerald-400' : 'w-8 h-8 text-emerald-300'}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12c0-3.5 1.5-6.5 4-8.5" />
          <path d="M8 12c2-4 6-4 8 0" />
          <path d="M12 8v8" />
        </svg>
      </div>
    );
  }

  const currentSrc = candidates[candidateIndex];

  return (
    <div
      className={`relative overflow-hidden shrink-0 flex items-center justify-center ${
        variant === 'transparent' ? '' : 'bg-slate-900/40'
      } ${sizeClasses} ${className}`}
    >
      <img
        src={currentSrc}
        alt={alt}
        onError={handleImageError}
        className="w-full h-full object-contain select-none pointer-events-none"
      />
    </div>
  );
};

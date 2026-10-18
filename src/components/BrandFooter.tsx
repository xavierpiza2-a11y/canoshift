import React from 'react';
import { AppLogo } from './AppLogo';

interface BrandFooterProps {
  className?: string;
}

export const BrandFooter: React.FC<BrandFooterProps> = ({ className = '' }) => {
  return (
    <div className={`w-full flex flex-col items-center justify-center py-6 text-center select-none ${className}`}>
      <div className="inline-flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
        <AppLogo size="md" variant="full" className="shadow-2xs" />
      </div>
    </div>
  );
};

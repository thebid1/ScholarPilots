'use client';

import AppLogo from './AppLogo';

export default function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 page-bg flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 animate-pulse">
        <AppLogo size={72} priority />
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-primary">ScholarPilot</h1>
          <p className="text-sm text-secondary mt-1">Your AI scholarship copilot</p>
        </div>
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
      </div>
    </div>
  );
}

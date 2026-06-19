'use client';

import { useEffect, useState } from 'react';
import { X, Share2, PlusSquare, Download, Menu } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'scholarpilot_install_prompt_dismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const alreadyDismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

    if (alreadyDismissed || isStandalone) return;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return;

    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: boolean }).MSStream);
    setIsAndroid(/Android/.test(navigator.userAgent));
    setShow(true);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  }

  function dismiss() {
    setShow(false);
    localStorage.setItem(DISMISSED_KEY, '1');
  }

  if (!show) return null;

  return (
    <div className="card-elevated p-4 mb-4 relative">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 p-1.5 rounded-full text-tertiary hover:bg-[var(--surface-muted)] transition-colors"
        aria-label="Dismiss install prompt"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="w-10 h-10 rounded-xl gradient-emerald text-white flex items-center justify-center shrink-0">
          <Download className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-extrabold text-primary text-sm">Install ScholarPilot</h3>
          <p className="text-xs text-secondary mt-0.5">
            Add this app to your home screen for the best experience.
          </p>
        </div>
      </div>

      {deferredPrompt && (
        <button
          onClick={handleInstall}
          className="w-full mt-3 btn-primary text-sm py-2.5"
        >
          <Download className="w-4 h-4" />
          Install app
        </button>
      )}

      {!deferredPrompt && isIOS && (
        <div className="mt-3 text-xs text-secondary space-y-1.5">
          <p className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[var(--surface-muted)] flex items-center justify-center">
              <Share2 className="w-3 h-3" />
            </span>
            Tap the <strong className="text-primary">Share</strong> button in Safari.
          </p>
          <p className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[var(--surface-muted)] flex items-center justify-center">
              <PlusSquare className="w-3 h-3" />
            </span>
            Choose <strong className="text-primary">Add to Home Screen</strong>.
          </p>
        </div>
      )}

      {!deferredPrompt && isAndroid && (
        <div className="mt-3 text-xs text-secondary space-y-1.5">
          <p className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[var(--surface-muted)] flex items-center justify-center">
              <Menu className="w-3 h-3" />
            </span>
            Tap the Chrome menu (⋮) and choose <strong className="text-primary">Add to Home screen</strong>.
          </p>
        </div>
      )}

      {!deferredPrompt && !isIOS && !isAndroid && (
        <div className="mt-3 text-xs text-secondary space-y-1.5">
          <p className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[var(--surface-muted)] flex items-center justify-center">
              <Menu className="w-3 h-3" />
            </span>
            Open your browser menu and choose <strong className="text-primary">Install / Add to Home Screen</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { Bot } from 'lucide-react';

export default function ChatFAB() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push('/chat')}
      className="fixed right-4 bottom-24 md:bottom-6 z-40 w-14 h-14 rounded-full gradient-emerald text-white shadow-xl flex items-center justify-center active:scale-90 transition-transform"
      aria-label="Open AI chat"
    >
      <Bot className="w-6 h-6" />
    </button>
  );
}

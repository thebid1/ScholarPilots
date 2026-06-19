'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatMessage } from '@/app/types';
import { getChat } from '@/app/lib/storage';
import {
  Home,
  Search,
  ClipboardList,
  MessageSquare,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import AppLogo from './AppLogo';

const links = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/opportunities', label: 'Discover', icon: Search },
  { href: '/applications', label: 'Pipeline', icon: ClipboardList },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
];

function useChatHistory() {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  useEffect(() => {
    setHistory(getChat());
  }, []);
  return history;
}

function ChatHistoryList({ history }: { history: ChatMessage[] }) {
  if (history.length === 0) {
    return <p className="text-xs text-tertiary px-3 py-2">No messages yet.</p>;
  }
  return (
    <div className="space-y-1">
      {history.slice(-8).map((msg, idx) => {
        const isUser = msg.role === 'user';
        return (
          <div key={idx} className="px-3 py-2 rounded-lg hover:bg-[var(--surface-muted)] cursor-default transition-colors">
            <p className="text-[10px] font-bold text-tertiary mb-0.5">{isUser ? 'You' : 'ScholarPilot'}</p>
            <p className="text-xs text-secondary line-clamp-2">{msg.content}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const history = useChatHistory();
  const isChat = pathname === '/chat';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-50 surface-elevated border-t border-[var(--border)] safe-bottom shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-around px-1 py-2">
          {links.map((link) => {
            const Icon = link.icon;
            const active = mounted && pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors min-w-[64px] ${
                  active ? 'text-[var(--primary)]' : 'text-tertiary'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5px]' : ''}`} />
                <span className="text-[9px] font-bold">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-[100dvh] sticky top-0 border-r border-[var(--border)] surface px-4 py-6">
        <Link href="/" className="flex items-center gap-3 font-bold text-xl px-2 mb-8 text-primary">
          <AppLogo size={48} />
          ScholarPilot
        </Link>

        <nav className="space-y-1.5 mb-6">
          {links.map((link) => {
            const Icon = link.icon;
            const active = mounted && pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  active ? 'gradient-emerald text-white shadow-md' : 'text-secondary hover:bg-[var(--surface-muted)]'
                }`}
              >
                <Icon className="w-5 h-5" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {isChat && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex items-center gap-2 px-3 mb-2 text-xs font-bold uppercase tracking-wide text-tertiary">
              <MessageCircle className="w-3.5 h-3.5" />
              Chat history
            </div>
            <ChatHistoryList history={history} />
          </div>
        )}

        <div className="mt-auto px-4 py-4 rounded-2xl text-xs text-secondary" style={{ backgroundColor: 'var(--primary-fade)' }}>
          <div className="flex items-center gap-2 mb-2 font-bold" style={{ color: 'var(--primary)' }}>
            <Sparkles className="w-3.5 h-3.5" />
            Demo prototype
          </div>
          Your data is stored locally on this device.
        </div>
      </aside>
    </>
  );
}

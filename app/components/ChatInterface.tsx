'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { UserProfile, Application, ChatMessage, Scholarship } from '@/app/types';
import { useChatThreads } from '@/app/hooks/useChatThreads';
import {
  Send,
  Loader2,
  User,
  Bot,
  Plus,
  MessageSquare,
  Trash2,
  X,
  PanelLeft,
} from 'lucide-react';

interface ChatInterfaceProps {
  profile: UserProfile;
  applications: Application[];
}

/** Key the Discover card writes the full opportunity into before navigating. */
const FOCUS_KEY = 'scholarpilot_chat_focus';

/** What the copilot is asked on the user's behalf when a thread opens from Discover. */
const OPENING_QUESTION =
  'Tell me about this opportunity, whether I qualify based on my profile, and what I should strengthen before applying.';

export default function ChatInterface({ profile, applications }: ChatInterfaceProps) {
  const searchParams = useSearchParams();
  const scholarshipId = searchParams?.get('scholarship') ?? null;

  const {
    threads,
    activeId,
    messages,
    setMessages,
    loading: threadsLoading,
    open,
    create,
    persist,
    remove,
    startBlank,
  } = useChatThreads();

  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [focus, setFocus] = useState<Scholarship | null>(null);
  const [input, setInput] = useState('');
  const [replying, setReplying] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, replying]);

  // The same filtered list Discover shows. Chat used to read the raw catalog, so
  // it would offer an Agriculture student awards the filter had already ruled
  // out — the two screens disagreed about what was available.
  useEffect(() => {
    let cancelled = false;

    fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.scholarships) setScholarships(data.scholarships);
      })
      .catch(() => {
        /* Chat degrades to profile + pipeline context. */
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  /**
   * Send a turn and persist the result.
   *
   * Takes the thread id and history explicitly rather than reading state: the
   * opening message of a brand-new thread is sent in the same tick the thread is
   * created, before `activeId` and `messages` have propagated.
   */
  const send = useCallback(
    async (text: string, threadId: string, history: ChatMessage[], about: Scholarship | null) => {
      const userMessage: ChatMessage = {
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };
      const withUser = [...history, userMessage];
      setMessages(withUser);
      setReplying(true);
      setError(null);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile,
            applications,
            scholarships,
            focus: about,
            messages: withUser.map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        const data = await response.json();
        const reply: ChatMessage = {
          role: 'model',
          content: response.ok
            ? data.reply
            : data.error || 'Sorry, something went wrong. Please try again.',
          timestamp: new Date().toISOString(),
        };

        const complete = [...withUser, reply];
        setMessages(complete);
        // One write per exchange, carrying both turns.
        await persist(threadId, complete);
      } catch {
        const failure: ChatMessage = {
          role: 'model',
          content: 'Sorry, something went wrong. Please try again.',
          timestamp: new Date().toISOString(),
        };
        setMessages([...withUser, failure]);
        setError('That message did not go through.');
      } finally {
        setReplying(false);
      }
    },
    [profile, applications, scholarships, persist, setMessages]
  );

  /**
   * Open a thread from Discover.
   *
   * Runs once per scholarship id — the ref guards against React's double-invoked
   * effects, which would otherwise create two threads and fire two model calls.
   */
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!scholarshipId || threadsLoading) return;
    if (openedFor.current === scholarshipId) return;
    openedFor.current = scholarshipId;

    let opportunity: Scholarship | null = null;
    try {
      const raw = sessionStorage.getItem(FOCUS_KEY);
      if (raw) opportunity = JSON.parse(raw) as Scholarship;
      sessionStorage.removeItem(FOCUS_KEY);
    } catch {
      /* Fall through to the catalog lookup below. */
    }
    if (!opportunity) {
      opportunity = scholarships.find((s) => s.id === scholarshipId) ?? null;
    }
    if (!opportunity) return;

    setFocus(opportunity);
    setShowThreads(false);

    (async () => {
      const existing = threads.find((t) => t.scholarshipId === scholarshipId);
      if (existing) {
        // Reuse the thread rather than starting a second one about the same award.
        await open(existing.id);
        return;
      }
      const id = await create(opportunity.title, scholarshipId);
      if (id) await send(OPENING_QUESTION, id, [], opportunity);
    })();
  }, [scholarshipId, threadsLoading, threads, scholarships, open, create, send]);

  /** Keep `focus` in step with whichever thread is open. */
  useEffect(() => {
    if (!activeId) return;
    const thread = threads.find((t) => t.id === activeId);
    if (!thread?.scholarshipId) {
      setFocus(null);
      return;
    }
    setFocus((current) =>
      current?.id === thread.scholarshipId
        ? current
        : scholarships.find((s) => s.id === thread.scholarshipId) ?? current
    );
  }, [activeId, threads, scholarships]);

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || replying) return;
    setInput('');

    let threadId = activeId;
    if (!threadId) {
      // First message of a fresh conversation names the thread.
      threadId = await create(text.length > 40 ? `${text.slice(0, 40)}…` : text);
      if (!threadId) {
        setError('Could not start that chat.');
        return;
      }
      await send(text, threadId, [], focus);
      return;
    }

    await send(text, threadId, messages, focus);
  }

  function startNewThread() {
    openedFor.current = null;
    setFocus(null);
    setShowThreads(false);
    // No Firestore write yet — the thread is created when the first message is
    // sent, so an abandoned "New chat" leaves nothing behind.
    startBlank();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const quickActions = focus
    ? [
        'What are my chances of meeting the eligibility criteria?',
        'Help me plan my application timeline',
        'What should my personal statement focus on?',
      ]
    : [
        'What are my upcoming deadlines?',
        'Find scholarships for me',
        'Help me tailor my SOP',
      ];

  return (
    <div className="flex h-full page-bg">
      {/* Thread list */}
      <aside
        className={`${
          showThreads ? 'flex' : 'hidden'
        } md:flex flex-col w-full md:w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] absolute md:relative inset-0 z-20`}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)] safe-top">
          <span className="text-xs font-bold uppercase tracking-wide text-tertiary">Chats</span>
          <button
            onClick={() => setShowThreads(false)}
            className="md:hidden p-1 text-tertiary"
            aria-label="Close chat list"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={startNewThread}
          className="flex items-center gap-2 mx-3 mt-3 px-3 py-2.5 rounded-xl text-sm font-bold btn-primary"
        >
          <Plus className="w-4 h-4" />
          New chat
        </button>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {threadsLoading && (
            <p className="px-2 text-xs text-tertiary">Loading…</p>
          )}
          {!threadsLoading && threads.length === 0 && (
            <p className="px-2 text-xs text-tertiary leading-relaxed">
              No chats yet. Ask a question, or open one from an opportunity in Discover.
            </p>
          )}
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={`group flex items-center gap-1.5 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
                thread.id === activeId ? 'surface-muted' : 'hover:surface-muted'
              }`}
              onClick={() => {
                void open(thread.id);
                setShowThreads(false);
              }}
            >
              <MessageSquare
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: thread.scholarshipId ? 'var(--primary)' : 'var(--text-tertiary)' }}
              />
              <span className="flex-1 min-w-0 truncate text-sm text-primary">{thread.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(thread.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-tertiary hover:text-[var(--red)] transition-all"
                aria-label={`Delete ${thread.title}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        <div className="flex items-center gap-3 px-4 py-3 safe-top border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-md shrink-0">
          <button
            onClick={() => setShowThreads(true)}
            className="md:hidden p-1.5 -ml-1.5 rounded-lg surface-muted text-secondary"
            aria-label="Show chats"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-extrabold text-primary truncate">
              {focus ? focus.title : 'Pilot'}
            </h1>
            <p
              className="text-[10px] font-bold uppercase tracking-wide truncate"
              style={{ color: 'var(--primary)' }}
            >
              {focus ? focus.funder : 'AI Copilot'}
            </p>
          </div>
          <div className="w-8 h-8 rounded-full gradient-emerald text-white flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" />
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
          style={{ backgroundColor: 'var(--background)' }}
        >
          {messages.length === 0 && !replying && (
            <div className="text-center pt-10 px-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl gradient-emerald text-white mb-4 shadow-lg">
                <Bot className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-extrabold text-primary mb-1">
                Hi, {profile.name.split(' ')[0]}
              </h2>
              <p className="text-sm text-secondary mb-6 max-w-xs mx-auto">
                I can find scholarships, tailor your SOP, review your CV, and keep deadlines on
                track.
              </p>
              <div className="flex flex-col items-center gap-2">
                {quickActions.map((action) => (
                  <button
                    key={action}
                    onClick={() => handleSend(action)}
                    className="px-3.5 py-2 rounded-full text-xs font-bold transition-all border border-[var(--border)] card active:scale-95 max-w-xs"
                    style={{ color: 'var(--primary)' }}
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`flex max-w-[92%] gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div
                    className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${
                      isUser ? 'gradient-emerald text-white' : 'card text-secondary'
                    }`}
                  >
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      isUser
                        ? 'gradient-emerald text-white rounded-br-none'
                        : 'card text-primary rounded-bl-none'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                    <span
                      className={`block text-[10px] mt-1.5 ${
                        isUser ? 'text-white/70' : 'text-tertiary'
                      }`}
                    >
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {replying && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 card px-4 py-2.5 rounded-2xl rounded-bl-none text-sm text-secondary shadow-sm">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--primary)' }} />
                Pilot is thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shrink-0">
          {error && <p className="mb-2 text-xs text-[var(--red)]">{error}</p>}
          <div className="flex items-start gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={focus ? `Ask about ${focus.title}…` : 'Ask ScholarPilot...'}
              rows={1}
              className="input flex-1 resize-none max-h-32"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || replying}
              className="self-end p-3 rounded-xl gradient-emerald text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] shrink-0 shadow-md"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

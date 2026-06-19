'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { UserProfile, Application, ChatMessage } from '@/app/types';
import { saveChat } from '@/app/lib/storage';
import {
  generateScholarshipMatches,
  generateSOP,
  generateCVFeedback,
  generateDeadlinesResponse,
  generateGeneralResponse,
  parseScholarshipNameFromMessage,
} from '@/app/lib/gemini';
import { useScholarships } from '@/app/lib/scholarships';
import {
  Send,
  Paperclip,
  Sparkles,
  FileText,
  Search,
  CalendarClock,
  Loader2,
  User,
  Bot,
  X,
} from 'lucide-react';

interface ChatInterfaceProps {
  profile: UserProfile;
  applications: Application[];
}

export default function ChatInterface({ profile, applications }: ChatInterfaceProps) {
  const { scholarships: allScholarships } = useScholarships();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (messages.length > 0) saveChat(messages);
  }, [messages]);

  function addMessage(message: ChatMessage) {
    setMessages((prev) => [...prev, message]);
  }

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMessage);
    setInput('');
    setLoading(true);

    let responseText = '';
    let type: ChatMessage['type'] = 'general';
    const lower = text.toLowerCase();

    try {
      if (lower.includes('find') && lower.includes('scholarship')) {
        responseText = await generateScholarshipMatches(profile, allScholarships);
      } else if (lower.includes('scholarship') && (lower.includes('match') || lower.includes('suitable'))) {
        responseText = await generateScholarshipMatches(profile, allScholarships);
      } else if (parseScholarshipNameFromMessage(text)) {
        const name = parseScholarshipNameFromMessage(text)!;
        responseText = await generateSOP(profile, name, allScholarships);
        type = 'sop';
      } else if ((lower.includes('review') || lower.includes('feedback')) && (lower.includes('cv') || lower.includes('resume'))) {
        responseText = await generateCVFeedback(profile);
        type = 'cv';
      } else if (lower.includes('deadline') || lower.includes('upcoming')) {
        responseText = await generateDeadlinesResponse(profile, applications, allScholarships);
      } else {
        const history = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));
        responseText = await generateGeneralResponse(profile, history);
      }
    } catch (err) {
      console.error(err);
      responseText = 'Sorry, something went wrong. Please try again.';
    } finally {
      setLoading(false);
    }

    addMessage({
      role: 'model',
      content: responseText,
      timestamp: new Date().toISOString(),
      type,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  }

  const quickActions = [
    { label: 'Find', icon: Search, text: 'Find scholarships for me' },
    { label: 'SOP', icon: FileText, text: 'Tailor my SOP for Chevening' },
    { label: 'CV', icon: Sparkles, text: 'Review my CV' },
    { label: 'Deadlines', icon: CalendarClock, text: 'What are my upcoming deadlines?' },
  ];

  return (
    <div className="flex flex-col h-full page-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 safe-top border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-md shrink-0">
        <div>
          <h1 className="text-lg font-extrabold text-primary">Pilot</h1>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>AI Copilot</p>
        </div>
        <div className="w-8 h-8 rounded-full gradient-emerald text-white flex items-center justify-center">
          <Bot className="w-4 h-4" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ backgroundColor: 'var(--background)' }}>
        {messages.length === 0 && (
          <div className="text-center pt-10 px-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl gradient-emerald text-white mb-4 shadow-lg">
              <Bot className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-extrabold text-primary mb-1">Hi, {profile.name.split(' ')[0]}</h2>
            <p className="text-sm text-secondary mb-6 max-w-xs mx-auto">I can find scholarships, tailor your SOP, review your CV, and keep deadlines on track.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    onClick={() => handleSend(action.text)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-all border border-[var(--border)] card active:scale-95"
                    style={{ color: 'var(--primary)' }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          return (
            <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[92%] gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
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
                  {isUser ? <p className="whitespace-pre-wrap">{msg.content}</p> : <div className="prose prose-sm max-w-none"><ReactMarkdown>{msg.content}</ReactMarkdown></div>}
                  <span className={`block text-[10px] mt-1.5 ${isUser ? 'text-white/70' : 'text-tertiary'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 card px-4 py-2.5 rounded-2xl rounded-bl-none text-sm text-secondary shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--primary)' }} />
              Pilot is thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shrink-0">
        {fileName && (
          <div className="mb-2 flex items-center gap-2 text-xs text-secondary">
            <div className="flex items-center gap-2 surface-muted rounded-lg px-2.5 py-1.5">
              <Paperclip className="w-3.5 h-3.5" />
              <span className="truncate max-w-[160px]">{fileName}</span>
              <button onClick={() => setFileName(null)} className="text-tertiary hover:text-[var(--red)] transition-colors"><X className="w-3 h-3" /></button>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <label className="self-end p-3 rounded-xl cursor-pointer shrink-0 transition-colors surface-muted text-secondary hover:opacity-80">
            <Paperclip className="w-5 h-5" />
            <input type="file" accept=".pdf,.doc,.docx" onChange={handleFileChange} className="hidden" />
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask ScholarPilot..."
            rows={1}
            className="input flex-1 resize-none max-h-32"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="self-end p-3 rounded-xl gradient-emerald text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] shrink-0 shadow-md"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

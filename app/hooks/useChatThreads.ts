'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatMessage } from '@/app/types';
import {
  ChatThreadSummary,
  createChatThread,
  deleteChatThread,
  fetchChatThread,
  fetchChatThreads,
  renameChatThread,
  saveChatMessages,
} from '@/app/lib/user-store';
import { useAuth } from '@/app/providers/AuthProvider';

/**
 * Chat threads for the signed-in user.
 *
 * Reads rather than subscribes: a conversation is only ever written by the tab
 * the user is typing in, so a live listener would spend reads re-delivering
 * this device's own writes. The summary list refreshes when a thread is created,
 * renamed, deleted, or replied to.
 *
 * Messages are held in component state while a conversation is active and
 * flushed to Firestore after each exchange — one write per turn, not per token.
 */
export function useChatThreads() {
  const { user, loading: authLoading } = useAuth();
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setThreads(await fetchChatThreads(user.uid));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your chats');
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setThreads([]);
      setActiveId(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchChatThreads(user.uid)
      .then((list) => {
        if (cancelled) return;
        setThreads(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  /** Open a thread and load its messages. */
  const open = useCallback(
    async (id: string) => {
      if (!user) return;
      setActiveId(id);
      setMessages([]);
      try {
        const thread = await fetchChatThread(user.uid, id);
        setMessages(thread?.messages ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open that chat');
      }
    },
    [user]
  );

  /**
   * Start a thread. Returns its id so a caller can immediately send an opening
   * message into it without waiting for state to settle.
   */
  const create = useCallback(
    async (title: string, scholarshipId?: string): Promise<string | null> => {
      if (!user) return null;
      try {
        const id = await createChatThread(user.uid, title, scholarshipId);
        setActiveId(id);
        setMessages([]);
        await refresh();
        return id;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start a new chat');
        return null;
      }
    },
    [user, refresh]
  );

  /**
   * Persist a thread's messages. Takes an explicit id because the caller may be
   * saving into a thread it just created, before `activeId` has propagated.
   */
  const persist = useCallback(
    async (id: string, next: ChatMessage[]) => {
      if (!user) return;
      try {
        await saveChatMessages(user.uid, id, next);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save that message');
      }
    },
    [user, refresh]
  );

  /**
   * Drop back to a blank conversation without writing anything.
   *
   * The thread document is created on the first message instead, so tapping
   * "New chat" and changing your mind leaves no empty threads behind.
   */
  const startBlank = useCallback(() => {
    setActiveId(null);
    setMessages([]);
  }, []);

  const rename = useCallback(
    async (id: string, title: string) => {
      if (!user) return;
      try {
        await renameChatThread(user.uid, id, title);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not rename that chat');
      }
    },
    [user, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        await deleteChatThread(user.uid, id);
        if (activeId === id) {
          setActiveId(null);
          setMessages([]);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete that chat');
      }
    },
    [user, activeId, refresh]
  );

  return {
    threads,
    activeId,
    messages,
    setMessages,
    loading,
    error,
    open,
    create,
    persist,
    rename,
    remove,
    startBlank,
  };
}

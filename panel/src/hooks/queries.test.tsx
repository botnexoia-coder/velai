// Los hooks de query, con fixtures que copian la forma real de la API.
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createQueryClient } from '../api/queryClient';
import { inbox, inboxConThread, leadsPage1, leadsPage2, mockFetch, stats } from '../test/fixtures';
import { convQs, inboxAlive, leadQs, useInbox, useLeads, useStats, INBOX_IDLE_MS, INBOX_LIVE_MS } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe('useStats', () => {
  it('trae las métricas con el desglose por canal y las fuentes del filtro', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/api/admin/stats': stats }));
    const { result } = renderHook(() => useStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total30).toBe(42);
    expect(result.current.data?.porDia[1]?.canales).toEqual([
      { canal: 'whatsapp', n: 3 },
      { canal: 'web', n: 2 },
    ]);
    expect(result.current.data?.fuentes).toContain('landing-clinicas');
  });
});

describe('useLeads: paginación por cursor', () => {
  it('encadena páginas con nextCursor y sabe cuándo no hay más', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('cursor=') ? leadsPage2 : leadsPage1;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLeads({ status: 'new' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.leads).toHaveLength(2);
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    // La segunda petición viaja con el cursor de la primera página (tupla created_at|id).
    const second = String(fetchMock.mock.calls[1]?.[0]);
    expect(second).toContain('cursor=');
    expect(decodeURIComponent(second)).toContain(leadsPage1.nextCursor as string);
  });

  it('leadQs no manda claves vacías', () => {
    expect(leadQs({ q: '', status: 'new' })).toBe('?status=new');
    expect(leadQs({})).toBe('');
  });
});

describe('useInbox: el sondeo de la bandeja', () => {
  it('trae lista, contadores y el hilo pedido', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/api/admin/inbox': inboxConThread }));
    const { result } = renderHook(() => useInbox({}, 'bbbbbbbb-0000-4000-8000-000000000001'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const d = result.current.data!;
    expect(d.conversations).toHaveLength(2);
    expect(d.thread?.conversation.agent_email).toBe('ana@velai.ai');
    expect(d.thread?.window.open).toBe(true);
    // queueMin/pingMin vienen DEL SERVIDOR: el panel no los escribe a mano.
    expect(d.queueMin).toBe(15);
    expect(d.pingMin).toBe(5);
  });

  it('convQs añade la conversación abierta a la misma llamada', () => {
    expect(convQs({ channel: 'whatsapp' }, 'abc')).toBe('?channel=whatsapp&conversation=abc');
    expect(convQs({}, null)).toBe('');
  });

  it('inboxAlive marca la cadencia: 15 s con algo vivo, 60 s si no', () => {
    expect(inboxAlive(inbox)).toBe(true); // hay una esperando
    const quieto = {
      ...inbox,
      counts: inbox.counts.map((c) => ({ ...c, waiting: 0 })),
      conversations: inbox.conversations.map((c) => ({ ...c, state: 'bot' as const })),
    };
    expect(inboxAlive(quieto)).toBe(false);
    expect(INBOX_LIVE_MS).toBe(15_000);
    expect(INBOX_IDLE_MS).toBe(60_000);
  });
});

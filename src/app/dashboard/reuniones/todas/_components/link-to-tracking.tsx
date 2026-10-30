"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  linkMeetingToOpportunityAction,
  searchClientsForMeetingAction,
  type ClientSearchResult,
} from "@/server/actions/adhoc-meetings";
import { Input } from "@/components/ui/input";

/** Busca un seguimiento por cliente o teléfono y le asocia esta reunión interna. */
export function LinkToTracking({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(value: string) {
    setQuery(value);
    setError(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(() => {
      setSearching(true);
      startTransition(async () => {
        setResults(await searchClientsForMeetingAction(value));
        setSearching(false);
      });
    }, 300);
  }

  function link(opportunityId: string) {
    setError(null);
    startTransition(async () => {
      const r = await linkMeetingToOpportunityAction(meetingId, opportunityId);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-2/40 p-2.5">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <Input
          type="text"
          value={query}
          disabled={isPending}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar el seguimiento por cliente o teléfono…"
          className="py-1.5 pl-8 text-xs"
        />
      </div>
      {searching && <p className="text-xs text-ink-faint">Buscando…</p>}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs text-ink-faint">No hay seguimientos con ese dato.</p>
      )}
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => link(r.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:border-accent-dim hover:bg-accent-dim/10 disabled:cursor-not-allowed"
              >
                <span className="truncate font-medium text-ink">{r.contactName}</span>
                <span className="shrink-0 truncate text-ink-faint">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

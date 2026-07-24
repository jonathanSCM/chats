"use client";

import { useActionState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import {
  createCatalogItemAction,
  deleteCatalogItemAction,
  toggleCatalogItemAction,
} from "@/server/actions/catalog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface CatalogItemRow {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  active: boolean;
}

export function CatalogTab({ botId, items }: { botId: string; items: CatalogItemRow[] }) {
  const action = createCatalogItemAction.bind(null, botId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <div className="max-w-3xl space-y-8">
      <form action={formAction} className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="name">Producto</Label>
          <Input id="name" name="name" placeholder="Plan Pro" required />
        </div>
        <div className="w-32 space-y-1.5">
          <Label htmlFor="price">Precio</Label>
          <Input id="price" name="price" type="number" step="0.01" min="0" placeholder="49.99" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="description">Descripción</Label>
          <Input id="description" name="description" placeholder="Opcional" />
        </div>
        <Button type="submit" disabled={isPending}>
          <Plus size={16} /> Agregar
        </Button>
      </form>
      {state.error && <p className="-mt-4 text-sm text-danger">{state.error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no hay productos en el catálogo.</p>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Producto</Th>
              <Th>Precio</Th>
              <Th>Estado</Th>
              <Th />
            </tr>
          </Thead>
          <tbody>
            {items.map((item) => (
              <CatalogRow key={item.id} botId={botId} item={item} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function CatalogRow({ botId, item }: { botId: string; item: CatalogItemRow }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Tr>
      <Td>
        <p className="font-medium">{item.name}</p>
        {item.description && <p className="text-xs text-ink-muted">{item.description}</p>}
      </Td>
      <Td className="font-mono">{item.price ? `$${item.price}` : "—"}</Td>
      <Td>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => toggleCatalogItemAction(botId, item.id))}
          className="cursor-pointer"
        >
          <Badge tone={item.active ? "accent" : "neutral"}>
            {item.active ? "Activo" : "Inactivo"}
          </Badge>
        </button>
      </Td>
      <Td>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => deleteCatalogItemAction(botId, item.id))}
          className="cursor-pointer text-ink-faint transition-colors hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </Td>
    </Tr>
  );
}

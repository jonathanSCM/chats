import Link from "next/link";
import { prisma } from "@/server/db/client";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { Badge, StatusDot } from "@/components/ui/badge";

function formatPhone(phone: string) {
  return phone.length > 4 ? `••••${phone.slice(-4)}` : phone;
}

export async function ConversationsTab({ botId }: { botId: string }) {
  const conversations = await prisma.conversation.findMany({
    where: { botId },
    include: { _count: { select: { messages: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });

  if (conversations.length === 0) {
    return <p className="text-sm text-ink-muted">Todavía no hay conversaciones.</p>;
  }

  return (
    <Table>
      <Thead>
        <tr>
          <Th>Cliente</Th>
          <Th>Estado</Th>
          <Th>Mensajes</Th>
          <Th>Inicio</Th>
          <Th>Último mensaje</Th>
        </tr>
      </Thead>
      <tbody>
        {conversations.map((conversation) => (
          <Tr key={conversation.id}>
            <Td>
              <Link
                href={`/dashboard/bots/${botId}/conversations/${conversation.id}`}
                className="font-mono text-accent hover:underline"
              >
                {formatPhone(conversation.customerPhone)}
              </Link>
            </Td>
            <Td>
              {conversation.botPaused ? (
                <Badge tone="warning">
                  <StatusDot tone="warning" /> Humano
                </Badge>
              ) : (
                <Badge tone="neutral">Bot</Badge>
              )}
            </Td>
            <Td className="font-mono">{conversation._count.messages}</Td>
            <Td className="text-ink-muted">
              {conversation.startedAt.toLocaleString("es")}
            </Td>
            <Td className="text-ink-muted">
              {conversation.lastMessageAt.toLocaleString("es")}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

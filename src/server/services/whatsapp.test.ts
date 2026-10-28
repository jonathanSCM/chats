import { describe, expect, it } from "vitest";
import { parseInboundPayload } from "./whatsapp";

describe("parseInboundPayload con nombre de usuario (BSUID)", () => {
  const payload = (contact: object, message: object) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, contacts: [contact], messages: [{ id: "wamid.1", timestamp: "1", type: "text", text: { body: "hola" }, ...message }] } }] }],
  });

  it("acepta un mensaje sin teléfono, solo con BSUID", () => {
    const out = parseInboundPayload(payload({ user_id: "PE.abc", profile: { name: "Ana", username: "ana_pe" } }, { from_user_id: "PE.abc" }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "PE.abc", customerName: "Ana", text: "hola" });
  });

  it("si trae teléfono, usa el teléfono", () => {
    const out = parseInboundPayload(payload({ wa_id: "51999", user_id: "PE.abc", profile: { name: "Ana" } }, { from: "51999", from_user_id: "PE.abc" }));
    expect(out[0]).toMatchObject({ from: "51999", customerName: "Ana" });
  });

  it("si no trae nombre, usa el username", () => {
    const out = parseInboundPayload(payload({ user_id: "PE.abc", profile: { username: "ana_pe" } }, { from_user_id: "PE.abc" }));
    expect(out[0].customerName).toBe("ana_pe");
  });
});

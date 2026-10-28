import { describe, expect, it } from "vitest";
import { isBsuid, recipientField, senderIdentifier } from "./whatsapp-recipient";

describe("whatsapp-recipient", () => {
  it("reconoce BSUID y teléfonos", () => {
    expect(isBsuid("PE.13491208655302741918")).toBe(true);
    expect(isBsuid("51987654321")).toBe(false);
  });
  it("usa `recipient` para BSUID y `to` para teléfonos", () => {
    expect(recipientField("PE.abc123")).toEqual({ recipient: "PE.abc123" });
    expect(recipientField("51987654321")).toEqual({ to: "51987654321" });
  });
  it("el remitente es el teléfono; sin teléfono, el BSUID", () => {
    expect(senderIdentifier({ from: "51987654321", from_user_id: "PE.x" })).toBe("51987654321");
    expect(senderIdentifier({ from_user_id: "PE.x" })).toBe("PE.x");
    expect(senderIdentifier({})).toBeNull();
  });
});

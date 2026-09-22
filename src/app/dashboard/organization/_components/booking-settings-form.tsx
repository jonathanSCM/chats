"use client";

import { useActionState } from "react";
import { updateBookingSettingsAction } from "@/server/actions/organization";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

// No hace falta un selector con cientos de zonas horarias: la app opera en
// Bolivia y países vecinos, así que alcanza con estas.
const TIMEZONES = [
  { value: "America/La_Paz", label: "La Paz (GMT-4)" },
  { value: "America/Lima", label: "Lima (GMT-5)" },
  { value: "America/Bogota", label: "Bogotá (GMT-5)" },
  { value: "America/Mexico_City", label: "Ciudad de México (GMT-6)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (GMT-3)" },
  { value: "America/Santiago", label: "Santiago (GMT-3/-4)" },
];

const HOURS = Array.from({ length: 25 }, (_, h) => h);

export function BookingSettingsForm({
  currentTimezone,
  currentDays,
  currentStartHour,
  currentEndHour,
  currentDurationMinutes,
  currentLeadHours,
}: {
  currentTimezone: string;
  currentDays: number[];
  currentStartHour: number;
  currentEndHour: number;
  currentDurationMinutes: number;
  currentLeadHours: number;
}) {
  const [state, formAction, isPending] = useActionState(updateBookingSettingsAction, { error: null });

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Días que atendés</Label>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <label key={d.value} className="flex items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                name="bookingDays"
                value={d.value}
                className="h-3.5 w-3.5"
                defaultChecked={currentDays.includes(d.value)}
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="bookingStartHour">Desde</Label>
          <Select id="bookingStartHour" name="bookingStartHour" defaultValue={currentStartHour}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bookingEndHour">Hasta</Label>
          <Select id="bookingEndHour" name="bookingEndHour" defaultValue={currentEndHour}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bookingDurationMinutes">Duración (min)</Label>
          <Input
            id="bookingDurationMinutes"
            name="bookingDurationMinutes"
            type="number"
            min={10}
            max={240}
            step={5}
            defaultValue={currentDurationMinutes}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bookingLeadHours">Anticipación mín. (h)</Label>
          <Input
            id="bookingLeadHours"
            name="bookingLeadHours"
            type="number"
            min={0}
            max={168}
            defaultValue={currentLeadHours}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Zona horaria</Label>
        <Select id="timezone" name="timezone" defaultValue={currentTimezone} className="max-w-xs">
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>
      </div>

      <p className="text-xs text-ink-muted">
        Esto es lo que usa el bot de calificación para ofrecer horarios reales de reunión por
        WhatsApp — ya no propone franjas fijas, propone lo que de verdad está libre dentro de este
        horario.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        {state.message && <p className="text-xs text-accent">{state.message}</p>}
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

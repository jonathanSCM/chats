"use client";

import { useEffect } from "react";
import { installStaleActionReload } from "@/lib/stale-action-reload";

export function StaleActionReload() {
  useEffect(() => installStaleActionReload(), []);
  return null;
}

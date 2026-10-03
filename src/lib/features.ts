/** Dashboard de marketing y sync de Meta Ads: apagado hasta que Meta apruebe ads_read. Para volver a prenderlo, MARKETING_ENABLED=true. */
export function isMarketingEnabled(): boolean {
  return process.env.MARKETING_ENABLED === "true";
}

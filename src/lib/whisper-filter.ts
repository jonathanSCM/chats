// Frases que Whisper "inventa" con frecuencia documentada cuando le llega un
// tramo de audio silencioso o con ruido de fondo -- las aprendió de su
// entrenamiento con subtítulos de YouTube, no las dijo nadie en la reunión.
// Filtrarlas de raíz es mejor que dejarlas y que parezca que alguien las dijo.
const WHISPER_HALLUCINATION_PATTERNS = [
  /subt[ií]tulos (realizados |hechos )?por la comunidad de amara\.org/i,
  /subt[ií]tulos por la comunidad de amara\.org/i,
  /m[aá]s informaci[oó]n (en )?www\./i,
  /suscr[ií]bete/i,
  /gracias por ver( el video)?/i,
  /cc por antarctica films argentina/i,
];

export function isLikelyWhisperHallucination(text: string): boolean {
  const trimmed = text.trim();
  return WHISPER_HALLUCINATION_PATTERNS.some((re) => re.test(trimmed));
}

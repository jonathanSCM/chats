-- Transcripción completa del audio hecha con whisper.cpp (local, sin nombres
-- de quién habló) -- complementa a `transcript` (subtítulos en vivo, con
-- nombres) para cuando estos tengan huecos o hayan fallado.
ALTER TABLE "meetings" ADD COLUMN "audioTranscript" TEXT;

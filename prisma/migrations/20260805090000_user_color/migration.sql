ALTER TABLE "users" ADD COLUMN "color" TEXT;

-- El default de "role" era OWNER (el rol más privilegiado). Un camino de
-- creación de usuario que olvide pasar "role" explícito debe caer en el
-- menos privilegiado, no en el que da control total.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

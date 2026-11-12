// Ejecuta fn una vez y reutiliza la promesa; si falla, la próxima llamada reintenta.
export function onceUntilSuccess(fn) {
  let pending;
  return () => {
    pending ??= fn().catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

// Reintenta fn hasta `attempts` veces, esperando delayMs entre intentos.
export async function retry(fn, attempts, delayMs) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

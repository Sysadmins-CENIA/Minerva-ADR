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

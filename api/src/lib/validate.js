export function validate(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join(", ");
    const err = new Error(message);
    err.status = 400;
    throw err;
  }
  return parsed.data;
}

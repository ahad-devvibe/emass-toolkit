// aria wiring for a control rendered inside <FormField id={id} error={error}>
export const fieldA11y = (id: string, error?: string) => ({ id, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined })

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

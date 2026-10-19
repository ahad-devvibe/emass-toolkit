---
name: zod-schemas
description: Use when writing or editing Zod validation schemas in this project. Covers current Zod 4 error-customization syntax and this project's field-required-vs-wrong-type message convention.
---

# Writing Zod 4 DTO schemas

This project uses Zod 4. Error customization syntax changed significantly from v3 —
do not use `required_error`, `invalid_type_error`, or `{ message: "..." }`. These are
deprecated/removed in v4.

## Correct syntax

- Custom message: `z.string({ error: "message" })` or `z.string().min(5, { error: "message" })`
- Field-required vs wrong-type distinction:
  `z.string({ error: (iss) => iss.input === undefined ? "X is required" : "X must be text" })`
- Email: `z.email({ error: ... })` — NOT `z.string().email()` (deprecated)
- Never use `.format()` on a ZodError — deprecated, use `z.flattenError(error)` instead,
  which returns `{ formErrors, fieldErrors }`

## Project convention

- Every required field must distinguish "missing" vs "wrong type" in its error message
  (see pattern above) — never let a field fall back to Zod's generic default message.
- Schemas live in /src/schemas/{module}.schema.ts
- Controllers parse input directly (`schema.parse(req.body)`); the thrown
  ZodError is translated by the central error handler into
  400 VALIDATION_ERROR (first issue as `message`, all issues in `details`)

## Example (reference, copy this shape)

```import * as z from "zod";

    export const signupSchema = z.object({
        email: z.email({
        error: (iss) => iss.input === undefined ? "Email is required" : "Please enter a valid email",
    }),
    password: z.string().min(8, { error: "Password must be at least 8 characters" }),
    fullName: z.string({
        error: (iss) => iss.input === undefined ? "Full name is required" : "Full name must be text",
        }).min(1, { error: "Full name is required" }),
    });
```

```
    export function validate(schema: z.ZodType) {
    return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
    const flattened = z.flattenError(result.error);
    throw new ApiError(400, "Validation failed", "VALIDATION_ERROR", flattened.fieldErrors);
    // fieldErrors: { email: ["Email is required"], password: ["Password must be at least 8 characters"] }
    }
    req.body = result.data;
    next();
    };
    }
```

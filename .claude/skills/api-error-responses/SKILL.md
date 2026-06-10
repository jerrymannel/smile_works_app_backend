---
name: api-error-responses
description: API error response conventions for this service. Use when writing error handling, returning errors from endpoints, or reviewing code that returns HTTP responses. 
---

## Error Envelope
All errors return a consistent JSON envelope:

{
  "status": "error",
  "code": "ACCOUNT_FROZEN",
  "message": "This account has been frozen and cannot process transactions.",
  "correlationId": "req-a3f9b1c2"
}

## Rules

1. Always return the correlationId from the incoming
   request header `X-Correlation-ID`.
   If the header is absent, generate a UUID and return it.
   Never omit it. Ever.

2. `code` is a machine-readable constant. SCREAMING_SNAKE_CASE.
   Do not use HTTP status text as the code.

3. `message` is human-readable. Write it for the developer
   calling your API, not for the end user.

4. Never leak stack traces, internal class names,
   or database messages in any field.

5. 4xx = caller's fault. 5xx = your fault.
   Do not return 200 with an error body.

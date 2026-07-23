# API

## Health

`GET /health`

## Generations

`GET /api/generations`

Returns the current user's generation history.

`POST /api/generations`

```json
{
  "type": "image",
  "prompt": "Create a studio portrait...",
  "consentConfirmed": true
}
```

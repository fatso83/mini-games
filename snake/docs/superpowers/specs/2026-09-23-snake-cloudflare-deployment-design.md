# Snake Cloudflare deployment

## Goal

Publish the existing multiplayer Snake game with a public URL that can be shared without configuring a custom domain.

## Chosen approach

Deploy the existing `snake/wrangler.toml` Worker unchanged with Wrangler. The Worker serves the Vite production output from `dist` and routes multiplayer session WebSockets through the `GameRoom` Durable Object.

Provided the Cloudflare account has a Workers subdomain enabled, Cloudflare will assign a public URL in this form:

`https://browser-snake.<account-subdomain>.workers.dev`

## Why this approach

Static-only hosting would not support the game's multiplayer API and WebSocket sessions. A custom domain is unnecessary for the initial public release. The current Worker configuration already declares static assets, the Durable Object binding, and the SQLite-backed migration needed for production.

## Release flow

1. Run the existing test suite and production build from `snake/`.
2. Deploy with the locally installed, lockfile-resolved Wrangler version using `npm exec wrangler deploy`. If dependencies need restoring first, use `npm ci`.
3. Capture the exact public `workers.dev` URL emitted by Cloudflare.
4. Request the home page, create a game session, then open its WebSocket endpoint. Verify a snapshot is received and a valid player join command succeeds.

## Failure handling

If Wrangler is not authenticated, it will request Cloudflare login before publishing. A failed validation leaves the current remote release unchanged. If the deployment or first Durable Object migration fails, inspect the deployment state in the Cloudflare dashboard before retrying. Any follow-up code change will be reviewed and validated before a new deployment.

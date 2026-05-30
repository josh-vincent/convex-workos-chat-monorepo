# native (Expo)

The Expo chat client. Based on
[`EvanBacon/chat-template`](https://github.com/EvanBacon/chat-template), wired to
the shared Convex `/chat` endpoint with WorkOS + guest auth.

Requires a **custom dev build** (native modules like `@expo/ui` / glass effects
aren't in Expo Go):

```sh
npx expo run:ios     # or: npx expo run:android
```

Env: copy `.example.env` → `.env.local`. See the repo root `README.md` for the
full setup (Convex, guest auth, WorkOS, AI Gateway).

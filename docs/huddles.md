# Huddles (voice V1)

A channel's header has a microphone button. It joins that channel's active
huddle, or starts one, and opens a small floating window. The window shows each
participant's avatar, with a halo while they speak, plus **Mute** and **Leave**.
There is no text chat. One huddle is active app-wide; joining another channel's
huddle leaves the current one.

## Wire contract (unchanged from old Buzz desktop/mobile)

- **Start:** kind 9007 creates a private `stream` backing channel
  (`name=huddle-<8 hex>`, `ttl=3600`). Then kind 48100 in the parent channel
  carries `{"ephemeral_channel_id":"<backing>"}`.
- **Discover:** read 48100/48103 in the parent. The newest unexpired start with
  no matching end is active. Simultaneous starts can create two huddles.
- **Audio:** `WS <relay ws origin>/huddle/<backing>/audio` sends a challenge.
  The client replies with
  `{"type":"auth","event":<22242>,"parent_channel_id","protocol_version":2}`.
  - The 22242 `relay` tag is the community origin, not the huddle URL.
  - The relay admits members of the parent channel, adds them to the backing
    channel itself, and archives the huddle when the last peer leaves.
  - Leaving sends `{"type":"leave"}` and closes the socket.
- **Frames:** 48 kHz mono Opus in 20 ms frames. The 8-byte v2 header is
  `seq u16 | ts u32 | dBov i8 | flags u8`; the relay prefixes `peer_index u8`.
  A level above -55 dBov, held for 600 ms, shows as speaking.

## Ownership

- **`features/huddles/protocol.ts`:** exact templates and the validator. The
  browser, the dev broker (`huddle-sign`/`huddle-publish`) and native code
  (`relay_channel_sign` route `huddle` in `channel_writes.rs`) all share it.
  - It signs only the three exact shapes: backing, start and audio auth. The
    broker never publishes 22242.
  - Native signs 22242 through the existing community-checked `relay_sign`.
- **`ReadTransport.huddle` / `session.huddle`:** a purpose-bound host
  (`relayUrl`, `writer`, `query`). It is never supplied to the outbox.
- **`features/huddles/controller.ts`:** the one active huddle. It opens the
  microphone **before** any relay write, so a refused permission writes nothing.
- **`features/huddles/audio.ts`:** WebCodecs Opus, an AudioWorklet capture, and
  per-peer scheduled playback with about 60 ms of startup jitter buffer. PCM
  never leaves this module.
- **`bundled/channels/HuddleWindow.tsx`:**
  - The header button and window.
  - Unmounting the Channels page or replacing the session leaves the huddle, so
    no microphone stays open without its window.
- **`src-tauri/Info.plist`:** the macOS microphone usage string. Guest Browser
  webviews still deny media.

## Agents in huddles (proof of concept)

Agents bring their own bidirectional voice model, so this app never carries an
agent's audio, key or provider secret.

- **Invite:** the window's robot button lists your managed agents from
  `session.agentChoices` that are members of this channel and aren't already in
  the huddle. Channel membership is required because the agent finds the huddle
  through the start event posted there. Choosing one calls
  `session.memberAdditions.add(backing, agent, control)`, the existing
  channel-member operation.
  - That sends a kind 9000 `role=bot` add to the huddle's **backing channel**,
    confirms it against the signed roster, and starts the local agent if it is
    stopped.
  - Only the huddle's creator can add members to its private backing channel.
    Other people's attempts show the relay's refusal in the window.
- **Join:** the agent's runtime, `buzz-acp`, receives the membership
  notification (44100) as the invitation.
  - It finds the creator's 48100 start, which gives it the parent channel.
  - It joins `WS /huddle/{backing}/audio` as the agent, using a 22242 that
    carries its NIP-OA `auth` tag.
  - It starts a dedicated `goose-acp` session with
    `_goose/unstable/session/live-voice/start`, which uses OpenAI `gpt-live-1`
    with the agent's own `OPENAI_API_KEY`.
  - goose delegates work to the agent's main goose session, so tools stay
    available.
- **Media:** Opus end to end over WebRTC between buzz-acp and the model.
  Nothing is decoded.
  - Peers reach the model one active speaker at a time; there is no mixing.
  - The model's packets become relay frames. Their speaking level is estimated
    from packet size.
- **Leave:** the agent leaves when it is removed from the backing channel, the
  room ends, or either connection fails.

The runtime pin (`runtime/agent-runtime.json`) points at
`alexhancock/buzz@alexhancock/huddles-with-voice-agents-poc` and builds goose
with `live-voice`. The agent needs `OPENAI_API_KEY` in its environment.

## Known gaps (deferred)

- **No discovery indicator:** nothing in the channel shows that a huddle is
  live. The mic button discovers it on click.
- **Backing channel in the sidebar:** it appears as `huddle-xxxxxxxx` during
  the call. Old Buzz hides it by recording the 48100 link; this V1 does not.
- **No reconnect:** a dropped socket ends the call with an error.
- **No explicit "end for everyone":** the relay ends the huddle when the last
  peer leaves.
- **No 9022 leave:** a participant who leaves early stays a member of the
  backing channel until the relay archives it.
- **WebCodecs Opus required:** Chromium, or Safari/WKWebView 26+. Older
  WebViews show "Huddles need a newer browser or system WebView."
- **Echo on speakers in Chromium:** its echo cancellation does not cover Web
  Audio output, so use headphones there. macOS voice processing covers
  WKWebView.
- **Agent proof of concept:**
  - Agents are heard one speaker at a time.
  - Agent speaking levels are approximate.
  - Only the creator can invite agents.
  - Each agent in a huddle runs a separate `goose-acp` process and a billed
    realtime session.
- **Not yet validated:** live two-party audio, cross-client interop with old
  Buzz/mobile, packaged entitlements (`com.apple.security.device.audio-input`
  under the hardened runtime), Linux and Windows.

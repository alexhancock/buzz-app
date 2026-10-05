import type { RelaySession } from "../relay/session";
import { startHuddleAudio, type HuddleAudio } from "./audio";
import {
  activeHuddle,
  authTemplate,
  backingTemplate,
  encodeFrame,
  decodeFrame,
  HUDDLE_ENDED,
  HUDDLE_PROTOCOL_VERSION,
  HUDDLE_STARTED,
  parseControl,
  SPEAKING_DBOV,
  SPEAKING_HOLD_MS,
  startTemplate,
} from "./protocol";

export type HuddleState = Readonly<{
  status: "idle" | "connecting" | "live" | "error";
  session?: RelaySession;
  channelId?: string;
  /** Backing channel; agents are invited by becoming its members. */
  backing?: string;
  /** Viewer first, then remote peers in join order. */
  participants: readonly string[];
  speaking: ReadonlySet<string>;
  muted: boolean;
  error?: string;
}>;

const idle: HuddleState = Object.freeze({
  status: "idle",
  participants: Object.freeze([]),
  speaking: new Set<string>(),
  muted: false,
});
let state = idle;
const listeners = new Set<() => void>();
/** Resources for the one current attempt; replaced atomically on join/leave. */
let current:
  | {
      controller: AbortController;
      socket?: WebSocket;
      audio?: HuddleAudio;
      timer?: ReturnType<typeof setInterval>;
    }
  | undefined;

function update(next: Partial<HuddleState>) {
  state = Object.freeze({ ...state, ...next });
  for (const listener of listeners) listener();
}
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/** One app-wide huddle. Joining another channel leaves the current one. */
export const huddles = Object.freeze({
  snapshot: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setMuted(muted: boolean) {
    current?.audio?.setMuted(muted);
    update({ muted });
  },
  leave() {
    const run = current;
    current = undefined;
    if (run) {
      run.controller.abort();
      clearInterval(run.timer);
      if (run.socket?.readyState === WebSocket.OPEN)
        run.socket.send(JSON.stringify({ type: "leave" }));
      run.socket?.close();
      run.audio?.close();
    }
    state = idle;
    for (const listener of listeners) listener();
  },
  /** Join the channel's active huddle, or start one. Microphone opens before any relay write. */
  async join(session: RelaySession, channelId: string) {
    if (
      state.status !== "error" &&
      state.channelId === channelId &&
      state.session === session
    )
      return;
    huddles.leave();
    const host = session.huddle;
    const viewer = session.viewer;
    const run = { controller: new AbortController() } as NonNullable<
      typeof current
    >;
    current = run;
    const signal = run.controller.signal;
    update({
      status: "connecting",
      session,
      channelId,
      participants: viewer ? [viewer] : [],
    });
    const fail = (error: unknown) => {
      if (current !== run) return;
      const message =
        error instanceof Error && error.message
          ? error.message
          : "The huddle is unavailable.";
      huddles.leave();
      update({ status: "error", session, channelId, error: message });
    };
    try {
      if (!host || !viewer)
        throw new Error("Huddles are unavailable in this community.");
      const loud = new Map<string, number>();
      const byPeer = new Map<number, string>();
      const hear = (pubkey: string, level: number) => {
        if (level > SPEAKING_DBOV)
          loud.set(pubkey, Date.now() + SPEAKING_HOLD_MS);
      };
      let seq = 0;
      let joined = false;
      run.audio = await startHuddleAudio(
        (opus, timestamp, level) => {
          if (joined && run.socket?.readyState === WebSocket.OPEN)
            run.socket.send(encodeFrame(seq++, timestamp, level, opus));
        },
        (level) => hear(viewer, level),
      );
      if (signal.aborted) {
        run.audio.close();
        return;
      }
      run.timer = setInterval(() => {
        const now = Date.now();
        const speaking = new Set(
          [...loud].filter(([, until]) => until > now).map(([key]) => key),
        );
        if (!sameSet(speaking, state.speaking)) update({ speaking });
      }, 100);
      const events = await host.query(
        [
          {
            kinds: [HUDDLE_STARTED, HUDDLE_ENDED],
            "#h": [channelId],
            limit: 50,
          },
        ],
        signal,
      );
      let backing = activeHuddle(events, channelId);
      if (!backing) {
        backing = crypto.randomUUID();
        for (const template of [
          backingTemplate(backing),
          startTemplate(channelId, backing),
        ])
          await host.writer.publish(
            await host.writer.sign(template, signal),
            signal,
          );
      }
      signal.throwIfAborted();
      update({ backing });
      const socket = new WebSocket(`${host.relayUrl}/huddle/${backing}/audio`);
      socket.binaryType = "arraybuffer";
      run.socket = socket;
      const roster = () =>
        update({
          participants: [
            viewer,
            ...new Set([...byPeer.values()].filter((key) => key !== viewer)),
          ],
        });
      socket.onmessage = async ({ data }) => {
        if (current !== run) return;
        if (data instanceof ArrayBuffer) {
          const frame = decodeFrame(data);
          const pubkey = frame && byPeer.get(frame.peer);
          if (!frame || !pubkey) return;
          hear(pubkey, frame.level);
          run.audio?.play(frame.peer, frame.opus);
          return;
        }
        const control = parseControl(String(data));
        if (control?.type === "challenge") {
          try {
            const event = await host.writer.sign(
              authTemplate(host.relayUrl, control.challenge),
              signal,
            );
            socket.send(
              JSON.stringify({
                type: "auth",
                event,
                parent_channel_id: channelId,
                protocol_version: HUDDLE_PROTOCOL_VERSION,
              }),
            );
          } catch (error) {
            fail(error);
          }
        } else if (control?.type === "joined" || control?.type === "roster") {
          if (control.type === "roster") byPeer.clear();
          for (const peer of control.peers)
            byPeer.set(peer.peer_index, peer.pubkey);
          if (control.type === "joined" && control.pubkey === viewer) {
            joined = true;
            update({ status: "live" });
          }
          roster();
        } else if (control?.type === "left") {
          byPeer.delete(control.peer_index);
          run.audio?.drop(control.peer_index);
          loud.delete(control.pubkey);
          roster();
        } else if (control?.type === "error") fail(new Error(control.message));
      };
      socket.onclose = () => fail(new Error("The huddle connection closed."));
    } catch (error) {
      if (!signal.aborted) fail(error);
    }
  },
});

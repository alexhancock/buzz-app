// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HuddleState } from "../../features/huddles/controller";
import type { RelaySession } from "../../features/relay/session";

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const idle: HuddleState = {
    status: "idle",
    participants: [],
    speaking: new Set(),
    muted: false,
  };
  let state = idle;
  return {
    reset() {
      state = idle;
    },
    set(next: Partial<HuddleState>) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    huddles: {
      snapshot: () => state,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      join: vi.fn(),
      leave: vi.fn(),
      setMuted: vi.fn(),
    },
  };
});
vi.mock("../../features/huddles/controller", () => ({
  huddles: store.huddles,
}));
const { HuddleButton, HuddleWindow } = await import("./HuddleWindow");

const viewer = "a".repeat(64);
const peer = "b".repeat(64);
const profiles = new Map([[peer, { name: "Wes" }]]);
const agent = "c".repeat(64);
const otherAgent = "d".repeat(64);
const agentChoices = {
  status: "ready",
  pending: false,
  archives: { status: "ready" },
  identities: [],
  selectable: [
    { pubkey: agent, name: "Voice", managed: true },
    { pubkey: otherAgent, name: "Someone else's", managed: false },
    { pubkey: peer, name: "Already here", managed: true },
    { pubkey: "e".repeat(64), name: "Not in channel", managed: true },
  ],
};
const memberAdditions = { add: vi.fn(async () => {}) };
const session = {
  viewer,
  media: () => undefined,
  memberAdditions,
  agentChoices: {
    snapshot: () => agentChoices,
    subscribe: () => () => {},
    retain: () => () => {},
    ensure: vi.fn(),
  },
  profiles: {
    ensure: vi.fn(async () => {}),
    subscribe: () => () => {},
    snapshot: () => profiles,
  },
} as unknown as RelaySession;
const channels = [
  { id: "c1", name: "design", members: [viewer, peer, agent, otherAgent] },
];

afterEach(() => {
  cleanup();
  store.reset();
  vi.clearAllMocks();
});

it("joins from the header and leaves when pressed again", () => {
  render(<HuddleButton session={session} channelId="c1" />);
  fireEvent.click(screen.getByRole("button", { name: "Start or join huddle" }));
  expect(store.huddles.join).toHaveBeenCalledWith(session, "c1");
  act(() => store.set({ status: "live", session, channelId: "c1" }));
  const leave = screen.getByRole("button", { name: "Leave huddle" });
  expect(leave).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(leave);
  expect(store.huddles.leave).toHaveBeenCalled();
});

it("shows floating participants with speaking state, mute and leave only", () => {
  const { unmount } = render(
    <HuddleWindow session={session} channels={channels} />,
  );
  expect(screen.queryByRole("region", { name: "Huddle" })).toBeNull();
  act(() =>
    store.set({
      status: "live",
      session,
      channelId: "c1",
      participants: [viewer, peer],
      speaking: new Set([peer]),
    }),
  );
  const window = screen.getByRole("region", { name: "Huddle" });
  expect(window).toHaveTextContent("#design");
  expect(screen.getByRole("img", { name: "Wes, speaking" })).toBeVisible();
  expect(screen.getByText("You")).toBeVisible();
  expect(window.querySelector("textarea, input")).toBeNull();
  expect(session.profiles.ensure).toHaveBeenCalledWith(
    [viewer, peer],
    "background",
  );
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(store.huddles.setMuted).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  expect(store.huddles.leave).toHaveBeenCalledTimes(1);
  // No microphone outlives its window.
  unmount();
  expect(store.huddles.leave).toHaveBeenCalledTimes(2);
});

it("shows a relay refusal with a way to close it", () => {
  render(<HuddleWindow session={session} channels={channels} />);
  act(() =>
    store.set({
      status: "error",
      session,
      channelId: "c1",
      error: "not a member",
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("not a member");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(store.huddles.leave).toHaveBeenCalled();
});

it("invites only your own absent channel-member agents through the backing channel's membership", async () => {
  const control = {} as never;
  render(
    <HuddleWindow
      session={session}
      channels={channels}
      agentControl={control}
    />,
  );
  act(() =>
    store.set({
      status: "live",
      session,
      channelId: "c1",
      backing: "backing-1",
      participants: [viewer, peer],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add an agent" }));
  expect(await screen.findByRole("menuitem", { name: "Voice" })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Someone else's" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Already here" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Not in channel" })).toBeNull();
  memberAdditions.add.mockRejectedValueOnce(
    new Error("Only the huddle creator can add members"),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Voice" }));
  expect(memberAdditions.add).toHaveBeenCalledWith("backing-1", agent, control);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Only the huddle creator can add members",
  );
});

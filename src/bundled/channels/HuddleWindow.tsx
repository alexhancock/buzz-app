import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { AgentControl } from "../../features/agents/control";
import { useAgentChoices } from "../../features/agents/use-choices";
import { createPortal } from "react-dom";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { RelaySession } from "../../features/relay/session";
import { huddles } from "../../features/huddles/controller";
import { useIdentityNames } from "../../features/identity-names/react";
import {
  MicrophoneIcon,
  MicrophoneOffIcon,
  PhoneOffIcon,
  RobotIcon,
} from "../../shared/design-system/icons";
import {
  MenuItem,
  MenuNote,
  MenuPopup,
  MenuRoot,
  MenuTrigger,
} from "../../shared/design-system/ui/Menu";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { formatPublicKey } from "../../shared/identity/public-key";
import styles from "./Huddle.module.css";

const useHuddle = () =>
  useSyncExternalStore(huddles.subscribe, huddles.snapshot, huddles.snapshot);

/** Header entry point: join the channel's huddle, or leave the one you're in. */
export function HuddleButton({
  session,
  channelId,
}: {
  session: RelaySession;
  channelId: string;
}) {
  const huddle = useHuddle();
  const here =
    huddle.status !== "idle" &&
    huddle.status !== "error" &&
    huddle.session === session &&
    huddle.channelId === channelId;
  const label = here ? "Leave huddle" : "Start or join huddle";
  return (
    <IconButton
      size="sm"
      aria-label={label}
      title={label}
      aria-pressed={here}
      onClick={() =>
        here ? huddles.leave() : void huddles.join(session, channelId)
      }
      icon={<MicrophoneIcon size="1rem" aria-hidden="true" />}
    />
  );
}

/** Floating call window; voice only, no text chat. */
/** Invite one of your agents: membership in the backing channel is the invitation.
 * The agent's own runtime joins the audio room with its own live voice model. */
function AddAgent({
  session,
  backing,
  members,
  participants,
  control,
  setError,
}: {
  session: RelaySession;
  backing: string;
  /** Parent channel roster: an agent finds the huddle through its start event there. */
  members: readonly string[];
  participants: readonly string[];
  control: AgentControl | undefined;
  setError(error: string | undefined): void;
}) {
  const choices = useAgentChoices(session, true, true);
  const [inviting, setInviting] = useState<string>();
  const agents = choices.selectable.filter(
    (agent) =>
      agent.managed &&
      members.includes(agent.pubkey) &&
      !participants.includes(agent.pubkey),
  );
  return (
    <MenuRoot onOpenChange={(open) => open && setError(undefined)}>
      <MenuTrigger
        render={
          <IconButton
            size="md"
            variant="subtle"
            aria-label="Add an agent"
            title={inviting ? "Inviting agent…" : "Add an agent"}
            icon={<RobotIcon size="1rem" aria-hidden="true" />}
          />
        }
      />
      <MenuPopup>
        {agents.map((agent) => (
          <MenuItem
            key={agent.pubkey}
            disabled={inviting === agent.pubkey}
            onClick={() => {
              setInviting(agent.pubkey);
              session.memberAdditions
                .add(backing, agent.pubkey, control)
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "The agent could not be invited.",
                  ),
                )
                .finally(() => setInviting(undefined));
            }}
          >
            {agent.managedName ?? agent.name}
          </MenuItem>
        ))}
        {!agents.length && (
          <MenuNote>
            {choices.status === "ready" || choices.status === "error"
              ? "Add your agents to this channel to invite them."
              : "Loading your agents…"}
          </MenuNote>
        )}
      </MenuPopup>
    </MenuRoot>
  );
}

export function HuddleWindow({
  session,
  channels,
  agentControl,
}: {
  session: RelaySession;
  channels: readonly ChannelSummary[];
  agentControl?: AgentControl | undefined;
}) {
  const huddle = useHuddle();
  // Never leave a microphone open without its visible window.
  useEffect(() => () => huddles.leave(), []);
  useEffect(() => {
    if (huddle.session && huddle.session !== session) huddles.leave();
  }, [huddle.session, session]);
  const participants = huddle.participants;
  const key = participants.join();
  useEffect(() => {
    if (key) void session.profiles.ensure(key.split(","), "background");
  }, [session, key]);
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
    session.profiles.snapshot,
  );
  const resolveName = useIdentityNames(session.names);
  const [inviteError, setInviteError] = useState<string>();
  if (huddle.status === "idle" || huddle.session !== session) return null;
  const channel = channels.find((item) => item.id === huddle.channelId);
  return createPortal(
    <section className={styles.window} aria-label="Huddle">
      <header className={styles.header}>
        <span className={styles.title}>Huddle</span>
        {channel && <span className={styles.subtitle}>#{channel.name}</span>}
      </header>
      {huddle.status === "error" ? (
        <p role="alert" className={styles.status} data-error="">
          {huddle.error}
        </p>
      ) : (
        <>
          <ul className={styles.stage} aria-label="Participants">
            {participants.map((pubkey, index) => {
              const profile = profiles.get(pubkey);
              const name = resolveName(
                pubkey,
                profile?.name ?? formatPublicKey(pubkey) ?? "Participant",
              );
              const speaking = huddle.speaking.has(pubkey);
              return (
                <li
                  key={pubkey}
                  className={styles.participant}
                  data-speaking={speaking ? "" : undefined}
                  style={{ "--index": index } as CSSProperties}
                >
                  <span className={styles.avatar}>
                    <Avatar
                      alt={speaking ? `${name}, speaking` : name}
                      fallback={name}
                      src={
                        profile?.picture
                          ? session.media(profile.picture, "small")
                          : undefined
                      }
                      size="fill"
                      shape={profile?.isAgent ? "squircle" : "circle"}
                    />
                  </span>
                  <span className={styles.name} aria-hidden="true">
                    {pubkey === session.viewer ? "You" : name}
                  </span>
                </li>
              );
            })}
          </ul>
          {inviteError && (
            <p role="alert" className={styles.status} data-error="">
              {inviteError}
            </p>
          )}
          {huddle.status === "connecting" && (
            <p role="status" className={styles.status}>
              Connecting…
            </p>
          )}
        </>
      )}
      <div className={styles.controls}>
        {huddle.status === "error" ? (
          <Button size="sm" onClick={() => huddles.leave()}>
            Close
          </Button>
        ) : (
          <>
            <IconButton
              size="md"
              variant="subtle"
              aria-label={huddle.muted ? "Unmute" : "Mute"}
              title={huddle.muted ? "Unmute" : "Mute"}
              aria-pressed={huddle.muted}
              onClick={() => huddles.setMuted(!huddle.muted)}
              icon={
                huddle.muted ? (
                  <MicrophoneOffIcon size="1rem" aria-hidden="true" />
                ) : (
                  <MicrophoneIcon size="1rem" aria-hidden="true" />
                )
              }
            />
            {huddle.status === "live" && huddle.backing && (
              <AddAgent
                session={session}
                backing={huddle.backing}
                members={channel?.members ?? []}
                participants={participants}
                control={agentControl}
                setError={setInviteError}
              />
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => huddles.leave()}
            >
              <PhoneOffIcon size="1rem" aria-hidden="true" />
              Leave
            </Button>
          </>
        )}
      </div>
    </section>,
    document.body,
  );
}

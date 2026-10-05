import type { AgentControl } from "../../features/agents/control";
import { activityTarget } from "../../features/agents/activity-target";
import { useChannelNavigation } from "../../features/channel-navigation/ChannelNavigationState";
import {
  ChannelTabPicker,
  channelToolIcon,
  isChannelTabTool,
} from "./ChannelTabPicker";
import { ConversationTab } from "./ConversationTab";
import tabStyles from "./ChannelTabs.module.css";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { ChannelBody } from "./ChannelBody";
import {
  useChannelTabState,
  panelTabId,
  type PanelOpening,
} from "./useChannelTabState";
import { ChannelMembersDialog } from "./ChannelMembersDialog";
import { UsersIcon } from "../../shared/design-system/icons";
import { newSessionParent } from "../../features/channel-navigation/routes";
import { personalGroups } from "../../features/channel-templates/setup";
import type { TemplateProviders } from "../../features/channel-templates/provider";
import { OwnedContribution } from "../../plugins/OwnedContribution";
import { ChannelCanvasDialog } from "./ChannelCanvasDialog";
import { Select } from "../../shared/design-system/ui/Select";
import { NewMessage } from "../../features/direct-messages/NewMessage";
import { Panel } from "../../shared/design-system/ui/Panel";
import { PanelHeader } from "../../shared/design-system/ui/PanelHeader";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { useChannelPanels } from "./useChannelPanels";
import { ChannelHeaderMenu } from "./ChannelHeaderMenu";
import { HuddleButton, HuddleWindow } from "./HuddleWindow";
import { ChannelSettingsPanel } from "./ChannelSettingsPanel";
import { ChannelJoinNotice } from "./ChannelJoinNotice";
import { ChannelLifecycleActions } from "./ChannelLifecycleActions";
import type { PageNavigation } from "../../features/navigation/service";
import type { Navigation } from "../../features/navigation/controller";
import {
  buzzLinkTarget,
  isBuzzLink,
} from "../../features/navigation/buzz-links";
import { SessionMessageTarget } from "../../features/sessions/SessionMessageTarget";
import { NewSessionComposer } from "../../features/sessions/NewSessionComposer";
import {
  NewSessionView,
  SessionColumn,
  SessionHeading,
} from "../../features/sessions/SessionPresentation";
import { UnreadOptions } from "./UnreadBadge";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  SidebarRightIcon,
  PlugIcon,
  ChatCircleIcon,
  GearIcon,
  BrowserIcon,
} from "../../shared/design-system/icons/index";
import { channelIcon } from "../../features/channels/channel-icon";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import type { Panels, RegisteredPanel } from "../../features/panels/service";
import type { PagesReader } from "../../features/pages/service";
import { PanelWorkspace } from "../../features/panels/PanelWorkspace";
import { PanelCard } from "../../features/panels/PanelCard";
import { usePanelSplit } from "../../features/panels/usePanelSplit";
import { PanelDock } from "../../features/panels/PanelDock";
import { PanelFrame } from "../../features/panels/PanelFrame";
import { OutboxStatus } from "./OutboxStatus";
import { RelayTimings } from "./RelayTimings";
import { LiveStatus } from "./LiveStatus";
import { rejectUnhandledFileDrop } from "../../features/messages/use-file-drop";
import { MessageComposer } from "../../features/messages/MessageComposer";
import {
  MessageManagement,
  MessageManagementStatus,
} from "../../features/messages/MessageManagement";
import { ThreadPanel } from "../../features/messages/ThreadPanel";
import { MediaReviewViewer } from "../../features/messages/MediaReviewViewer";
import type { Attachment } from "../../features/relay/contracts";
import { readView, writeView } from "../../shared/view-state";
import { useChannelLabels } from "./useChannelLabels";
import { useComposerSent } from "./useComposerSent";
import { useSidebarPreferences } from "./useSidebarPreferences";
import styles from "./Channels.module.css";

export function ChannelsPage({
  agentControl,
  providers,
  extensions,
  relay,
  panels,
  pages,
  companion,
  navigation,
  navigator,
}: {
  agentControl?: AgentControl | undefined;
  providers: TemplateProviders;
  extensions?: ConversationExtensions | undefined;
  relay: RelayData;
  navigation?: PageNavigation | undefined;
  navigator?: Navigation | undefined;
  panels: Panels;
  pages: PagesReader;
  companion?: ReactNode;
}) {
  const session = useRelayConnection(relay);
  const registeredPages = useSyncExternalStore(
    pages.subscribe,
    pages.snapshot,
    pages.snapshot,
  );
  const sessionsEnabled = registeredPages.some(
    (page) => page.pluginId === "buzz.sessions",
  );
  const sessionNavigation = navigation?.forSession(relay, session);
  useEffect(() => {
    if (!navigation || !sessionNavigation) return;
    if (session.status === "disconnected" && navigation.target.kind === "page")
      sessionNavigation.complete({ status: "opened" });
    else if (session.status === "error" && !session.cached)
      sessionNavigation.complete({ status: "failed", reason: "unavailable" });
  }, [navigation, sessionNavigation, session.status, session.cached]);
  return (
    <section className={styles.root} aria-label="Channels">
      {session.status !== "ready" && !session.cached ? (
        <PanelFrame companion={companion}>
          <div className={styles.connect}>
            <div className={styles.connectIcon}>
              <PlugIcon size={30} />
            </div>
            <h1>Your channels, one conversation.</h1>
            <p>
              {session.status === "disconnected"
                ? "Use the left community rail to choose or add a community. Your profile and settings work without a community."
                : "Connection details and retry are in the sidebar. Your profile and settings work without a community."}
            </p>
          </div>
        </PanelFrame>
      ) : (
        <ChannelWorkspace
          agentControl={agentControl}
          providers={providers}
          extensions={extensions}
          key={`${session.scope ?? "disconnected"}:${session.generation}`}
          scope={session.scope ?? "disconnected"}
          cached={!!session.cached}
          queries={session.session}
          relay={relay}
          navigation={sessionNavigation}
          navigator={navigator}
          viewer={session.viewer}
          panels={panels}
          sessionsEnabled={sessionsEnabled}
          companion={companion}
        />
      )}
    </section>
  );
}

function ChannelWorkspace({
  agentControl,
  providers,
  extensions,
  queries,
  cached,
  relay,
  panels,
  sessionsEnabled,
  scope,
  companion,
  navigation,
  navigator,
  viewer,
}: {
  agentControl?: AgentControl | undefined;
  providers: TemplateProviders;
  extensions?: ConversationExtensions | undefined;
  companion?: ReactNode;
  scope: string;
  navigation?: PageNavigation | undefined;
  navigator?: Navigation | undefined;
  viewer?: string | undefined;
  queries: RelaySession;
  cached: boolean;
  relay: RelayData;
  panels: Panels;
  sessionsEnabled: boolean;
}) {
  const composingMessage =
    navigation?.target.kind === "page" &&
    navigation.target.route?.params === "new-message";
  const list = useChannelList(queries.channels);
  const preferences = useSidebarPreferences(queries.sidebarPreferences);
  const kitState = useSyncExternalStore(
    queries.channelKit.subscribe,
    queries.channelKit.snapshot,
  );
  const templateProviders = useSyncExternalStore(
    providers.subscribe,
    providers.snapshot,
  );
  const templateProvider =
    templateProviders.length === 1 ? templateProviders[0] : undefined;
  useEffect(() => {
    // Initial channel discovery cancels in-flight reads as it settles access.
    // Start the optional catalog afterward so opening Messages cannot strand it.
    if (list.status === "ready") queries.channelKit.ensure();
  }, [queries, list.status]);
  const groupEntry = personalGroups(kitState.entries);
  const personal =
    groupEntry?.record.value.type === "groups"
      ? groupEntry.record.value
      : undefined;
  const [canvasOrigin, setCanvasOrigin] = useState<{
    channelId: string;
    navigation: PageNavigation | undefined;
  }>();
  const [composerFocus, setComposerFocus] = useState(0);
  // A started join focuses the composer when membership makes it writable,
  // however that membership arrives. Opening another channel drops the intent.
  const [joiningChannel, setJoiningChannel] = useState<string>();
  const canvasTrigger = useRef<HTMLButtonElement>(null);
  const [membersChannel, setMembersChannel] = useState<string>();
  const membersTrigger = useRef<HTMLButtonElement>(null);
  const membersHeaderTrigger = useRef<HTMLButtonElement>(null);
  const [kitError, setKitError] = useState("");
  useEffect(() => {
    void queries.emoji.ensure();
  }, [queries]);
  useEffect(() => {
    if (list.status === "ready") void queries.unread.ensure();
  }, [queries, list.status]);
  const available = useSyncExternalStore(
    panels.subscribe,
    panels.snapshot,
    panels.snapshot,
  );
  const [selected, setSelected] = useState<string | undefined>(() =>
    readView(scope, "selected-channel", undefined),
  );
  const handoff = useChannelNavigation();
  const draftParent =
    navigation?.target.kind === "page"
      ? newSessionParent(navigation.target.route?.params)
      : undefined;
  const clearPreparingDm = handoff?.clearPreparingDm;
  useEffect(() => {
    if (!composingMessage) clearPreparingDm?.();
    return () => clearPreparingDm?.();
  }, [composingMessage, clearPreparingDm]);
  const navigate = useCallback(
    (id: string) => {
      setSelected(id);
      writeView(scope, "selected-channel", id);
      if (navigator && viewer) {
        void navigator.open({
          version: 1,
          kind: "conversation",
          channelId: id,
          scope: {
            viewer,
            communityOrigin: scope.slice(0, -(viewer.length + 1)),
          },
        });
      }
    },
    [navigator, viewer, scope],
  );
  const select = useCallback(
    (id: string) => {
      navigate(id);
    },
    [navigate],
  );
  const threadTrigger = useRef<HTMLElement | null>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const [sent, setSent] = useState<{ channelId: string; id: string }>();
  const { channels, profiles } = useChannelLabels(
    list.channels,
    queries.profiles,
    queries.names,
  );
  const requestedChannel =
    draftParent ??
    (navigation?.target.kind === "conversation"
      ? navigation.target.channelId
      : undefined);
  const [resolved, setResolved] = useState<{
    request: PageNavigation;
    available: boolean;
  }>();
  const joinedRequest = list.channels.some(
    (channel) => channel.id === requestedChannel,
  );
  useEffect(() => {
    // Let initial membership discovery settle before resolving an omitted target.
    // A premature exact lookup publishes a one-channel list and starts readers
    // that the completing full roster then invalidates.
    if (
      cached ||
      !requestedChannel ||
      !navigation ||
      joinedRequest ||
      list.status === "idle" ||
      list.status === "loading" ||
      !queries.channels.resolve
    )
      return;
    const controller = new AbortController();
    void queries.channels
      .resolve([requestedChannel], {
        signal: AbortSignal.any([controller.signal, navigation.signal]),
        priority: "foreground",
      })
      .then(() => {
        if (!controller.signal.aborted && !navigation.signal.aborted)
          setResolved({ request: navigation, available: true });
      })
      .catch(() => {
        if (!controller.signal.aborted && !navigation.signal.aborted) {
          setResolved({ request: navigation, available: false });
          navigation.complete({ status: "failed", reason: "unavailable" });
        }
      });
    return () => controller.abort();
  }, [
    cached,
    requestedChannel,
    navigation,
    joinedRequest,
    queries,
    list.status,
  ]);
  const resolving =
    !!requestedChannel &&
    !joinedRequest &&
    !!queries.channels.resolve &&
    resolved?.request !== navigation;
  // Lifecycle completion must not reopen retained archived/hidden membership
  // through the mounted workspace's saved selection or first-channel fallback.
  const emptyDestination =
    navigation?.target.kind === "page" &&
    navigation.target.route?.params === "empty";
  const current = emptyDestination
    ? undefined
    : requestedChannel
      ? (channels.find((channel) => channel.id === requestedChannel) ??
        // Sidebar visibility is not access: retain a joined archived selection.
        list.channels.find((channel) => channel.id === requestedChannel) ??
        (resolved?.request === navigation && resolved?.available
          ? queries.channels.get?.(requestedChannel)
          : undefined))
      : (channels.find((channel) => channel.id === selected) ??
        channels.find((item) => item.channelType !== "session"));
  // Sidebar routing can update the same mounted page. Keep its saved default
  // aligned with the resolved conversation, not only page-local clicks.
  useEffect(() => {
    if (navigation?.target.kind !== "conversation" || !current) return;
    setSelected(current.id);
    writeView(scope, "selected-channel", current.id);
  }, [navigation?.target, current, scope]);
  useEffect(() => {
    if (!joiningChannel || !current) return;
    if (current.id !== joiningChannel) setJoiningChannel(undefined);
    else if (!current.readOnly) {
      setJoiningChannel(undefined);
      setComposerFocus((value) => value + 1);
    }
  }, [joiningChannel, current]);
  const CurrentChannelIcon = channelIcon(current);
  useEffect(() => {
    if (navigation?.signal.aborted) return;
    if (composingMessage) {
      navigation?.complete({ status: "opened" });
      return;
    }
    if (
      !cached &&
      requestedChannel &&
      !resolving &&
      list.status === "ready" &&
      !current
    )
      navigation?.complete({ status: "failed", reason: "unavailable" });
    if (!requestedChannel && !current && list.status === "ready")
      navigation?.complete({ status: "opened" });
    if (!requestedChannel && current && navigation && viewer) {
      // Resolve the saved default within this attempt, keeping its caller and deadline.
      navigation.resolve({
        version: 1,
        kind: "conversation",
        channelId: current.id,
        scope: {
          viewer,
          communityOrigin: scope.slice(0, -(viewer.length + 1)),
        },
      });
    }
  }, [
    cached,
    composingMessage,
    requestedChannel,
    resolving,
    current,
    list.status,
    navigation,
    viewer,
    scope,
  ]);
  const requestedMessage =
    navigation?.target.kind === "conversation"
      ? navigation.target.messageId
      : undefined;
  const requestedThread =
    navigation?.target.kind === "conversation"
      ? navigation.target.threadRootId
      : undefined;
  const membersRequested =
    navigation?.target.kind === "conversation" &&
    navigation.target.panel === "members";
  const membersOpen =
    (navigator ? membersRequested : membersChannel === current?.id) &&
    !!current &&
    current.channelType !== "session";
  useLayoutEffect(() => {
    // Sessions have no Members surface. Canonicalize an old/handwritten route
    // before a child reader can complete it, retaining its exact message address.
    if (
      !cached &&
      current &&
      !current.cached &&
      current.channelType === "session" &&
      navigation?.target.kind === "conversation" &&
      navigation.target.panel === "members" &&
      !navigation.signal.aborted
    ) {
      const { panel: _panel, ...target } = navigation.target;
      navigation.resolve(target);
    }
  }, [cached, current, navigation]);
  const currentId = current?.id;
  const canvasOpen =
    !!canvasOrigin &&
    canvasOrigin.channelId === currentId &&
    canvasOrigin.navigation === navigation &&
    !navigation?.signal.aborted;
  useEffect(() => {
    if (!canvasOpen) setCanvasOrigin(undefined);
  }, [canvasOpen]);
  useEffect(() => {
    setMembersChannel((id) => (id === currentId ? id : undefined));
  }, [currentId]);
  const setMembersOpen = (open: boolean) => {
    if (!navigator) {
      setMembersChannel(open ? currentId : undefined);
      return;
    }
    if (
      !navigation ||
      navigation.signal.aborted ||
      navigation.target.kind !== "conversation" ||
      navigation.target.channelId !== currentId ||
      navigator.snapshot().entry.id !== navigation.entryId
    )
      return;
    // A profile keeps this conversation; a DM already owns a different visit.
    // Modal cleanup must not overwrite that destination or its exact address.
    const { panel: _panel, ...target } = navigation.target;
    void navigator.open(open ? { ...target, panel: "members" } : target);
  };
  const openMembers = (trigger: HTMLButtonElement) => {
    membersTrigger.current = trigger;
    setMembersOpen(true);
  };
  const committedVisit = useRef<{
    currentId: string | undefined;
    queries: RelaySession;
  }>(undefined);
  const continuingVisit =
    committedVisit.current?.currentId === currentId &&
    committedVisit.current?.queries === queries;
  useLayoutEffect(() => {
    committedVisit.current = { currentId, queries };
  }, [currentId, queries]);
  const tabState = useChannelTabState(queries, currentId);
  const { thread, setThread, settings, setSettings, entries, setEntries } =
    tabState;
  useEffect(() => {
    if (!currentId || composingMessage || draftParent) return;
    // Retire this visit's reveal intent without discarding a new-DM handoff.
    return () => {
      setSent((previous) =>
        previous?.channelId === currentId ? undefined : previous,
      );
    };
  }, [currentId, composingMessage, draftParent]);

  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [settingsFocus, requestSettingsFocus] = useState(0);
  const splitTrigger = useRef<HTMLButtonElement>(null);
  const showingSettings =
    tabState.paneOpen &&
    !!settings &&
    settings.channelId === currentId &&
    tabState.selected === "settings";
  const closeSettings = () => {
    setSettings(undefined);
    afterClose("settings");
  };
  const canStartSession =
    !!current &&
    sessionsEnabled &&
    !current.readOnly &&
    !current.archived &&
    current.channelType !== "dm" &&
    current.channelType !== "session";
  const drafting =
    canStartSession &&
    !!draftParent &&
    draftParent === currentId &&
    !requestedMessage;
  useEffect(() => {
    if (drafting && navigation?.target.kind === "page")
      navigation.complete({ status: "opened" });
    if (
      !cached &&
      draftParent &&
      (!sessionsEnabled || (current && !canStartSession))
    )
      navigation?.complete({ status: "failed", reason: "unavailable" });
  }, [
    cached,
    drafting,
    navigation,
    draftParent,
    sessionsEnabled,
    current,
    canStartSession,
  ]);
  const flatSession = current?.channelType === "session";
  const onComposerSend = useComposerSent(
    currentId,
    flatSession && !!requestedMessage,
    setSent,
    select,
  );
  const [exactOpening, setExactOpening] = useState<{
    request: PageNavigation;
    inTimeline: boolean;
  }>();
  useEffect(() => {
    if (
      cached ||
      current?.cached ||
      !navigation ||
      !requestedMessage ||
      (!flatSession && requestedThread === requestedMessage) ||
      !currentId ||
      navigation.signal.aborted
    )
      return;
    let selected = false;
    const choose = () => {
      if (selected || navigation.signal.aborted) return;
      const window = queries.channels.window(currentId);
      if (window.status === "idle" || window.status === "loading") return;
      selected = true;
      // Freeze the presentation for this attempt. An isolated lookup or later
      // live event must not move an already-opened thread into the timeline.
      setExactOpening({
        request: navigation,
        inTimeline:
          (flatSession || requestedThread !== requestedMessage) &&
          window.status === "ready" &&
          window.freshness !== "cached" &&
          window.rows.some(
            (row) =>
              row.id === requestedMessage && (flatSession || !row.threadRootId),
          ),
      });
    };
    const stop = queries.channels.subscribeWindow(currentId, choose);
    choose();
    return stop;
  }, [
    cached,
    current?.cached,
    navigation,
    requestedMessage,
    requestedThread,
    currentId,
    queries,
    flatSession,
  ]);
  // A live connection can still be confirming its restored membership. Keep
  // the pending intent; an exact reader cannot use display-only authority.
  const exact =
    cached || current?.cached
      ? undefined
      : !flatSession &&
          navigation &&
          requestedMessage &&
          requestedThread === requestedMessage
        ? { request: navigation, inTimeline: false }
        : exactOpening?.request === navigation
          ? exactOpening
          : undefined;
  type ShowingThread = {
    channelId: string;
    messageId: string;
    navigation?: PageNavigation | undefined;
  };
  const priorRoutedThread = useRef<ShowingThread | undefined>(undefined);
  let showingThread: ShowingThread | undefined =
    !cached && requestedMessage
      ? exact && !exact.inTimeline && current
        ? { channelId: current.id, messageId: requestedMessage, navigation }
        : undefined
      : thread && thread.channelId === current?.id
        ? { ...thread, navigation: undefined }
        : undefined;
  if (flatSession) {
    showingThread = undefined;
    priorRoutedThread.current = undefined;
  }
  if (showingThread?.navigation) priorRoutedThread.current = showingThread;
  else if (
    current &&
    !showingThread &&
    (!navigation || (requestedMessage && !exact))
  )
    showingThread = priorRoutedThread.current;
  else priorRoutedThread.current = undefined;
  useEffect(() => {
    if (showingThread?.navigation)
      setThread({
        channelId: showingThread.channelId,
        messageId: showingThread.messageId,
      });
  }, [
    showingThread?.channelId,
    showingThread?.messageId,
    showingThread?.navigation,
    setThread,
  ]);
  // Retargeting the retained thread is a new opening, not a passive rerender.
  const threadChannelId = showingThread?.channelId;
  const threadMessageId = showingThread?.messageId;
  const threadInstance = useMemo(
    () => ({ queries, scope, threadChannelId, threadMessageId }),
    [queries, scope, threadChannelId, threadMessageId],
  );
  type Opening = PanelOpening;
  const opened = entries.find(
    (entry) => panelTabId(entry) === tabState.selected,
  );
  const entryList = useRef<Opening[]>(entries);
  const opening = useRef<Opening | undefined>(opened);
  const renderedChannel = useRef({ currentId, queries });
  if (
    renderedChannel.current.currentId !== currentId ||
    renderedChannel.current.queries !== queries
  ) {
    renderedChannel.current = { currentId, queries };
    entryList.current = entries;
    opening.current = opened;
  }
  const selectOpening = useCallback(
    (next: Opening | undefined) => {
      opening.current = next;
      tabState.select(next ? panelTabId(next) : "thread");
    },
    [tabState.select],
  );
  const open = useCallback(
    (next: Opening | undefined, append = false) => {
      const existing =
        append && next
          ? entryList.current.find(
              (entry) =>
                entry.panel === next.panel && entry.target === next.target,
            )
          : undefined;
      const selected = existing || next;
      // Timeline actions replace transient details, never retained channel tools.
      const retained = append
        ? entryList.current
        : entryList.current.filter(
            (entry) =>
              entry.channelContext &&
              (!selected || panelTabId(entry) !== panelTabId(selected)),
          );
      const updated =
        selected && !existing ? [...retained, selected] : retained;
      entryList.current = updated;
      setEntries(updated);
      selectOpening(selected);
    },
    [selectOpening, setEntries],
  );
  const previousThreadRoute = useRef({ currentId, requestedMessage });
  useLayoutEffect(() => {
    // Navigation temporarily withdraws the old presentation while preparing
    // the next destination. That handoff must not dismiss saved thread tabs.
    if (!navigation || navigation.signal.aborted) return;
    const previous = previousThreadRoute.current;
    previousThreadRoute.current = { currentId, requestedMessage };
    // Back within a channel dismisses its routed thread; channel switches keep
    // that channel's saved tabs for the next visit.
    if (
      previous.currentId === currentId &&
      previous.requestedMessage &&
      !requestedMessage
    )
      setThread(undefined);
    if (draftParent || composingMessage) {
      setThread(undefined);
      open(undefined);
    } else if (
      requestedMessage &&
      previous.requestedMessage !== requestedMessage &&
      (thread?.channelId !== currentId ||
        thread?.messageId !== requestedMessage)
    ) {
      // A new target selects its thread. Remounting an existing route restores
      // the selected detail tab instead of discarding the saved tab set.
      selectOpening(undefined);
    }
    const activity = handoff?.activityThread.current;
    if (
      activity &&
      activity.channelId === requestedChannel &&
      activity.messageId === requestedMessage &&
      activity.entryId === navigation?.entryId &&
      !activity.signal.aborted &&
      exact?.request === navigation
    ) {
      threadTrigger.current = activity.trigger;
      if (!exact.inTimeline) selectOpening(undefined);
      handoff.activityThread.current = undefined;
    }
    const activityAgent = handoff?.activityAgent.current;
    if (activityAgent && activityAgent.channelId === current?.id) {
      const target = activityTarget(
        activityAgent.agent,
        activityAgent.channelId,
      );
      const panel = panels.resolve(target);
      if (panel) {
        panelTrigger.current = activityAgent.trigger;
        open({ channelId: activityAgent.channelId, panel, target }, true);
      }
      handoff.activityAgent.current = undefined;
    }
  }, [
    draftParent,
    composingMessage,
    requestedMessage,
    navigation,
    requestedChannel,
    open,
    handoff?.activityThread,
    exact?.request,
    exact?.inTimeline,
    setThread,
    selectOpening,
    currentId,
    thread,
    handoff?.activityAgent,
    current?.id,
    panels,
  ]);
  const panelTabs = entries.filter(
    (entry) =>
      available.includes(entry.panel) &&
      (!entry.channelContext ||
        (current &&
          !current.readOnly &&
          !current.archived &&
          current.id === entry.channelId)),
  );
  const panel = opened && panelTabs.includes(opened) ? opened.panel : undefined;
  const mounted = useRef(false);
  const channel = useRef(current?.id);
  useLayoutEffect(() => {
    channel.current = current?.id;
  }, [current?.id]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (entries.length !== panelTabs.length) {
      entryList.current = panelTabs;
      setEntries(panelTabs);
    }
    if (opened && !panel) selectOpening(undefined);
  }, [entries.length, panelTabs, opened, panel, setEntries, selectOpening]);
  const [replyRequest, setReplyRequest] = useState<{
    channelId: string;
    messageId: string;
    entryId: string | undefined;
    sequence: number;
  }>();
  const activeEntryId = navigator?.snapshot().entry.id;
  useEffect(() => {
    if (
      replyRequest &&
      (replyRequest.channelId !== currentId ||
        replyRequest.entryId !== activeEntryId)
    )
      setReplyRequest(undefined);
  }, [currentId, activeEntryId, replyRequest]);
  const openThread = useCallback(
    (messageId: string, threadRootId: string, intent?: "reply") => {
      if (!currentId) return;
      const requestReply = () =>
        setReplyRequest((previous) =>
          intent === "reply"
            ? {
                channelId: currentId,
                messageId,
                entryId: navigator?.snapshot().entry.id,
                sequence: (previous?.sequence ?? 0) + 1,
              }
            : undefined,
        );
      setSettings(undefined);
      const target = navigator?.snapshot().entry.target;
      if (
        target?.kind === "conversation" &&
        target.channelId === currentId &&
        target.messageId === messageId &&
        target.threadRootId === threadRootId
      ) {
        selectOpening(undefined);
        requestReply();
        return;
      }
      threadTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (navigator && viewer) {
        setThread(undefined);
        void navigator.open({
          version: 1,
          kind: "conversation",
          channelId: currentId,
          messageId,
          threadRootId,
          scope: {
            viewer,
            communityOrigin: scope.slice(0, -(viewer.length + 1)),
          },
        });
      } else setThread({ channelId: currentId, messageId });
      requestReply();
      open(undefined);
    },
    [
      currentId,
      navigator,
      viewer,
      scope,
      open,
      selectOpening,
      setSettings,
      setThread,
    ],
  );
  const mediaReviewTrigger = useRef<HTMLElement | null>(null);
  const [mediaReview, setMediaReview] = useState<{
    channelId: string;
    channelName: string;
    messageId: string;
    attachment: Attachment;
    initialTime: number;
    hasComments: boolean;
    entryId?: string | undefined;
  }>();
  // The current destination may be an authorized public preview, which is
  // intentionally absent from the joined-channel list.
  const showingMediaReview = current?.archived
    ? undefined
    : mediaReviewForDestination(mediaReview, current?.id, navigation?.entryId);
  useEffect(() => {
    if (mediaReview && !showingMediaReview) setMediaReview(undefined);
  }, [mediaReview, showingMediaReview]);
  // Timeline rows are memoized; their callbacks read the shown destination at
  // call time so a new navigation request does not rerender every row.
  const destination = useRef({ current, navigation });
  useLayoutEffect(() => {
    destination.current = { current, navigation };
  }, [current, navigation]);
  const openMediaReview = useCallback(
    (
      messageId: string,
      attachment: Attachment,
      initialTime: number,
      hasComments = false,
    ) => {
      const { current, navigation } = destination.current;
      if (!current) return;
      setSettings(undefined);
      mediaReviewTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setThread(undefined);
      setMediaReview({
        channelId: current.id,
        channelName: current.name,
        messageId,
        attachment,
        initialTime,
        hasComments,
        ...(navigation ? { entryId: navigation.entryId } : {}),
      });
    },
    [setSettings, setThread],
  );
  const closeThread = () => {
    setReplyRequest(undefined);
    if (showingThread?.navigation && current) select(current.id);
    setThread(undefined);
    if (threadTrigger.current?.isConnected) threadTrigger.current.focus();
  };
  // Availability follows active contributions; dispatch still re-resolves at click time.
  const canOpenLink = useCallback(
    (target: string) =>
      available.some((candidate) => {
        try {
          return candidate.matches(target);
        } catch {
          return false;
        }
      }),
    [available],
  );
  const linkContext = useRef({
    channelId: currentId,
    routedThread: !!showingThread?.navigation,
  });
  useLayoutEffect(() => {
    linkContext.current = {
      channelId: currentId,
      routedThread: !!showingThread?.navigation,
    };
  }, [currentId, showingThread?.navigation]);
  const openLink = useCallback(
    (url: string, fromThread = false, returnFocus?: HTMLElement) => {
      const { current, navigation } = destination.current;
      const connection = relay.snapshot();
      if (
        !mounted.current ||
        channel.current !== current?.id ||
        connection.status !== "ready" ||
        connection.session !== queries ||
        navigation?.signal.aborted
      )
        return false;
      if (isBuzzLink(url) && navigator && viewer) {
        const target = buzzLinkTarget(url, {
          viewer,
          communityOrigin: scope.slice(0, -(viewer.length + 1)),
        });
        // Internal panel targets also use buzz:. Only routable links belong
        // to the navigator; registered panels handle the remaining targets.
        if (target) {
          if (target.kind === "conversation" && target.messageId)
            threadTrigger.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          setThread(undefined);
          open(undefined);
          void navigator.open(target);
          return true;
        }
      }
      const candidate = panels.resolve(url);
      const context = linkContext.current;
      if (context.channelId && candidate) {
        setSettings(undefined);
        panelTrigger.current =
          returnFocus ??
          (document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null);
        // Thread-origin details cover the live thread instead of retiring it.
        if (!fromThread) {
          if (context.routedThread) select(context.channelId);
          setThread(undefined);
        }
        open(
          {
            channelId: context.channelId,
            panel: candidate,
            target: url,
          },
          fromThread,
        );
        return true;
      }
      return false;
    },
    [
      panels,
      open,
      relay,
      queries,
      select,
      navigator,
      viewer,
      scope,
      setSettings,
      setThread,
    ],
  );
  const openThreadLink = useCallback(
    (url: string) => openLink(url, true),
    [openLink],
  );
  const panelActive = (entry: Opening) => {
    const connection = relay.snapshot();
    return !!(
      mounted.current &&
      opened &&
      panel &&
      opening.current === entry &&
      panels.snapshot().includes(panel) &&
      connection.status === "ready" &&
      connection.session === queries &&
      !navigation?.signal.aborted
    );
  };
  const panelContext = (entry: Opening) => ({
    channelId: entry.channelId,
    canOpen: (target: string) => !!panels.resolve(target),
    open: (target: string) => {
      if (!panelActive(entry)) return false;
      const next = panels.resolve(target);
      if (!next) return false;
      const existing = entryList.current.find(
        (item) => item.panel === next && item.target === target,
      );
      const replacement = existing ?? { ...entry, panel: next, target };
      entryList.current = entryList.current
        .map((item) => (item === entry ? replacement : item))
        .filter((item, index, all) => all.indexOf(item) === index);
      setEntries(entryList.current);
      selectOpening(replacement);
      return true;
    },
    push: (target: string) => {
      if (!panelActive(entry)) return false;
      const next = panels.resolve(target);
      if (!next) return false;
      open({ channelId: entry.channelId, panel: next, target }, true);
      return true;
    },
  });
  const tabId = panelTabId;
  const closeTab = (entry: Opening) => {
    const remaining = entryList.current.filter((item) => item !== entry);
    entryList.current = remaining;
    setEntries(remaining);
    afterClose(tabId(entry), panelTrigger.current);
  };
  const drawerContext = useMemo(
    () =>
      current && !current.readOnly && viewer
        ? {
            scope,
            viewer,
            channelId: current.id,
            channelName: current.name,
            relayUrl: scope
              .slice(0, -(viewer.length + 1))
              .replace(/^https:/, "wss:")
              .replace(/^http:/, "ws:"),
            ...(showingThread && { threadId: showingThread.messageId }),
          }
        : undefined,
    [scope, viewer, current, showingThread],
  );
  const drawer = useChannelPanels(
    panels,
    drawerContext,
    () => {
      setSettings(undefined);
      tabState.setPaneOpen(true);
    },
    (panel) => {
      const entry = panelTabs.find(
        (entry) => entry.panel === panel && entry.channelContext,
      );
      if (!entry) return false;
      if (tabState.paneOpen && tabState.selected === panelTabId(entry))
        tabState.setPaneOpen(false);
      else selectOpening(entry);
      return true;
    },
  );
  const tabTools =
    drawerContext && !current?.archived
      ? available.filter(isChannelTabTool)
      : [];
  const chooseTool = (id: string, panel: RegisteredPanel) => {
    const connection = relay.snapshot();
    if (
      connection.status !== "ready" ||
      connection.session !== queries ||
      !drawerContext ||
      !tabTools.includes(panel) ||
      !panels.snapshot().includes(panel)
    )
      return;
    // A terminal's screen/session has one presentation owner at a time.
    drawer.close();
    panelTrigger.current = splitTrigger.current;
    tabState.setTabs((tabs) => tabs.filter((tab) => tab.id !== id));
    open(
      {
        panel,
        target: drawerContext.channelId,
        channelId: drawerContext.channelId,
        channelContext: drawerContext,
      },
      true,
    );
  };
  const tabDestinations = channels.filter(
    (item) =>
      item.id !== currentId &&
      !item.cached &&
      !item.readOnly &&
      item.channelType !== "session",
  );
  const conversationIcon = (item: (typeof channels)[number]) => {
    const Icon = channelIcon(item);
    const person = item.participants?.[0];
    const picture = person ? profiles.get(person)?.picture : undefined;
    return item.channelType === "dm" ? (
      <span className={tabStyles.icon}>
        <Avatar
          alt=""
          fallback={item.name}
          size="fill"
          src={picture ? queries.media(picture) : null}
        />
      </span>
    ) : (
      <Icon size="1rem" />
    );
  };
  const rootTabIds = [
    ...(settings ? ["settings"] : []),
    ...(showingThread ? ["thread"] : []),
    ...tabState.tabs.map((tab) => tab.id),
    ...panelTabs.map(tabId),
  ];
  const selectedTab = rootTabIds.includes(tabState.selected)
    ? tabState.selected
    : (rootTabIds[0] ?? "");
  const selectPanelTab = (id: string) => {
    opening.current = panelTabs.find((entry) => tabId(entry) === id);
    tabState.select(id);
  };
  const afterClose = (id: string, trigger?: HTMLElement | null) => {
    if (id !== selectedTab) return;
    const index = rootTabIds.indexOf(id);
    const remaining = rootTabIds.filter((tab) => tab !== id);
    selectPanelTab(remaining[Math.min(index, remaining.length - 1)] ?? "");
    if (!remaining.length)
      (trigger?.isConnected ? trigger : settingsTrigger.current)?.focus({
        preventScroll: true,
      });
  };
  const addTab = () => {
    const id = `new:${crypto.randomUUID()}`;
    tabState.setTabs((tabs) => [...tabs, { id, kind: "new" }]);
    selectPanelTab(id);
  };
  const closeConversationTab = (id: string) => {
    tabState.setTabs((tabs) => tabs.filter((tab) => tab.id !== id));
    afterClose(id);
    if (rootTabIds.length === 1)
      splitTrigger.current?.focus({ preventScroll: true });
  };
  const chooseConversation = (id: string, channelId: string) => {
    // Recheck current membership at activation, not just the rendered search result.
    const target = queries.channels
      .list()
      .channels.find((item) => item.id === channelId);
    if (
      !target ||
      target.cached ||
      target.readOnly ||
      target.archived ||
      channelId === currentId
    )
      return;
    const existing = tabState.tabs.find(
      (tab) => tab.kind === "conversation" && tab.channelId === channelId,
    );
    const targetId = `conversation:${channelId}`;
    tabState.setTabs((tabs) =>
      existing
        ? tabs.filter((tab) => tab.id !== id)
        : tabs.map((tab) =>
            tab.id === id
              ? { id: targetId, kind: "conversation", channelId }
              : tab,
          ),
    );
    selectPanelTab(existing?.id ?? targetId);
  };
  const openConversationThread = (
    channelId: string,
    messageId: string,
    rootId: string,
    intent?: "reply",
  ) => {
    const id = `thread:${channelId}:${rootId}`;
    tabState.setTabs((tabs) => {
      const existing = tabs.find((tab) => tab.id === id);
      const next = {
        id,
        kind: "thread" as const,
        channelId,
        messageId,
        replyRequest:
          intent === "reply"
            ? ((existing?.kind === "thread" ? existing.replyRequest : 0) ?? 0) +
              1
            : undefined,
      };
      return existing
        ? tabs.map((tab) => (tab.id === id ? next : tab))
        : [...tabs, next];
    });
    selectPanelTab(id);
  };
  const openConversationLink = (channelId: string, url: string) => {
    const connection = relay.snapshot();
    if (connection.status !== "ready" || connection.session !== queries)
      return false;
    const candidate = panels.resolve(url);
    if (candidate) {
      panelTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      open({ channelId, panel: candidate, target: url }, true);
      return true;
    }
    return openLink(url, true);
  };
  const hasChannelPanel =
    !composingMessage &&
    (settings ||
      tabState.tabs.length > 0 ||
      panelTabs.length > 0 ||
      showingThread ||
      drawer.side);
  const hasPanel = companion || hasChannelPanel;
  const showingChannelPanel = tabState.paneOpen && hasChannelPanel;
  const showingPanel = companion || showingChannelPanel;
  const split = usePanelSplit();
  useEffect(() => {
    // Only an explicit settings click moves focus; restoring a visit does not.
    if (settingsFocus)
      split.ref.current
        ?.querySelector<HTMLElement>(
          '[data-panel-workspace] [data-tab-value="settings"]',
        )
        ?.focus({ preventScroll: true });
  }, [settingsFocus, split.ref]);
  const openCanvas = (trigger: HTMLButtonElement) => {
    canvasTrigger.current = trigger;
    if (currentId && !navigation?.signal.aborted)
      setCanvasOrigin({ channelId: currentId, navigation });
  };
  const settingsContent = (
    <ChannelSettingsPanel
      scope={scope}
      openMembers={openMembers}
      key={settings?.id}
      setupTools={
        current && (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {templateProvider && (
              <OwnedContribution
                key={`template:${current.id}`}
                entry={templateProvider}
                registry={providers}
              >
                {(entry, active) => {
                  const SaveAs = entry.saveAs;
                  return (
                    <SaveAs
                      session={queries}
                      channel={current}
                      active={active}
                    />
                  );
                }}
              </OwnedContribution>
            )}
            {personal && (
              <Select
                label="Personal group"
                variant="field"
                value={personal.assignments[current.id] ?? ""}
                groups={[
                  {
                    label: "",
                    options: [
                      { value: "", label: "No group" },
                      ...personal.groups.map((g) => ({
                        value: g.id,
                        label: g.name,
                      })),
                    ],
                  },
                ]}
                onValueChange={async (groupId) => {
                  const assignments = { ...personal.assignments };
                  if (groupId) assignments[current.id] = groupId;
                  else delete assignments[current.id];
                  setKitError("");
                  try {
                    await queries.channelKit.save(
                      { ...personal, assignments },
                      groupEntry?.eventId,
                    );
                  } catch (error) {
                    setKitError(String(error));
                  }
                }}
              />
            )}
            {kitError && <p role="alert">{kitError}</p>}
            {handoff &&
              !current.readOnly &&
              current.channelType !== "dm" &&
              current.channelType !== "session" && (
                <ChannelLifecycleActions
                  key={`${current.id}:${!!current.archived}`}
                  channelId={current.id}
                  lifecycle={queries.channelLifecycle}
                  choose={(action, trigger) =>
                    handoff.openLifecycle(current, action, trigger)
                  }
                />
              )}
          </div>
        )
      }
      channel={current}
      details={queries.channelDetails}
      close={closeSettings}
    >
      <UnreadOptions session={queries} channelId={current?.id} />
      <LiveStatus
        live={queries.live}
        channelId={current?.id}
        partialRoster={list.coverage === "partial"}
        diagnostics
      />
      <p>
        {list.coverage === "partial" ? "Partial roster" : "Roster"} ·{" "}
        {channels.length} channels
      </p>
      <Button type="button" onClick={() => queries.channels.refreshList?.()}>
        Refresh channels
      </Button>
      {preferences.error && <p>Saved groups and stars: {preferences.error}</p>}
      {preferences.status !== "unsupported" && (
        <Button
          type="button"
          disabled={preferences.status === "loading"}
          onClick={preferences.reload}
        >
          Refresh groups and stars
        </Button>
      )}
      {current && (
        <Button
          type="button"
          onClick={() => queries.channels.refresh?.(current.id)}
        >
          Refresh messages
        </Button>
      )}
      {queries.outbox ? (
        <OutboxStatus outbox={queries.outbox} profiling={queries.profiling} />
      ) : (
        <RelayTimings profiling={queries.profiling} />
      )}
    </ChannelSettingsPanel>
  );
  const workspace = (
    <div ref={split.ref} style={split.style} className={styles.board}>
      <HuddleWindow
        session={queries}
        channels={channels}
        agentControl={agentControl}
      />
      {current && membersOpen && (
        <ChannelMembersDialog
          key={current.id}
          session={queries}
          channelId={current.id}
          control={agentControl}
          close={() => setMembersOpen(false)}
          trigger={
            membersTrigger.current?.isConnected
              ? membersTrigger
              : membersHeaderTrigger
          }
          canOpenLink={canOpenLink}
          onOpenLink={(url, returnFocus) => openLink(url, false, returnFocus)}
          onOpenConversation={
            navigator && viewer
              ? (id) => openLink(`buzz://channel/${encodeURIComponent(id)}`)
              : undefined
          }
        />
      )}
      {current && !current.readOnly && canvasOpen && (
        <ChannelCanvasDialog
          key={`${scope}:${current.id}`}
          canvas={queries.canvas}
          profiles={queries.profiles}
          scope={scope}
          channelId={current.id}
          open={canvasOpen}
          onOpenChange={(open) => {
            if (!open) setCanvasOrigin(undefined);
          }}
          finalFocus={canvasTrigger}
        />
      )}
      <Panel as="article" aria-label="Conversation">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: file-drop fallback; the composer also provides a keyboard-accessible picker. */}
        <div
          className={`${styles.conversation}${flatSession ? ` ${styles.sessionConversation}` : ""}`}
          data-attachment-drop-zone=""
          onDragOver={rejectUnhandledFileDrop}
          onDrop={rejectUnhandledFileDrop}
        >
          {composingMessage ? (
            <NewMessage
              session={queries}
              scope={scope}
              extensions={extensions}
              onPreparing={(pubkeys) => handoff?.prepareDm(pubkeys)}
              onOpened={(channelId) => {
                handoff?.clearPreparingDm();
                select(channelId);
              }}
              onStarted={(channelId, id) => {
                handoff?.clearPreparingDm();
                setSent({ channelId, id });
                select(channelId);
              }}
            />
          ) : drafting && current ? (
            <NewSessionView parentName={current.name}>
              <NewSessionComposer
                extensions={extensions}
                key={current.id}
                session={queries}
                scope={scope}
                parent={current}
                onStarted={(id) => {
                  handoff?.updateDraftParents((previous) =>
                    previous.filter((parent) => parent !== current.id),
                  );
                  select(id);
                }}
              />
            </NewSessionView>
          ) : draftParent ? (
            <p role="status" className={styles.empty}>
              Checking session parent access…
            </p>
          ) : (
            <>
              {current?.channelType === "session" ? (
                <SessionHeading
                  channel={current}
                  parentName={
                    channels.find(
                      (parent) => parent.id === current.parentChannelId,
                    )?.name
                  }
                />
              ) : (
                <PanelHeader
                  title={
                    <Tabs
                      variant="navigation"
                      label="Channel tabs"
                      showSelection={false}
                      value={current?.id ?? "channels"}
                      onValueChange={() => {}}
                      items={[
                        {
                          value: current?.id ?? "channels",
                          label: current?.name ?? "Channels",
                          icon:
                            current?.channelType === "dm" ? (
                              <ChatCircleIcon size="1rem" />
                            ) : (
                              <CurrentChannelIcon size="1rem" />
                            ),
                        },
                      ]}
                    />
                  }
                  actions={
                    <>
                      {current &&
                        queries.huddle &&
                        !current.readOnly &&
                        !current.archived && (
                          <HuddleButton
                            session={queries}
                            channelId={current.id}
                          />
                        )}
                      {current && (
                        <IconButton
                          size="sm"
                          aria-label="Channel members"
                          title="Channel members"
                          aria-haspopup="dialog"
                          ref={membersHeaderTrigger}
                          aria-expanded={membersOpen}
                          onClick={(event) => openMembers(event.currentTarget)}
                          icon={<UsersIcon size="1rem" aria-hidden="true" />}
                        />
                      )}
                      {drawer.launchers}
                      <ChannelHeaderMenu
                        key={`channel-actions:${currentId ?? "empty"}`}
                        channel={current}
                        session={queries}
                        origin={navigation?.signal}
                        providers={providers}
                        templateProvider={templateProvider}
                        trigger={settingsTrigger}
                        openDetails={() => {
                          drawer.close();
                          requestSettingsFocus((value) => value + 1);
                          setSettings({ channelId: currentId });
                        }}
                        openCanvas={openCanvas}
                      />
                      {current && (
                        <IconButton
                          ref={splitTrigger}
                          data-tab-pane-toggle=""
                          size="toolbar"
                          aria-label="Toggle tab pane"
                          title={
                            showingChannelPanel
                              ? "Close tab pane"
                              : "Open tab pane"
                          }
                          aria-expanded={!!showingChannelPanel}
                          onClick={() => {
                            tabState.setPaneOpen(!showingChannelPanel);
                            if (!showingChannelPanel && !rootTabIds.length)
                              addTab();
                          }}
                          icon={
                            <SidebarRightIcon size="1rem" aria-hidden="true" />
                          }
                        />
                      )}
                    </>
                  }
                />
              )}
              <SessionColumn enabled={flatSession}>
                <MessageManagementStatus />
                {!cached && (
                  <LiveStatus
                    live={queries.live}
                    channelId={current?.id}
                    partialRoster={list.coverage === "partial"}
                  />
                )}
                {flatSession &&
                current &&
                navigation &&
                requestedMessage &&
                exact &&
                !exact.inTimeline ? (
                  <SessionMessageTarget
                    key={`${current.id}:${requestedMessage}`}
                    session={queries}
                    scope={scope}
                    channelId={current.id}
                    messageId={requestedMessage}
                    navigation={navigation}
                    extensions={extensions}
                    onOpenLink={openLink}
                    canOpenLink={canOpenLink}
                    onLatest={() => select(current.id)}
                    onRetry={() => {
                      void navigator?.retry();
                    }}
                  />
                ) : current ? (
                  <ChannelBody
                    viewer={viewer}
                    extensions={extensions}
                    key={current.id}
                    queries={queries}
                    scope={scope}
                    channelId={current.id}
                    cached={cached}
                    navigation={
                      flatSession || !requestedMessage || exact?.inTimeline
                        ? navigation
                        : undefined
                    }
                    onOpenLink={openLink}
                    canOpenLink={canOpenLink}
                    onOpenThread={flatSession ? undefined : openThread}
                    onOpenMediaReview={openMediaReview}
                    revealMessageId={
                      sent?.channelId === current.id ? sent.id : undefined
                    }
                  />
                ) : (
                  <div
                    className={styles.empty}
                    data-buzz-launch-pending={
                      resolving && !navigation?.signal.aborted
                        ? "required"
                        : undefined
                    }
                  >
                    {resolving
                      ? "Checking conversation access…"
                      : "Select a channel to read it."}
                  </div>
                )}
                {current?.readOnly && !current.cached && (
                  <ChannelJoinNotice
                    key={`join:${current.id}`}
                    channelId={current.id}
                    lifecycle={queries.channelLifecycle}
                    joinable={
                      !current.archived &&
                      (current.channelType === "stream" ||
                        current.channelType === "forum")
                    }
                    onJoin={() => setJoiningChannel(current.id)}
                  />
                )}
                {current && (
                  <MessageComposer
                    sessionConversation={current.channelType === "session"}
                    extensions={extensions}
                    key={`composer:${current.id}`}
                    session={queries}
                    scope={scope}
                    channelId={current.id}
                    channelName={current.name}
                    autoFocus={
                      !current.readOnly && !requestedMessage && !requestedThread
                    }
                    onOpenLink={openLink}
                    canOpenLink={canOpenLink}
                    label={
                      current.channelType === "session"
                        ? "Message this session"
                        : undefined
                    }
                    onSend={onComposerSend}
                    focusRequest={composerFocus}
                  />
                )}
              </SessionColumn>
              {drawer.content}
            </>
          )}
        </div>
      </Panel>
      {showingMediaReview && (
        <MediaReviewViewer
          extensions={extensions}
          attachment={showingMediaReview.attachment}
          session={queries}
          scope={scope}
          channelId={showingMediaReview.channelId}
          channelName={showingMediaReview.channelName}
          messageId={showingMediaReview.messageId}
          initialTime={showingMediaReview.initialTime}
          hasComments={showingMediaReview.hasComments}
          restoreFocus={mediaReviewTrigger}
          onOpenLink={openLink}
          close={() => setMediaReview(undefined)}
        />
      )}
      <PanelDock
        open={!!showingPanel && !showingMediaReview}
        keepMounted={!!hasPanel && !tabState.paneOpen}
        className={styles.panelStack}
        resizeHandle={split.handle}
      >
        {hasPanel && !showingMediaReview && (
          <>
            {hasChannelPanel &&
              (settings ||
                showingThread ||
                panelTabs.length > 0 ||
                tabState.tabs.length > 0) && (
                <div
                  className={styles.retainedPanel}
                  hidden={!!companion && !showingChannelPanel}
                >
                  <PanelWorkspace
                    key={currentId}
                    value={selectedTab}
                    focusOnMount={
                      !membersOpen &&
                      (continuingVisit ||
                        (!!requestedMessage &&
                          (thread?.channelId !== currentId ||
                            thread?.messageId !== requestedMessage)))
                    }
                    select={selectPanelTab}
                    add={addTab}
                    items={[
                      ...(settings
                        ? [
                            {
                              id: "settings",
                              label: "Channel settings",
                              icon: <GearIcon size="1rem" />,
                              close: closeSettings,
                              content: settingsContent,
                            },
                          ]
                        : []),
                      ...(showingThread
                        ? [
                            {
                              id: "thread",
                              instance: threadInstance,
                              label: "Thread",
                              icon: (
                                <ChatCircleIcon
                                  size="1rem"
                                  aria-hidden="true"
                                />
                              ),
                              close: () => {
                                afterClose("thread");
                                closeThread();
                              },
                              content: (
                                <ThreadPanel
                                  sessionConversation={
                                    current?.channelType === "session"
                                  }
                                  extensions={extensions}
                                  session={queries}
                                  scope={scope}
                                  channelName={current?.name ?? ""}
                                  channelId={showingThread.channelId}
                                  messageId={showingThread.messageId}
                                  navigation={showingThread.navigation}
                                  active={
                                    !membersOpen &&
                                    tabState.paneOpen &&
                                    selectedTab === "thread"
                                  }
                                  replyRequest={
                                    replyRequest?.channelId ===
                                      showingThread.channelId &&
                                    replyRequest.messageId ===
                                      showingThread.messageId &&
                                    replyRequest.entryId ===
                                      showingThread.navigation?.entryId
                                      ? replyRequest.sequence
                                      : undefined
                                  }
                                  close={() => {
                                    afterClose("thread");
                                    closeThread();
                                  }}
                                  onOpenLink={openThreadLink}
                                  onOpenMediaReview={openMediaReview}
                                  canOpenLink={canOpenLink}
                                />
                              ),
                            },
                          ]
                        : []),
                      ...tabState.tabs.map((tab) => {
                        const target =
                          tab.kind === "new"
                            ? undefined
                            : channels.find(
                                (item) => item.id === tab.channelId,
                              );
                        const usable = target && !target.readOnly;
                        return {
                          id: tab.id,
                          label:
                            tab.kind === "new"
                              ? "New tab"
                              : tab.kind === "thread"
                                ? `Thread · ${target?.name ?? "Unavailable"}`
                                : (target?.name ?? "Unavailable conversation"),
                          icon: target ? (
                            conversationIcon(target)
                          ) : (
                            <BrowserIcon size="1rem" />
                          ),
                          close: () => closeConversationTab(tab.id),
                          content:
                            tab.kind === "new" ? (
                              <ChannelTabPicker
                                channels={tabDestinations}
                                tools={tabTools}
                                chooseTool={(panel) =>
                                  chooseTool(tab.id, panel)
                                }
                                icon={conversationIcon}
                                choose={(channelId) =>
                                  chooseConversation(tab.id, channelId)
                                }
                              />
                            ) : usable ? (
                              <ConversationTab
                                focusOnMount={continuingVisit}
                                active={
                                  tabState.paneOpen && selectedTab === tab.id
                                }
                                tab={tab}
                                channel={target}
                                session={queries}
                                scope={scope}
                                extensions={extensions}
                                openLink={(url) =>
                                  openConversationLink(target.id, url)
                                }
                                canOpenLink={canOpenLink}
                                openThread={(id, root, intent) =>
                                  openConversationThread(
                                    target.id,
                                    id,
                                    root,
                                    intent,
                                  )
                                }
                                close={() => closeConversationTab(tab.id)}
                              />
                            ) : (
                              <p role="status" className={styles.empty}>
                                This conversation is no longer available.
                              </p>
                            ),
                        };
                      }),
                      ...panelTabs.map((entry) => ({
                        id: tabId(entry),
                        instance: entry,
                        label: entry.panel.title,
                        ...(entry.channelContext && {
                          icon: channelToolIcon(entry.panel),
                        }),
                        close: () => closeTab(entry),
                        content: (
                          <PanelCard
                            panel={entry.panel}
                            target={entry.target}
                            context={panelContext(entry)}
                            channelContext={entry.channelContext}
                            close={() => closeTab(entry)}
                          />
                        ),
                      })),
                    ]}
                  />
                </div>
              )}
            {hasChannelPanel && drawer.side && (
              <div
                className={styles.retainedPanel}
                hidden={
                  showingSettings || (!!companion && !showingChannelPanel)
                }
              >
                {drawer.side}
              </div>
            )}
            {companion && (
              <div key="companion" className={styles.companion}>
                {companion}
              </div>
            )}
          </>
        )}
      </PanelDock>
    </div>
  );
  return (
    <MessageManagement session={queries} channelId={currentId}>
      {workspace}
    </MessageManagement>
  );
}

export function mediaReviewForDestination<
  T extends { channelId: string; entryId?: string | undefined },
>(
  review: T | undefined,
  channelId: string | undefined,
  entryId: string | undefined,
): T | undefined {
  return review &&
    review.channelId === channelId &&
    (review.entryId === undefined || review.entryId === entryId)
    ? review
    : undefined;
}

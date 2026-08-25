import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import AttendeeList from "../components/AttendeeList.jsx";
import AddToCalendarButton from "../components/AddToCalendarButton.jsx";
import EventChat from "../components/EventChat.jsx";
import ModalOverlay from "../components/ModalOverlay.jsx";
import PageShell from "../components/PageShell.jsx";
import {
  ConfirmCelebration,
  DeclineCelebration,
} from "../components/RsvpCelebration.jsx";
import ShareInviteModal from "../components/ShareInviteModal.jsx";
import WeatherWidget from "../components/WeatherWidget.jsx";
import EventStops from "../components/EventStops.jsx";
import SignupBoard from "../components/SignupBoard.jsx";
import PhotoGallery from "../components/PhotoGallery.jsx";
import {
  checkInAttendee,
  getEvent,
  pingAttendee,
  registerPushSubscription,
  submitRsvp,
  unlockManageWithPin,
  unregisterPushSubscription,
} from "../lib/api.js";
import { buildAbsoluteUrl, formatDateTime } from "../lib/format.js";
import {
  isReminderSupported,
  subscribeToEventReminders,
  unsubscribeFromEventReminders,
} from "../lib/push.js";
import { subscribeToEventTicks } from "../lib/realtimeTick.js";

// Realtime (subscribeToEventTicks below) is the primary refresh mechanism.
// This is now just a low-frequency safety net for missed/dropped realtime
// events, not the primary refresh path.
const AUTO_REFRESH_MS = 60000;
const IDENTITY_STORAGE_PREFIX = "ruin-event-identity";
const PING_SEEN_STORAGE_PREFIX = "ruin-event-last-seen-ping";
const PING_COOLDOWN_STORAGE_PREFIX = "ruin-event-ping-cooldown";
const PING_COOLDOWN_MS = 10 * 60 * 1000;
const REFRESH_ERROR_TOAST_ID = "event-refresh-error";
const MODAL_CARD_CLASS_NAME =
  "h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6";
const SUMMARY_STATUS_GROUPS = [
  "confirmed",
  "excused",
  "excused_accepted",
  "excused_rejected",
];
const SUMMARY_STATUS_LABELS = {
  confirmed: "✅ Přijdou",
  excused: "⏳ Omluvenky (čeká)",
  excused_accepted: "❌ Omluvenka přijatá",
  excused_rejected: "⚪ Omluvenka zamítnutá",
};

function normalizeName(value) {
  return value.trim().toLocaleLowerCase("cs-CZ");
}

function identityStorageKey(eventId) {
  return `${IDENTITY_STORAGE_PREFIX}:${eventId}`;
}

function pingSeenStorageKey(eventId, attendeeName) {
  return `${PING_SEEN_STORAGE_PREFIX}:${eventId}:${normalizeName(attendeeName)}`;
}

function pingCooldownStorageKey(eventId, targetAttendeeId) {
  return `${PING_COOLDOWN_STORAGE_PREFIX}:${eventId}:${targetAttendeeId}`;
}

function readPingCooldownUntil(eventId, targetAttendeeId) {
  if (typeof window === "undefined") {
    return 0;
  }

  const raw = window.localStorage.getItem(
    pingCooldownStorageKey(eventId, targetAttendeeId),
  );
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function writePingCooldownUntil(eventId, targetAttendeeId, until) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    pingCooldownStorageKey(eventId, targetAttendeeId),
    String(until),
  );
}

function statusLabel(status) {
  if (status === "confirmed") {
    return "Potvrzeno";
  }

  if (status === "excused") {
    return "Omluveno (čeká na posouzení)";
  }

  if (status === "excused_accepted") {
    return "Omluvenka přijatá";
  }

  if (status === "excused_rejected") {
    return "Omluvenka zamítnutá";
  }

  return "Neznámý stav";
}

function attendeeStatusToFormStatus(status) {
  return status === "confirmed" ? "confirmed" : "excused";
}

async function fetchEventPayload(id) {
  return getEvent(id);
}

function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const initialIdentity =
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem(identityStorageKey(id)) || "";
  const [payload, setPayload] = useState(null);
  const [name, setName] = useState(initialIdentity);
  const [phone, setPhone] = useState("");
  const [excuseReason, setExcuseReason] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("confirmed");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionName, setSessionName] = useState(initialIdentity);
  const [isIdentityLocked, setIsIdentityLocked] = useState(
    Boolean(initialIdentity),
  );
  const [pingBusyId, setPingBusyId] = useState(null);
  const [incomingPing, setIncomingPing] = useState(null);
  const [isUnlockingManage, setIsUnlockingManage] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [showPingModal, setShowPingModal] = useState(false);
  const [showPingComposerModal, setShowPingComposerModal] = useState(false);
  const [pingTargetId, setPingTargetId] = useState(null);
  const [pingMessageInput, setPingMessageInput] = useState("");
  const [managePin, setManagePin] = useState("");
  const [error, setError] = useState("");
  const [isEditingResponse, setIsEditingResponse] = useState(false);
  const [showConfirmCelebration, setShowConfirmCelebration] = useState(false);
  const [showDeclineCelebration, setShowDeclineCelebration] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isReminderOn, setIsReminderOn] = useState(false);
  const [isTogglingReminder, setIsTogglingReminder] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [pingCooldownTick, setPingCooldownTick] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => setPingCooldownTick(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    // Invite links are #/event/:id (HashRouter) - navigating from one event's
    // link straight to another's, in the same tab, doesn't remount this
    // component, so identity state seeded from `initialIdentity` at mount
    // time would otherwise keep pointing at the previous event forever.
    const storedIdentity =
      typeof window === "undefined"
        ? ""
        : window.localStorage.getItem(identityStorageKey(id)) || "";

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(storedIdentity);
    setSessionName(storedIdentity);
    setIsIdentityLocked(Boolean(storedIdentity));
  }, [id]);

  const hasLoadedOnceRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const sessionNameRef = useRef(sessionName);
  const isIdentityLockedRef = useRef(isIdentityLocked);

  useEffect(() => {
    sessionNameRef.current = sessionName;
    isIdentityLockedRef.current = isIdentityLocked;
  }, [sessionName, isIdentityLocked]);

  useEffect(() => {
    if (!isReminderSupported() || typeof navigator === "undefined") {
      return;
    }

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setIsReminderOn(Boolean(subscription)))
      .catch(() => {});
  }, []);

  async function toggleReminder() {
    setIsTogglingReminder(true);

    try {
      if (isReminderOn) {
        const endpoint = await unsubscribeFromEventReminders();
        setIsReminderOn(false);

        if (endpoint) {
          try {
            await unregisterPushSubscription(endpoint);
          } catch {
            toast.warning(
              "Připomínku jsme vypnuli jen v tomhle prohlížeči, server o tom neví. Zkus to prosím znovu.",
            );
            return;
          }
        }

        toast.success("Připomínku jsme vypnuli.");
      } else {
        const subscription = await subscribeToEventReminders();
        await registerPushSubscription(id, subscription);
        setIsReminderOn(true);
        toast.success("Připomeneme ti to den i hodinu předem.");
      }
    } catch (reminderError) {
      toast.error(reminderError.message);
    } finally {
      setIsTogglingReminder(false);
    }
  }

  async function handleCheckIn() {
    setIsCheckingIn(true);

    try {
      await checkInAttendee(id, sessionName);
      toast.success("Odbaveno, ať ostatní vidí, že jsi na místě!");
      await loadEvent();
    } catch (checkInError) {
      toast.error(checkInError.message);
    } finally {
      setIsCheckingIn(false);
    }
  }

  const maybeShowIncomingPing = useCallback(
    (nextPayload, forcedSessionName = null) => {
      if (typeof window === "undefined" || !nextPayload) {
        return;
      }

      const activeName =
        forcedSessionName ||
        (isIdentityLockedRef.current ? sessionNameRef.current : "");

      if (!activeName) {
        return;
      }

      const attendee = nextPayload.attendees.find(
        (item) => normalizeName(item.name) === normalizeName(activeName),
      );

      if (!attendee) {
        return;
      }

      const lastPingAt = attendee.ping_last_created_at;
      const lastPingSource = attendee.ping_last_source_name;

      if (!lastPingAt || !lastPingSource) {
        return;
      }

      const key = pingSeenStorageKey(id, activeName);
      const seenPingAt = window.localStorage.getItem(key);

      if (
        seenPingAt &&
        new Date(lastPingAt).getTime() <= new Date(seenPingAt).getTime()
      ) {
        return;
      }

      setIncomingPing({
        sourceName: lastPingSource,
        message: attendee.ping_last_message,
      });
      setShowPingModal(true);
      window.localStorage.setItem(key, lastPingAt);
    },
    [id],
  );

  const loadEvent = useCallback(
    async (forcedSessionName = null) => {
      const requestId = ++latestRequestIdRef.current;

      try {
        const nextPayload = await fetchEventPayload(id);

        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        setPayload(nextPayload);
        hasLoadedOnceRef.current = true;
        maybeShowIncomingPing(nextPayload, forcedSessionName);
        setError("");
      } catch (loadError) {
        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        if (hasLoadedOnceRef.current) {
          toast.error(loadError.message, { id: REFRESH_ERROR_TOAST_ID });
        } else {
          setError(loadError.message);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [id, maybeShowIncomingPing],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrateEvent() {
      const requestId = ++latestRequestIdRef.current;

      try {
        const nextPayload = await fetchEventPayload(id);

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }

        setPayload(nextPayload);
        hasLoadedOnceRef.current = true;
        maybeShowIncomingPing(nextPayload);
        setError("");
      } catch (loadError) {
        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }

        if (hasLoadedOnceRef.current) {
          toast.error(loadError.message, { id: REFRESH_ERROR_TOAST_ID });
        } else {
          setError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    hydrateEvent();

    return () => {
      cancelled = true;
    };
  }, [id, maybeShowIncomingPing]);

  useEffect(() => {
    return subscribeToEventTicks(id, ["event", "attendee", "ping"], loadEvent);
  }, [id, loadEvent]);

  // Low-frequency safety net in case realtime ticks are missed or the
  // realtime connection silently drops; subscribeToEventTicks above is the
  // primary refresh mechanism.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function refreshEvent() {
      if (inFlight || document.visibilityState !== "visible") {
        return;
      }

      inFlight = true;
      const requestId = ++latestRequestIdRef.current;

      try {
        const nextPayload = await fetchEventPayload(id);

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }

        setPayload(nextPayload);
        hasLoadedOnceRef.current = true;
        maybeShowIncomingPing(nextPayload);
        setError("");
      } catch (refreshError) {
        if (!cancelled && requestId === latestRequestIdRef.current) {
          if (hasLoadedOnceRef.current) {
            toast.error(refreshError.message, { id: REFRESH_ERROR_TOAST_ID });
          } else {
            setError(refreshError.message);
          }
        }
      } finally {
        inFlight = false;
      }
    }

    const intervalId = setInterval(refreshEvent, AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [id, maybeShowIncomingPing]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await submitRsvp(id, {
        name,
        status: selectedStatus,
        excuseReason,
        phone: phone.trim() || null,
      });

      const normalizedName = name.trim();
      window.localStorage.setItem(identityStorageKey(id), normalizedName);
      setSessionName(normalizedName);
      setName(normalizedName);
      setIsIdentityLocked(true);
      setIsEditingResponse(false);
      setExcuseReason("");
      setPhone("");

      if (selectedStatus === "confirmed") {
        setShowConfirmCelebration(true);
        setTimeout(() => setShowConfirmCelebration(false), 4500);
      } else {
        setShowDeclineCelebration(true);
        setTimeout(() => setShowDeclineCelebration(false), 3500);
      }

      await loadEvent(normalizedName);
    } catch (submitError) {
      toast.error(submitError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function getPingCooldownRemainingMs(targetAttendeeId) {
    return Math.max(0, readPingCooldownUntil(id, targetAttendeeId) - pingCooldownTick);
  }

  function handlePing(attendeeId) {
    setPingTargetId(attendeeId);
    setPingMessageInput("");
    setShowPingComposerModal(true);
  }

  function closePingComposerModal() {
    if (pingBusyId !== null) {
      return;
    }

    setShowPingComposerModal(false);
    setPingTargetId(null);
    setPingMessageInput("");
  }

  async function handleSubmitPing(event) {
    event.preventDefault();

    if (pingTargetId === null) {
      return;
    }

    setPingBusyId(pingTargetId);

    try {
      await pingAttendee(
        id,
        pingTargetId,
        sessionName || name,
        pingMessageInput,
      );
      writePingCooldownUntil(id, pingTargetId, Date.now() + PING_COOLDOWN_MS);
      toast.success("Šťouchnutí odeslané.");
      setShowPingComposerModal(false);
      setPingTargetId(null);
      setPingMessageInput("");
      await loadEvent();
    } catch (pingError) {
      if (pingError.message.includes("10 minut")) {
        writePingCooldownUntil(id, pingTargetId, Date.now() + PING_COOLDOWN_MS);
      }

      toast.error(pingError.message);
    } finally {
      setPingBusyId(null);
    }
  }

  function handleResetIdentity() {
    if (typeof window !== "undefined" && sessionName) {
      window.localStorage.removeItem(identityStorageKey(id));
      window.localStorage.removeItem(pingSeenStorageKey(id, sessionName));
    }

    setIsIdentityLocked(false);
    setSessionName("");
    setName("");
    setSelectedStatus("confirmed");
    setExcuseReason("");
    setPhone("");
    setIsEditingResponse(false);
  }

  function closePingModal() {
    setShowPingModal(false);
    setIncomingPing(null);
  }

  function openManageModal() {
    setManagePin("");
    setShowManageModal(true);
  }

  function closeManageModal() {
    if (isUnlockingManage) {
      return;
    }

    setShowManageModal(false);
    setManagePin("");
  }

  async function handleUnlockManage(event) {
    event.preventDefault();
    setIsUnlockingManage(true);

    try {
      const response = await unlockManageWithPin(id, managePin);
      toast.success("Správa odemčená.");
      setShowManageModal(false);
      setManagePin("");
      navigate(response.organizerPath);
    } catch (unlockError) {
      toast.error(unlockError.message);
    } finally {
      setIsUnlockingManage(false);
    }
  }

  const sessionAttendee =
    isIdentityLocked && payload
      ? payload.attendees.find(
          (attendee) =>
            normalizeName(attendee.name) === normalizeName(sessionName),
        )
      : null;

  useEffect(() => {
    if (!sessionAttendee || isEditingResponse) {
      return;
    }

    // This effect exists specifically to reset the local draft fields from the
    // server record when it changes (and only when not mid-edit) - there's no
    // way to do that from render, since these fields must stay mutable for the
    // user to type into afterward.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedStatus(attendeeStatusToFormStatus(sessionAttendee.status));
    setExcuseReason(sessionAttendee.excuse_reason || "");
    setPhone(sessionAttendee.phone || "");
    // isEditingResponse is deliberately excluded: it must not retrigger this effect
    // (that would resync from a stale sessionAttendee mid-submit), only gate a run
    // that already fired because sessionAttendee changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAttendee]);

  function handleCancelEdit() {
    if (sessionAttendee) {
      setSelectedStatus(attendeeStatusToFormStatus(sessionAttendee.status));
      setExcuseReason(sessionAttendee.excuse_reason || "");
      setPhone(sessionAttendee.phone || "");
    }

    setIsEditingResponse(false);
  }

  if (isLoading) {
    return (
      <PageShell
        eyebrow="Veřejná pozvánka"
        title="Načítám akci…"
        subtitle="Chvilka, lovím data z databáze."
      />
    );
  }

  if (error || !payload) {
    return (
      <PageShell
        eyebrow="Veřejná pozvánka"
        title="Akci se nepodařilo najít"
        subtitle={error || "Tenhle odkaz už nic nevrací."}
      />
    );
  }

  const { event, attendees, summary } = payload;

  return (
    <PageShell
      eyebrow="live invite page"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      mergeNextPanel
      actions={
        <WeatherWidget
          location={event.location}
          datetime={event.datetime}
          compact
        />
      }>
      <main className="grid gap-6">
        <section className="panel order-0 rounded-t-none border-t-0 flex flex-wrap items-center gap-2 sm:gap-3">
          <AddToCalendarButton eventData={event} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowOverviewModal(true)}>
            Přehled
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-bold text-white shadow-[0_10px_28px_-6px_rgba(111,76,255,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-6px_rgba(111,76,255,0.8)]"
            style={{ background: 'linear-gradient(135deg, #7a1c3f, #6f4cff)' }}
            onClick={() => setShowShareModal(true)}>
            📨 Pozvánka
          </button>
          <button
            type="button"
            className="secondary-button border-transparent bg-transparent shadow-none hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={openManageModal}>
            Spravovat akci
          </button>
        </section>

        <section className="panel relative order-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(122,28,63,0.14),rgba(111,76,255,0.1))] dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.26),rgba(111,76,255,0.16))]" />
          <div className="relative">
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.25em]">
              Poznámka k akci
            </p>
            <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-700 dark:text-slate-300">
              {event.description}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="stat-tile">
                <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
                  Dorazí
                </div>
                <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                  {summary.confirmed}
                </div>
              </div>
              <div className="stat-tile">
                <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
                  Omluvenky
                </div>
                <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                  {summary.excused}
                </div>
              </div>
              <div className="stat-tile">
                <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
                  Zamítnuto
                </div>
                <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                  {summary.rejected}
                </div>
              </div>
            </div>
          </div>
        </section>

        {showConfirmCelebration ? (
          <div className="order-2 lg:order-2">
            <ConfirmCelebration name={sessionName} />
          </div>
        ) : showDeclineCelebration ? (
          <div className="order-2 lg:order-2">
            <DeclineCelebration name={sessionName} />
          </div>
        ) : (
          <section className="panel order-2 lg:order-2">
            {!isIdentityLocked || isEditingResponse ? (
              <>
                <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
                  {isIdentityLocked ? "Změnit účast" : "Odpověz organizátorovi"}
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">
                  {isIdentityLocked
                    ? "Uprav svoji odpověď"
                    : "Přijdeš, nebo ghostíš?"}
                </h2>
                {isIdentityLocked && sessionAttendee ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Aktuálně máš stav: {statusLabel(sessionAttendee.status)}. Po
                    odeslání se tvoje účast přepíše.
                  </p>
                ) : null}
                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                  <div>
                    <label
                      htmlFor="attendee-name"
                      className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Tvoje jméno
                    </label>
                    <input
                      id="attendee-name"
                      className="field"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Třeba Viki"
                      required
                      disabled={isIdentityLocked}
                    />
                  </div>

                  {event.requirePhone ? (
                    <div>
                      <label
                        htmlFor="attendee-phone"
                        className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Telefonní číslo
                      </label>
                      <input
                        id="attendee-phone"
                        type="tel"
                        className="field"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+420 123 456 789"
                        required
                      />
                    </div>
                  ) : null}

                  <div
                    className="grid gap-3 sm:grid-cols-2"
                    role="radiogroup"
                    aria-label="Stav účasti">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedStatus === "confirmed"}
                      className={`rounded-[1.75rem] border px-4 py-4 text-left transition ${selectedStatus === "confirmed" ? "border-fuchsia-300 bg-[linear-gradient(135deg,rgba(122,28,63,0.12),rgba(111,76,255,0.08))] text-slate-950 dark:border-fuchsia-500/60 dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.32),rgba(111,76,255,0.28))] dark:text-slate-50" : "border-slate-200 bg-white/60 text-slate-700 hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"}`}
                      onClick={() => setSelectedStatus("confirmed")}>
                      <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-100">
                        Potvrzuji účast
                      </span>
                      <span className="mt-2 block text-sm text-slate-500 dark:text-slate-200">
                        Jdeš a chceš být v line-upu potvrzených.
                      </span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedStatus === "excused"}
                      className={`rounded-[1.75rem] border px-4 py-4 text-left transition ${selectedStatus === "excused" ? "border-fuchsia-300 bg-[linear-gradient(135deg,rgba(122,28,63,0.12),rgba(111,76,255,0.08))] text-slate-950 dark:border-fuchsia-500/60 dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.32),rgba(111,76,255,0.28))] dark:text-slate-50" : "border-slate-200 bg-white/60 text-slate-700 hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"}`}
                      onClick={() => setSelectedStatus("excused")}>
                      <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-100">
                        Omlouvám se
                      </span>
                      <span className="mt-2 block text-sm text-slate-500 dark:text-slate-200">
                        Můžeš přihodit důvod, pokud chceš znít důvěryhodně.
                      </span>
                    </button>
                  </div>

                  {selectedStatus === "excused" ? (
                    <div>
                      <label
                        htmlFor="excuse-reason"
                        className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Důvod omluvy
                      </label>
                      <textarea
                        id="excuse-reason"
                        className="field min-h-28"
                        value={excuseReason}
                        onChange={(event) =>
                          setExcuseReason(event.target.value)
                        }
                        placeholder="Nepovinné, ale často zábavné."
                      />
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    className="primary-button w-full"
                    disabled={isSubmitting}>
                    {isSubmitting
                      ? "Odesílám odpověď…"
                      : selectedStatus === "confirmed"
                        ? isIdentityLocked
                          ? "Uložit novou účast"
                          : "Potvrzuji účast"
                        : isIdentityLocked
                          ? "Poslat novou omluvenku"
                          : "Poslat omluvenku"}
                  </button>

                  {isIdentityLocked ? (
                    <button
                      type="button"
                      className="secondary-button w-full justify-center"
                      onClick={handleCancelEdit}>
                      Zpět
                    </button>
                  ) : null}
                </form>
              </>
            ) : (
              <>
                <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
                  Jsi přihlášený
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">
                  {sessionName}
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Docházka je navázaná na tvoje jméno v této session.
                  {sessionAttendee
                    ? ` Aktuální stav: ${statusLabel(sessionAttendee.status)}.`
                    : " Načítám tvůj aktuální stav…"}
                </p>
                {sessionAttendee?.status === "excused_rejected" ? (
                  <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                    Organizátor omluvenku zamítl. Můžeš odpověď upravit a poslat
                    ji znovu.
                  </div>
                ) : null}
                {sessionAttendee?.status === "confirmed" ? (
                  <button
                    type="button"
                    className="primary-button mt-5 w-full justify-center"
                    onClick={handleCheckIn}
                    disabled={isCheckingIn || Boolean(sessionAttendee?.checked_in_at)}>
                    {sessionAttendee?.checked_in_at
                      ? "📍 Odbaveno, dorazil/a jsi"
                      : isCheckingIn
                        ? "Odbavuju…"
                        : "📍 Dorazil/a jsem"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-button mt-5 w-full justify-center"
                  onClick={() => setIsEditingResponse(true)}>
                  Změnit účast
                </button>
                {isReminderSupported() ? (
                  <button
                    type="button"
                    className="secondary-button mt-3 w-full"
                    onClick={toggleReminder}
                    disabled={isTogglingReminder}>
                    {isTogglingReminder
                      ? "Chvilku…"
                      : isReminderOn
                        ? "🔔 Připomínka zapnutá (klikni pro vypnutí)"
                        : "🔔 Připomenout den a hodinu předem"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary-button mt-3 w-full"
                  onClick={handleResetIdentity}>
                  Nejsem to já
                </button>
              </>
            )}
          </section>
        )}

        <div className="order-3 lg:order-3">
          <AttendeeList
            attendees={attendees}
            summary={summary}
            showPing
            onPing={handlePing}
            pingBusyId={pingBusyId}
            canPing={Boolean(name.trim())}
            currentName={sessionName || name}
            getPingCooldownRemainingMs={getPingCooldownRemainingMs}
          />
        </div>

        {event.enableStops ? (
          <div className="order-4 lg:order-4">
            <EventStops eventId={id} />
          </div>
        ) : null}

        {event.enableBringList ? (
          <div className="order-5 lg:order-5">
            <SignupBoard eventId={id} category="bring" currentName={sessionName} canInteract={isIdentityLocked} />
          </div>
        ) : null}

        {event.enableCarpool ? (
          <div className="order-6 lg:order-6">
            <SignupBoard eventId={id} category="ride" currentName={sessionName} canInteract={isIdentityLocked} />
          </div>
        ) : null}

        <div className="order-7 lg:order-7">
          <PhotoGallery eventId={id} currentName={sessionName} />
        </div>

        <div className="order-8 lg:order-8">
          <EventChat
            eventId={id}
            currentName={sessionName}
            canSend={isIdentityLocked && Boolean(sessionName.trim())}
          />
        </div>

        <ModalOverlay
          open={showManageModal}
          onClose={closeManageModal}
          labelledBy="manage-modal-title">
          <div className={MODAL_CARD_CLASS_NAME}>
            <div className="mb-5">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">
                Správa akce
              </p>
              <h3
                id="manage-modal-title"
                className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
                Zadej PIN
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Pro vstup do správy akce zadej 4místný správcovský PIN.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleUnlockManage}>
              <div>
                <label
                  htmlFor="manage-pin"
                  className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Správcovský PIN
                </label>
                <input
                  id="manage-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  className="field"
                  value={managePin}
                  onChange={(event) => setManagePin(event.target.value)}
                  placeholder="1234"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  className="secondary-button flex-1 justify-center"
                  disabled={isUnlockingManage}
                  onClick={closeManageModal}>
                  Zrušit
                </button>
                <button
                  type="submit"
                  className="primary-button flex-1"
                  disabled={isUnlockingManage}>
                  {isUnlockingManage ? "Ověřuji…" : "Vstoupit"}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ModalOverlay
          open={showPingModal && Boolean(incomingPing)}
          onClose={closePingModal}
          labelledBy="incoming-ping-title">
          {incomingPing ? (
            <div className={MODAL_CARD_CLASS_NAME}>
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">
                Někdo tě šťouchl
              </p>
              <h3
                id="incoming-ping-title"
                className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
                {incomingPing.sourceName}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {incomingPing.message
                  ? `Vzkaz: ${incomingPing.message}`
                  : "Poslal ti šťouchnutí bez zprávy."}
              </p>
              <button
                type="button"
                className="primary-button mt-6 w-full"
                onClick={closePingModal}>
                Rozumím
              </button>
            </div>
          ) : null}
        </ModalOverlay>

        <ModalOverlay
          open={showPingComposerModal}
          onClose={closePingComposerModal}
          labelledBy="ping-composer-title">
          <div className={MODAL_CARD_CLASS_NAME}>
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">
              Šťouchnout účastníka
            </p>
            <h3
              id="ping-composer-title"
              className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
              Přidej zprávu
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Nepovinné. Když nic nenapíšeš, odešle se jen šťouchnutí.
            </p>

            <form className="mt-4 space-y-4" onSubmit={handleSubmitPing}>
              <div>
                <label
                  htmlFor="ping-message"
                  className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Zpráva
                </label>
                <textarea
                  id="ping-message"
                  className="field min-h-24"
                  value={pingMessageInput}
                  onChange={(event) =>
                    setPingMessageInput(event.target.value.slice(0, 280))
                  }
                  placeholder="Hej, pojď s náma!"
                  disabled={pingBusyId !== null}
                  autoFocus
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Zbývá {280 - pingMessageInput.length} znaků
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  className="secondary-button flex-1 justify-center"
                  disabled={pingBusyId !== null}
                  onClick={closePingComposerModal}>
                  Zrušit
                </button>
                <button
                  type="submit"
                  className="primary-button flex-1"
                  disabled={pingBusyId !== null}>
                  {pingBusyId !== null ? "Šťouchám…" : "Odeslat"}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ShareInviteModal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          inviteUrl={buildAbsoluteUrl(`/event/${id}`)}
          eventId={id}
          eventName={event.name}
          datetime={event.datetime}
        />

        <ModalOverlay
          open={showOverviewModal}
          onClose={() => setShowOverviewModal(false)}
          labelledBy="overview-modal-title">
          <div className={`${MODAL_CARD_CLASS_NAME} sm:max-w-lg`}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">
                  Přehled
                </p>
                <h3
                  id="overview-modal-title"
                  className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
                  {event.name}
                </h3>
              </div>
              <button
                type="button"
                className="secondary-button shrink-0"
                onClick={() => setShowOverviewModal(false)}>
                Zavřít
              </button>
            </div>

            <div className="space-y-5 max-h-[60vh] overflow-y-auto">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Poznámka akce
                </p>
                <p className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                  {event.description || "Bez poznámky."}
                </p>
              </div>
              {SUMMARY_STATUS_GROUPS.map((statusGroup) => {
                const group = attendees.filter((a) => a.status === statusGroup);
                if (group.length === 0) return null;

                return (
                  <div key={statusGroup}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      {SUMMARY_STATUS_LABELS[statusGroup]} ({group.length})
                    </p>
                    <ul className="space-y-2">
                      {group.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {a.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </ModalOverlay>
      </main>
    </PageShell>
  );
}

export default EventPage;

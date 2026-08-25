import { useEffect } from "react";
import { toast } from "sonner";
import { buildAbsoluteUrl } from "../lib/format.js";

const MOBILE_BROWSER_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
const IN_APP_BROWSER_RE = /Instagram|FBAN|FBAV|TikTok|Line|Slack|WhatsApp|Messenger/i;
const WEBVIEW_RE = /WebView|wv\)|Version\//i;
const APPLE_DEVICE_RE = /iPhone|iPad|iPod/i;
const EVENT_TIME_ZONE = "Europe/Prague";
const NAIVE_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const ICS_LINE_LENGTH_LIMIT = 75;
const ICS_LINE_FOLD_LENGTH = 74;
const CALENDAR_AUTO_OPEN_DELAY_MS = 150;
const CALENDAR_DESCRIPTION_TEXT = "Tady to najdeš:";
const CALENDAR_LINK_TEXT = "Odkaz na akci:";
const CALENDAR_ERROR_MESSAGE = "Nepodařilo se vytvořit kalendářovou pozvánku.";
const CALENDAR_SUCCESS_MESSAGE =
  "Kalendář stažen. Upozornění je nastavené na 2 dny předem.";
const CALENDAR_OPEN_IN_EXTERNAL_BROWSER_MESSAGE =
  "Otevírá se externí prohlížeč pro přidání události do kalendáře.";

function pad(value) {
  return String(value).padStart(2, "0");
}

function toUtcIcsDateTime(input) {
  const date = new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid event datetime");
  }

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

const icsTextEncoder = new TextEncoder();

// RFC 5545 requires content lines to be folded at 75 octets, with each
// continuation line prefixed by a single space. Iterating by Unicode code
// point (not raw string index) keeps multi-byte characters (accents, emoji)
// intact instead of splitting them across a fold boundary.
function foldIcsLine(line) {
  if (icsTextEncoder.encode(line).length <= ICS_LINE_LENGTH_LIMIT) {
    return line;
  }

  const segments = [];
  let current = "";
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = icsTextEncoder.encode(char).length;
    const limit =
      segments.length === 0 ? ICS_LINE_LENGTH_LIMIT : ICS_LINE_FOLD_LENGTH;

    if (currentBytes + charBytes > limit) {
      segments.push(current);
      current = "";
      currentBytes = 0;
    }

    current += char;
    currentBytes += charBytes;
  }

  segments.push(current);

  return segments.join("\r\n ");
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getTimeZoneOffsetMinutes(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMillis));

  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const asIfUtcMillis = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );

  return (asIfUtcMillis - utcMillis) / 60000;
}

// eventData.datetime has no timezone offset (Postgres "timestamp without
// time zone") and is, by app-wide convention, wall-clock time in Europe/
// Prague - not the viewer's device timezone. Resolve it to the correct UTC
// instant using the IANA zone's real offset (which also covers DST) instead
// of letting `new Date()` assume the browser's local timezone.
function eventStartToUtcDate(input) {
  const match = String(input).match(NAIVE_DATETIME_PATTERN);

  if (!match) {
    return new Date(input);
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const naiveUtcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(
    naiveUtcMillis,
    EVENT_TIME_ZONE,
  );

  return new Date(naiveUtcMillis - offsetMinutes * 60000);
}

function slugify(value) {
  return String(value || "udalost")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getCalendarFileName(eventData) {
  return `${slugify(eventData.name) || "udalost"}.ics`;
}

function openCalendarUrl(url) {
  const calendarWindow = window.open(url, "_blank", "noopener,noreferrer");

  if (!calendarWindow) {
    window.location.href = url;
  }
}

function showCalendarDownloadSuccess() {
  toast.success(CALENDAR_SUCCESS_MESSAGE);
}

function showCalendarError() {
  toast.error(CALENDAR_ERROR_MESSAGE);
}

function downloadIcs(content, fileName) {
  const isMobileBrowser =
    MOBILE_BROWSER_RE.test(navigator.userAgent) ||
    window.matchMedia("(pointer: coarse)").matches;

  if (isMobileBrowser) {
    // Mobile browsers often block download links or blob URLs, but they do
    // intercept a direct data:text/calendar navigation and open the native
    // calendar sheet to add the event.
    window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
    return;
  }

  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Safari can read the blob: URL asynchronously after click() returns, so
  // revoking it immediately can produce an empty/truncated download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Google Calendar's "render" endpoint is a plain https URL that opens a
// prefilled "add event" form on calendar.google.com - unlike the .ics/
// data:-URI flow below, it works from inside restricted in-app browsers
// (Instagram, Messenger, TikTok, ...) since those only block downloads and
// non-http(s) navigation, not ordinary link clicks.
function buildEventUrl(eventData) {
  if (!eventData?.id) {
    return "";
  }

  return buildAbsoluteUrl(`/event/${eventData.id}`);
}

function buildGoogleCalendarUrl(eventData) {
  const startDate = eventStartToUtcDate(eventData.datetime);
  const endDate = addHours(startDate, 3);
  const eventUrl = buildEventUrl(eventData);
  const details = [
    eventData.description || "",
    eventUrl ? `${CALENDAR_LINK_TEXT} ${eventUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventData.name || "",
    dates: `${toUtcIcsDateTime(startDate)}/${toUtcIcsDateTime(endDate)}`,
    details,
    location: eventData.location || "",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildIcs(eventData) {
  const nowUtc = toUtcIcsDateTime(new Date());
  const startDate = eventStartToUtcDate(eventData.datetime);
  const startUtc = toUtcIcsDateTime(startDate);
  const endUtc = toUtcIcsDateTime(addHours(startDate, 3));
  const name = eventData.name || "";
  const summary = escapeIcsText(name);
  const location = escapeIcsText(eventData.location);
  const eventUrl = buildEventUrl(eventData);
  const description = escapeIcsText(
    [
      eventData.description || "",
      eventUrl ? `${CALENDAR_DESCRIPTION_TEXT} ${eventUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  const reminderText = escapeIcsText(`Připomínka: ${name}`);
  const uid = `${eventData.id ?? Date.now()}@ruin.app`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//R U in?//Event Calendar//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${reminderText}`,
    "TRIGGER:-P2D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldIcsLine)
    .join("\r\n");
}

function isInAppBrowser() {
  const userAgent = navigator.userAgent || "";
  const isInApp = IN_APP_BROWSER_RE.test(userAgent);
  const hasWebViewMarker = WEBVIEW_RE.test(userAgent);
  const isStandaloneIOS =
    APPLE_DEVICE_RE.test(userAgent) &&
    "standalone" in window.navigator &&
    window.navigator.standalone;

  return isInApp || hasWebViewMarker || isStandaloneIOS;
}

function isAppleDevice() {
  return APPLE_DEVICE_RE.test(navigator.userAgent);
}

function AddToCalendarButton({ eventData }) {
  const eventId = eventData?.id ?? "";
  const eventDateTime = eventData?.datetime;

  useEffect(() => {
    if (!eventDateTime) {
      return undefined;
    }

    const params = new URLSearchParams(window.location.search);
    const shouldAutoOpen =
      params.get("calendarAutoOpen") === "1" &&
      params.get("calendarEventId") === eventId;

    if (!shouldAutoOpen) {
      return undefined;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("calendarAutoOpen");
    url.searchParams.delete("calendarEventId");
    window.history.replaceState({}, "", url);

    const timer = window.setTimeout(() => {
      try {
        const googleCalendarUrl = buildGoogleCalendarUrl(eventData);
        const calendarWindow = window.open(
          googleCalendarUrl,
          "_blank",
          "noopener,noreferrer",
        );

        if (!calendarWindow) {
          window.location.href = googleCalendarUrl;
        }
      } catch {
        try {
          const calendarContent = buildIcs(eventData);
          const fileName = getCalendarFileName(eventData);
          downloadIcs(calendarContent, fileName);
        } catch {
          showCalendarError();
        }
      }
    }, CALENDAR_AUTO_OPEN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [eventData, eventId, eventDateTime]);

  if (!eventData?.datetime) {
    return null;
  }

  function handleInAppBrowserCalendarClick() {
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("calendarAutoOpen", "1");
    targetUrl.searchParams.set("calendarEventId", eventData.id ?? "");

    toast.info(CALENDAR_OPEN_IN_EXTERNAL_BROWSER_MESSAGE);
    openCalendarUrl(targetUrl.toString());
  }

  function handleNormalBrowserCalendarClick() {
    if (isAppleDevice()) {
      try {
        const calendarContent = buildIcs(eventData);
        const fileName = getCalendarFileName(eventData);
        downloadIcs(calendarContent, fileName);
        showCalendarDownloadSuccess();
      } catch {
        showCalendarError();
      }
      return;
    }

    try {
      const googleCalendarUrl = buildGoogleCalendarUrl(eventData);
      openCalendarUrl(googleCalendarUrl);
      return;
    } catch {
      // Fall through to ICS export below.
    }

    try {
      const calendarContent = buildIcs(eventData);
      const fileName = getCalendarFileName(eventData);

      downloadIcs(calendarContent, fileName);
      showCalendarDownloadSuccess();
    } catch {
      showCalendarError();
    }
  }

  function handleCalendarClick() {
    if (isInAppBrowser()) {
      handleInAppBrowserCalendarClick();
      return;
    }

    handleNormalBrowserCalendarClick();
  }

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={handleCalendarClick}>
      Přidat do kalendáře
    </button>
  );
}

export default AddToCalendarButton;

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildAbsoluteUrl } from "../lib/format.js";

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
  if (icsTextEncoder.encode(line).length <= 75) {
    return line;
  }

  const segments = [];
  let current = "";
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = icsTextEncoder.encode(char).length;
    const limit = segments.length === 0 ? 75 : 74;

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

const EVENT_TIME_ZONE = "Europe/Prague";
const NAIVE_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

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

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function downloadIcs(content, fileName) {
  if (isIosDevice()) {
    // iOS Safari doesn't honor a forced <a download> on a blob: URL - it
    // just silently saves the file (a "download complete" banner, nothing
    // added) instead of showing its native "Add Event" sheet. Navigating
    // directly to a text/calendar data: URI, with no download attribute,
    // makes Safari intercept it and show that native sheet instead.
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
    eventUrl ? `Odkaz na akci: ${eventUrl}` : "",
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
    [eventData.description || "", eventUrl ? `Tady to najdeš: ${eventUrl}` : ""]
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

function AddToCalendarButton({ eventData }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    function handleOutsideInteraction(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideInteraction);
    document.addEventListener("touchstart", handleOutsideInteraction);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleOutsideInteraction);
      document.removeEventListener("touchstart", handleOutsideInteraction);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  if (!eventData?.datetime) {
    return null;
  }

  let googleCalendarUrl = null;

  try {
    googleCalendarUrl = buildGoogleCalendarUrl(eventData);
  } catch {
    // leave googleCalendarUrl as null - the .ics download below still works
  }

  function handleDownloadIcs() {
    try {
      const calendarContent = buildIcs(eventData);
      const fileName = `${slugify(eventData.name) || "udalost"}.ics`;

      downloadIcs(calendarContent, fileName);
      toast.success(
        "Kalendář stažen. Upozornění je nastavené na 2 dny předem.",
      );
    } catch {
      toast.error("Nepodařilo se vytvořit kalendářovou pozvánku.");
    } finally {
      setIsMenuOpen(false);
    }
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        className="secondary-button"
        onClick={() => setIsMenuOpen((current) => !current)}>
        Přidat do kalendáře
      </button>

      {isMenuOpen && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {googleCalendarUrl && (
            <a
              href={googleCalendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => setIsMenuOpen(false)}>
              Google Calendar
            </a>
          )}
          <button
            type="button"
            className="block w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={handleDownloadIcs}>
            Systémový kalendář (.ics)
          </button>
        </div>
      )}
    </div>
  );
}

export default AddToCalendarButton;

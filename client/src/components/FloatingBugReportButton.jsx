import { useState } from "react";
import { toast } from "sonner";
import ModalOverlay from "./ModalOverlay.jsx";
import { submitFeedback } from "../lib/api.js";
import { useI18n } from "../lib/i18n.js";

function FloatingBugReportButton() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState("bug");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Keys under feedback.bug / feedback.idea, matching the report type.
  const copy = (field) => t(`feedback.${type}.${field}`);

  function close() {
    if (isSubmitting) {
      return;
    }

    setIsOpen(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim() || !message.trim()) {
      toast.error(t("feedback.fillNameAndText"));
      return;
    }

    setIsSubmitting(true);

    try {
      await submitFeedback(type, name, message);
      toast.success(t("feedback.thanks"));
      setMessage("");
      setIsOpen(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={t("feedback.fabLabel")}
        title={t("feedback.fabTitle")}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg transition hover:-translate-y-0.5"
        style={{
          background: "linear-gradient(135deg, #6f4cff, #f472b6)",
          color: "#ffffff",
        }}>
        💬
      </button>

      <ModalOverlay open={isOpen} onClose={close} labelledBy="feedback-title">
        <div className="w-full max-w-sm rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{copy("eyebrow")}</p>
          <h3
            id="feedback-title"
            className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
            {copy("title")}
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{copy("intro")}</p>

          <div className="mt-4 flex gap-2" role="group" aria-label={t("feedback.typeGroup")}>
            <button
              type="button"
              onClick={() => setType("bug")}
              aria-pressed={type === "bug"}
              className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-medium transition ${
                type === "bug"
                  ? "border-transparent bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
              }`}>
              {t("feedback.types.bug")}
            </button>
            <button
              type="button"
              onClick={() => setType("idea")}
              aria-pressed={type === "idea"}
              className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-medium transition ${
                type === "idea"
                  ? "border-transparent bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
              }`}>
              {t("feedback.types.idea")}
            </button>
          </div>

          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="feedback-name"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("common.name")}
              </label>
              <input
                id="feedback-name"
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 100))}
                placeholder={t("common.namePlaceholder")}
                required
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="feedback-message"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {copy("messageLabel")}
              </label>
              <textarea
                id="feedback-message"
                className="field min-h-32"
                value={message}
                onChange={(event) =>
                  setMessage(event.target.value.slice(0, 2000))
                }
                placeholder={copy("messagePlaceholder")}
                required
              />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t("common.charactersLeft", { count: 2000 - message.length })}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                className="secondary-button flex-1 justify-center"
                onClick={close}
                disabled={isSubmitting}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="primary-button flex-1"
                disabled={isSubmitting}>
                {isSubmitting ? t("common.sending") : t("common.send")}
              </button>
            </div>
          </form>
        </div>
      </ModalOverlay>
    </>
  );
}

export default FloatingBugReportButton;

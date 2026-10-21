// A Live call seen from elsewhere in the app: the green phone badge on the
// bot's sidebar row, a pill at the bottom of the sidebar while this window's
// call runs in a chat that is not on screen, and the same as a chip in the
// chat header for windows too narrow to show the sidebar. The call bar
// itself (LiveCallBar) lives in the call's own chat.
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { hangUpLiveCall, isLiveCallRunning, liveCallChord, setLiveMuted, useLiveMedia, type LiveMediaState } from "@/lib/live-call-media";
import { useStore } from "@/state/store";
import type { LiveCallState } from "../../shared/wire";

/** Pure: whether a bot's row shows the green phone badge — this window is
 * calling it, or the harness reports a call on it (a phone, another window). */
export function liveBadgeFor(botId: string, media: LiveMediaState, server: LiveCallState | null): boolean {
  if (media.botId === botId && isLiveCallRunning(media.phase)) return true;
  return Boolean(server && server.status !== "ended" && server.botId === botId);
}

/** This window's call, when it runs in a chat that is not on screen. The
 * bot's `threadId` is the thread its chat shows, so another thread of the
 * same bot counts as elsewhere too. */
function useCallElsewhere(currentBotId: string | null) {
  const { state } = useStore();
  const media = useLiveMedia();
  const active = isLiveCallRunning(media.phase);
  const bot = active ? state.bots.find((candidate) => candidate.id === media.botId) : undefined;
  const onScreen = Boolean(bot && bot.id === currentBotId && bot.threadId === media.threadId);
  return { media, bot: onScreen ? undefined : bot, threadId: media.threadId };
}

/** Bottom of the sidebar while this window is on a Live call with another chat open. */
export function LiveCallPill({ onOpen, currentBotId, iconOnly = false }: {
  /** open the call's chat (its bot and thread) */
  onOpen: (botId: string, threadId: string) => void;
  currentBotId: string | null;
  /** the icons-only sidebar: a column of round buttons instead of a line */
  iconOnly?: boolean;
}) {
  const { media, bot, threadId } = useCallElsewhere(currentBotId);
  if (!bot || !threadId) return null;
  const title = t("call.live.pill", { name: bot.name });
  const ending = media.phase === "ending";
  const round = "flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const isMac = isMacPlatform();
  const muteLabel = media.muted ? t("call.live.unmute") : t("call.live.mute");
  const muteChord = liveCallChord("mute", isMac);
  const hangUpChord = liveCallChord("hangUp", isMac);
  const mute = (
    <button
      type="button"
      aria-label={muteLabel}
      aria-pressed={media.muted}
      aria-keyshortcuts={muteChord.aria}
      title={`${muteLabel} (${muteChord.text})`}
      onClick={() => setLiveMuted(!media.muted)}
      className={cn(round, media.muted ? "bg-warning/10 text-warning" : "bg-raised text-ink hover:bg-raised-hover", iconOnly && "flex-col")}
    >
      {media.muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
      <span>{muteLabel}</span>
    </button>
  );
  const hangUp = (
    <button
      type="button"
      disabled={ending}
      aria-label={t("call.live.hangUp")}
      aria-keyshortcuts={hangUpChord.aria}
      title={`${t("call.live.hangUp")} (${hangUpChord.text})`}
      onClick={() => void hangUpLiveCall()}
      className={cn(round, "bg-danger text-white hover:brightness-110 disabled:opacity-60")}
    >
      <PhoneOff className="size-3.5" />
    </button>
  );
  if (iconOnly) {
    return (
      <div className="mx-2 mb-2 flex flex-col items-center gap-1 rounded-xl border border-success/40 bg-panel py-1.5">
        <button
          type="button"
          aria-label={title}
          title={t("call.live.back")}
          onClick={() => onOpen(bot.id, threadId)}
          className={cn(round, "relative text-success hover:bg-raised")}
        >
          <Phone className="size-4" />
          <span className="absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
        </button>
        {mute}
        {hangUp}
      </div>
    );
  }
  return (
    <div className="mx-2 mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-success/40 bg-panel px-2 py-1.5 text-[12.5px] text-ink">
      <button type="button" onClick={() => onOpen(bot.id, threadId)} title={t("call.live.back")} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" aria-hidden />
        <span className="truncate">{title}</span>
      </button>
      {mute}
      {hangUp}
      <span role="status" className={cn("w-full text-xs", media.muted ? "text-warning" : "text-ink-secondary")}>{media.muted ? t("call.live.microphoneMuted") : t("call.live.microphoneOn")}</span>
    </div>
  );
}

/** The same, for windows too narrow to show the sidebar: a chip in the chat header. */
export function LiveCallChip({ currentBotId, onOpen }: { currentBotId: string; onOpen: (botId: string, threadId: string) => void }) {
  const { media, bot, threadId } = useCallElsewhere(currentBotId);
  if (!bot || !threadId) return null;
  return (
    <div className="flex max-w-full flex-wrap items-center gap-1 md:hidden">
    <button
      type="button"
      onClick={() => onOpen(bot.id, threadId)}
      title={t("call.live.pill", { name: bot.name })}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-success/40 px-2.5 py-1 text-[12px] text-ink hover:bg-raised md:hidden"
    >
      <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
      {t("call.live.back")}
    </button>
    <button type="button" aria-label={media.muted ? t("call.live.unmute") : t("call.live.mute")} aria-pressed={media.muted}
      className={cn("min-h-10 rounded-full border border-hairline px-3 text-xs focus-visible:outline-2 focus-visible:outline-accent", media.muted ? "bg-warning/10 text-warning" : "bg-raised text-ink")}
      onClick={() => setLiveMuted(!media.muted)}>{media.muted ? t("call.live.unmute") : t("call.live.mute")}</button>
    <button type="button" aria-label={t("call.live.hangUp")} disabled={media.phase === "ending"}
      className="min-h-10 rounded-full bg-danger px-3 text-xs text-white focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => void hangUpLiveCall()}>{t("call.live.hangUp")}</button>
    <span role="status" className="w-full text-xs">{media.muted ? t("call.live.microphoneMuted") : t("call.live.microphoneOn")}</span>
    </div>
  );
}

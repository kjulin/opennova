import { startTelegram } from "./channels/telegram.js";

export interface ChannelInfo {
  name: string;
  detail: string;
}

export interface LoadChannelsResult {
  channels: ChannelInfo[];
  shutdown: () => void;
}

export function loadChannels(): LoadChannelsResult {
  const channels: ChannelInfo[] = [];

  const telegram = startTelegram();
  if (telegram) channels.push({ name: "Telegram", detail: "polling" });

  return {
    channels,
    shutdown() {
      telegram?.shutdown();
    },
  };
}

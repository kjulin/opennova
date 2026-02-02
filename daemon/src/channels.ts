import { startTelegram } from "./channels/telegram.js";
import { startApi } from "./channels/api.js";

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

  const api = startApi();
  if (api) channels.push({ name: "HTTP API", detail: `port ${api.port}` });

  return {
    channels,
    shutdown() {
      telegram?.shutdown();
      api?.shutdown();
    },
  };
}

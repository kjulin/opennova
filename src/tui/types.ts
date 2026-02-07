export interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
}

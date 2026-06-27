export interface Task {
  id: string;
  title: string;
  deadline: string; // ISO datetime string
  estimatedHours: number;
  importance: "low" | "medium" | "high";
  status: "pending" | "completed";
  createdAt: string; // ISO datetime string
  aiPriorityScore?: number; // 1 to 10
  aiPriorityExplanation?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  riskExplanation?: string;
}

export interface ScheduleItem {
  id: string;
  taskId: string;
  taskTitle: string;
  startTime: string; // e.g. "09:00"
  endTime: string; // e.g. "11:00"
  durationMinutes: number;
  notes: string;
  date: string; // YYYY-MM-DD
}

export interface ChatMessage {
  id: string;
  sender: "user" | "coach";
  text: string;
  createdAt: string; // ISO datetime string
}

type Event = { id: number; event_type: string; message?: string; metadata?: Record<string, any>; created_at?: string };
export function organizeTasks(events: Event[]) {
  let currentId = "original";
  const tasks = new Map<string, { id: string; title: string; threadId: string; updatedAt: string; messages: { role: string; text: string }[] }>();
  const eventTasks = new Map<number, string>();
  for (const event of events) {
    if (event.metadata?.conversationStart) currentId = String(event.metadata.taskId || `conversation-${event.id}`);
    eventTasks.set(event.id, currentId);
    let task = tasks.get(currentId);
    if (!task) { task = { id: currentId, title: "", threadId: "", updatedAt: "", messages: [] }; tasks.set(currentId, task); }
    if (event.metadata?.taskThreadId) task.threadId = String(event.metadata.taskThreadId);
    if (event.created_at) task.updatedAt = event.created_at;
    if (event.event_type === "user_message" && event.message) {
      task.title ||= event.message.replace(/\s+/g, " ").trim().slice(0, 80);
      task.messages.push({ role: "You", text: event.message });
    } else if (event.event_type === "agent_message" && event.message && event.metadata?.conversationVersion === 2) {
      task.messages.push({ role: "Codex", text: event.message });
    }
  }
  return { currentId, eventTasks, tasks: [...tasks.values()].filter(task => task.messages.length).reverse() };
}

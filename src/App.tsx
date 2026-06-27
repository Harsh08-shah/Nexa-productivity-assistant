import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ClipboardCheck, Calendar, LayoutDashboard, Sparkles, Moon, Sun, 
  Plus, Loader2, Database, AlertCircle, RefreshCw
} from "lucide-react";
import { collection, getDocs, Firestore } from "firebase/firestore";
import { initFirebase, handleFirestoreError, OperationType } from "./firebase";
import { Task, ScheduleItem, ChatMessage } from "./types";

// Component imports
import Dashboard from "./components/Dashboard";
import DailySchedule from "./components/DailySchedule";
import CoachChatbot from "./components/CoachChatbot";
import AddTaskForm from "./components/AddTaskForm";

export default function App() {
  const [db, setDb] = useState<Firestore | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusPreference, setFocusPreference] = useState<string>("");
  
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isAddingTask, setIsAddingTask] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Safe localStorage helper to prevent sandbox iframe DOMExceptions
  const safeLocalStorage = {
    getItem: (key: string): string | null => {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.warn("Storage access denied:", e);
        return null;
      }
    },
    setItem: (key: string, value: string): void => {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.warn("Storage access denied:", e);
      }
    }
  };

  // Dark/Light theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = safeLocalStorage.getItem("nexa-theme");
      if (saved) {
        return saved === "dark";
      }
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

  // Handle document class for tailwind styling
  useEffect(() => {
    try {
      if (isDarkMode) {
        document.documentElement.classList.add("dark");
        safeLocalStorage.setItem("nexa-theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        safeLocalStorage.setItem("nexa-theme", "light");
      }
    } catch (e) {
      console.warn("Failed to apply theme or update storage:", e);
    }
  }, [isDarkMode]);

  // Auto-selection of active task when list changes or loads
  useEffect(() => {
    const pendingTasks = tasks.filter(t => t.status === "pending");
    if (pendingTasks.length > 0) {
      if (!selectedTask) {
        // Automatically select the first pending task if none is selected
        setSelectedTask(pendingTasks[0]);
      } else {
        // Check if selected task is still in the pending tasks list
        const stillPending = pendingTasks.find(t => t.id === selectedTask.id);
        if (!stillPending) {
          setSelectedTask(pendingTasks[0]);
        } else {
          // Sync changes from main tasks state to selectedTask state
          setSelectedTask(stillPending);
        }
      }
    } else {
      setSelectedTask(null);
    }
  }, [tasks]);

  // Initialize Firebase and fetch records
  useEffect(() => {
    async function setupAndFetch() {
      try {
        setIsLoading(true);
        setErrorMsg("");
        
        // 1. Initialize client-side Firestore
        const firestoreInstance = await initFirebase();
        setDb(firestoreInstance);

        // 2. Fetch Initial Collections
        await loadAllCollections(firestoreInstance);
      } catch (err: any) {
        console.error("Setup failed:", err);
        setErrorMsg("Failed to connect to Nexa Cloud. Check server status or Secrets.");
      } finally {
        setIsLoading(false);
      }
    }
    setupAndFetch();
  }, []);

  const loadAllCollections = async (firestoreInstance: Firestore) => {
    setIsSyncing(true);
    try {
      // Pull tasks
      let tasksSnap;
      try {
        tasksSnap = await getDocs(collection(firestoreInstance, "tasks"));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "tasks");
        throw err;
      }
      const tasksList: Task[] = [];
      tasksSnap.forEach((doc) => {
        tasksList.push({ id: doc.id, ...doc.data() } as Task);
      });
      // Sort tasks: pending first, then sort pending by deadline urgency, and completed by createdAt
      tasksList.sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "pending" ? -1 : 1;
        }
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
      setTasks(tasksList);

      // Pull schedule items - we do not automatically load generated schedules on mount/refresh
      setSchedule([]);

      // Chat messages are kept in-memory only and start fresh on app load/reload
      setMessages([]);

    } catch (err: any) {
      console.error("Failed to load collection snapshot:", err);
      // Keep error readable for users if we throw
      setErrorMsg(err.message || "Failed to load database records");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTaskAdded = (newTask: Task) => {
    setTasks((prev) => {
      const updated = [newTask, ...prev];
      updated.sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
      return updated;
    });
    setSelectedTask(newTask);
  };

  const handleTaskUpdated = (updatedTask: Task) => {
    setTasks((prev) => {
      const filtered = prev.map((t) => (t.id === updatedTask.id ? updatedTask : t));
      filtered.sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
      return filtered;
    });
  };

  const handleTaskDeleted = (deletedId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== deletedId));
  };

  const handleScheduleGenerated = (newBlocks: ScheduleItem[]) => {
    setSchedule(newBlocks);
  };

  const handleScheduleCleared = () => {
    setSchedule([]);
  };

  const handleMessageAdded = (newMsg: ChatMessage) => {
    setMessages((prev) => [...prev, newMsg]);
  };

  const handleHistoryCleared = () => {
    setMessages([]);
  };

  const handleForceSync = async () => {
    if (db) {
      await loadAllCollections(db);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6 transition-colors duration-200">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center text-center space-y-4 max-w-sm"
        >
          <div className="relative">
            <div className="p-4 bg-blue-600/10 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
              <ClipboardCheck className="w-10 h-10 animate-bounce" />
            </div>
            <div className="absolute -right-1.5 -bottom-1.5 p-1 bg-white dark:bg-zinc-900 rounded-full border border-zinc-200/80 dark:border-zinc-800/80 text-teal-500 shadow-sm">
              <Database className="w-4 h-4 animate-spin" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">Booting Nexa Co-Processor</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed font-medium">
              Synthesizing cloud databases, pulling your task records, and configuring Gemini analysis engines...
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-100/60 dark:bg-zinc-900 px-3 py-1 rounded-full font-bold">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping" />
            <span>Connecting to Secure Firestore</span>
          </div>
        </motion.div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6 transition-colors duration-200">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-rose-100 dark:border-rose-950/30 p-8 text-center max-w-md shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h1 className="text-lg font-black text-zinc-900 dark:text-zinc-50">Synapse Connection Denied</h1>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2.5 leading-relaxed font-medium">
            {errorMsg}
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              Re-attempt Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-200 flex flex-col font-sans relative overflow-hidden">
      
      {/* Background radial soft ambient glows for premium Bento depth */}
      <div className="absolute top-24 left-1/4 w-96 h-96 bg-blue-500/5 dark:bg-blue-600/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-indigo-500/5 dark:bg-indigo-600/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Dynamic Header */}
      <header className="sticky top-0 z-40 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-extrabold text-lg tracking-tighter shadow-md shadow-blue-500/20">
            N
          </div>
          <div>
            <h1 className="text-base font-extrabold text-zinc-900 dark:text-white tracking-tight leading-none flex items-center gap-1.5">
              <span>Nexa</span>
              <span className="text-[9px] font-bold tracking-widest uppercase bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">AI</span>
            </h1>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mt-1">Plan Better. Finish Earlier.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-all cursor-pointer shadow-sm"
            aria-label="Toggle Theme"
          >
            {isDarkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-600" />}
          </button>
        </div>
      </header>

      {/* Main Layout containing Navigation Sidebar & Workspace Tab Panel */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 relative z-10">
        
        {/* Navigation Sidebar Drawer */}
        <aside className="md:col-span-3 lg:col-span-2 space-y-1.5">
          {[
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            { id: "schedule", label: "Schedule Engine", icon: Calendar },
            { id: "coach", label: "Coach Chatbot", icon: ClipboardCheck },
          ].map((tab) => {
            const IconComponent = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 p-3 rounded-2xl text-xs font-bold tracking-wide transition-all cursor-pointer border ${
                  isActive
                    ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/15"
                    : "bg-white dark:bg-zinc-900/50 border-zinc-200/60 dark:border-zinc-800/40 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/80 dark:hover:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <IconComponent className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Tab workspace Panel */}
        <main className="md:col-span-9 lg:col-span-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {activeTab === "dashboard" && db && (
                <Dashboard 
                  db={db}
                  tasks={tasks}
                  onTaskUpdated={handleTaskUpdated}
                  onTaskDeleted={handleTaskDeleted}
                  onAddTaskClick={() => setIsAddingTask(true)}
                  onActiveTabChange={setActiveTab}
                  selectedTask={selectedTask}
                  setSelectedTask={setSelectedTask}
                />
              )}

              {activeTab === "schedule" && db && (
                <DailySchedule 
                  db={db}
                  tasks={tasks}
                  schedule={schedule}
                  onScheduleGenerated={handleScheduleGenerated}
                  onScheduleCleared={handleScheduleCleared}
                  focusPreference={focusPreference}
                  setFocusPreference={setFocusPreference}
                />
              )}

              {activeTab === "coach" && db && (
                <CoachChatbot 
                  db={db}
                  tasks={tasks}
                  messages={messages}
                  onMessageAdded={handleMessageAdded}
                  onHistoryCleared={handleHistoryCleared}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Overlay AddTask Modal Form */}
      <AnimatePresence>
        {isAddingTask && db && (
          <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <AddTaskForm 
              db={db}
              onTaskAdded={handleTaskAdded}
              onClose={() => setIsAddingTask(false)}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Humble credit info in footer */}
      <footer className="py-4 border-t border-zinc-200/60 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 mt-auto text-center z-20">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium tracking-wide">
          Nexa AI Productivity Suite • Powered by Google Gemini & Secure Firestore Cloud
        </p>
      </footer>

    </div>
  );
}

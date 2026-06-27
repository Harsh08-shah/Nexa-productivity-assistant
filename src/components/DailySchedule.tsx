import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Calendar, Sparkles, Loader2, Clock, Check, AlertTriangle, 
  Trash2, Sliders, ChevronRight, BookOpen, Coffee 
} from "lucide-react";
import { collection, doc, writeBatch, deleteDoc, getDocs, query, where, setDoc } from "firebase/firestore";
import { Firestore } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../firebase";
import { Task, ScheduleItem } from "../types";

interface DailyScheduleProps {
  db: Firestore;
  tasks: Task[];
  schedule: ScheduleItem[];
  onScheduleGenerated: (items: ScheduleItem[]) => void;
  onScheduleCleared: () => void;
  focusPreference: string;
  setFocusPreference: (pref: string) => void;
}

export default function DailySchedule({
  db,
  tasks,
  schedule,
  onScheduleGenerated,
  onScheduleCleared,
  focusPreference,
  setFocusPreference,
}: DailyScheduleProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"create" | "clear" | "update" | null>(null);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD
  });

  const handleGenerateSchedule = async (prefToUse?: any) => {
    const selectedPref = typeof prefToUse === "string" ? prefToUse : focusPreference;
    const pendingTasks = tasks.filter(t => t.status === "pending");
    if (pendingTasks.length === 0) {
      alert("You don't have any pending tasks to schedule! Add some tasks first.");
      return;
    }

    const isRegen = schedule.length > 0;
    setLoadingAction(isRegen ? "update" : "create");
    setIsLoading(true);

    try {
      const currentLocalTime = new Date().toISOString();

      // 1. Call server API to generate schedule
      const res = await fetch("/api/schedule/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: pendingTasks,
          currentLocalTime,
          scheduleDate,
          focusPreference: selectedPref,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to generate schedule from Gemini");
      }

      const generatedBlocks = await res.json();

      // 2. Clear existing schedule in Firestore (since we are rewriting for this date)
      let querySnapshot;
      try {
        querySnapshot = await getDocs(collection(db, "schedule"));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "schedule");
        throw err;
      }
      if (!querySnapshot.empty) {
        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, "schedule/batch");
          throw err;
        }
      }

      // 3. Write new schedule blocks to Firestore
      const newItems: ScheduleItem[] = [];
      const savePromises = generatedBlocks.map(async (block: any) => {
        const tempId = Math.random().toString(36).substring(2, 15);
        const item: ScheduleItem = {
          id: tempId,
          taskId: block.taskId,
          taskTitle: block.taskTitle,
          startTime: block.startTime,
          endTime: block.endTime,
          durationMinutes: block.durationMinutes,
          notes: block.notes,
          date: scheduleDate,
        };
        newItems.push(item);
        
        // Save to Firestore
        try {
          await setDoc(doc(db, "schedule", tempId), item);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `schedule/${tempId}`);
          throw err;
        }
      });

      await Promise.all(savePromises);

      // Sort items by start time
      newItems.sort((a, b) => a.startTime.localeCompare(b.startTime));

      onScheduleGenerated(newItems);
    } catch (error: any) {
      console.error("Error generating schedule:", error);
      alert("Failed to generate schedule: " + error.message);
    } finally {
      setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const handleClearSchedule = async () => {
    setLoadingAction("clear");
    setIsLoading(true);
    try {
      let querySnapshot;
      try {
        querySnapshot = await getDocs(collection(db, "schedule"));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "schedule");
        throw err;
      }
      if (!querySnapshot.empty) {
        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, "schedule/batch");
          throw err;
        }
      }
      onScheduleCleared();
    } catch (error) {
      console.error("Error clearing schedule:", error);
    } finally {
      setIsLoading(false);
      setLoadingAction(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Configuration column (left) */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm p-6 space-y-6 self-start relative overflow-hidden">
        <div className="flex items-center gap-2 pb-4 border-b border-zinc-150 dark:border-zinc-800/60">
          <Sliders className="w-4.5 h-4.5 text-blue-500" />
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">Schedule Engine</h2>
        </div>

        {/* Date Selector */}
        <div>
          <label className="block text-[10px] font-extrabold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-2">
            Target Date
          </label>
          <div className="relative">
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              disabled={isLoading}
              className="w-full pl-9 pr-3.5 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs font-bold"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500 dark:text-blue-400">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Focus Style Preset Selector */}
        <div>
          <label className="block text-[10px] font-extrabold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-2">
            Pacing & Focus Preference
          </label>
          <div className="space-y-2">
            {[
              { id: "balanced focus with breaks", name: "Balanced Shift", desc: "45m study + 10m breathing buffer" },
              { id: "deep high-productivity blocks", name: "Deep Work (90m)", desc: "Long hyper-focused sprints" },
              { id: "pomodoro style sprint intervals", name: "Pomodoro (25m)", desc: "Short bursts with frequent breaks" },
              { id: "night owl afternoon heavy work", name: "Night Owl Shift", desc: "Evening focus from 6:00 PM" },
            ].map((pref) => (
              <button
                key={pref.id}
                type="button"
                onClick={() => {
                  setFocusPreference(pref.id);
                  if (schedule.length > 0) {
                    handleGenerateSchedule(pref.id);
                  }
                }}
                disabled={isLoading}
                className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col ${
                  focusPreference === pref.id
                    ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm"
                    : "border-zinc-100 hover:border-zinc-200 dark:border-zinc-800/60 dark:hover:border-zinc-700 bg-transparent"
                }`}
              >
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{pref.name}</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-medium">{pref.desc}</span>
              </button>
            ))}
          </div>
          {!focusPreference && (
            <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-3 font-semibold flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Choose your preferred work style to build a personalized schedule.
            </p>
          )}
        </div>

        {/* Generate triggers */}
        <div className="pt-2">
          {schedule.length > 0 ? (
            <button
              onClick={handleClearSchedule}
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-600 dark:text-rose-400 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isLoading && loadingAction === "clear" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Clearing your schedule...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Daily Schedule</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => handleGenerateSchedule()}
              disabled={isLoading || !focusPreference}
              className={`w-full py-3 font-bold text-xs rounded-2xl flex items-center justify-center gap-1.5 shadow-lg transition-all ${
                isLoading || !focusPreference
                  ? "bg-zinc-100 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 cursor-not-allowed shadow-none"
                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/10 hover:shadow-blue-500/25 cursor-pointer hover:scale-[1.02]"
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {loadingAction === "clear"
                      ? "Clearing your schedule..."
                      : loadingAction === "update"
                      ? "Updating your schedule..."
                      : "Creating your daily plan..."}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                  <span>Create Daily Plan</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Schedule Timeline Column (right) */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm p-6 relative overflow-hidden">
          {/* Subtle decoration */}
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-600/5 blur-[100px] rounded-full pointer-events-none" />
          
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                Hourly Planner
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Target date: <span className="font-bold text-blue-600 dark:text-blue-400">{scheduleDate}</span>
              </p>
            </div>
            <div className="px-3 py-1 bg-zinc-50 dark:bg-zinc-950 rounded-full border border-zinc-200/60 dark:border-zinc-800/60 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping" />
              <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 tracking-wider">Smart Schedule</span>
            </div>
          </div>

          {/* Timeline listing */}
          <div className={`relative ${schedule.length > 0 && !isLoading ? "border-l border-zinc-200/60 dark:border-zinc-800/60 pl-6" : ""} space-y-6 py-2`}>
            {isLoading ? (
              <div className="py-8 flex items-center justify-center w-full">
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-6 rounded-2xl shadow-md max-w-sm w-full text-center flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                  <h3 className="text-sm font-extrabold text-zinc-800 dark:text-zinc-200">
                    {loadingAction === "clear"
                      ? "Clearing your schedule..."
                      : loadingAction === "update"
                      ? "Updating your schedule..."
                      : "Creating your daily plan..."}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs text-center leading-relaxed">
                    {loadingAction === "clear"
                      ? "Removing all generated focus slots from your calendar."
                      : loadingAction === "update"
                      ? "Applying your new pacing mode preferences to restructure your daily focus blocks and breaks."
                      : "Analyzing your tasks, deadlines, and workload to organize your day."}
                  </p>
                </div>
              </div>
            ) : schedule.length === 0 ? (
              !focusPreference ? (
                <div className="py-12 text-center text-zinc-400 dark:text-zinc-500">
                  <Sliders className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm font-semibold">No schedule preference selected yet.</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-1 max-w-sm mx-auto leading-relaxed">
                    Select a work style above to generate your personalized study plan.
                  </p>
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-400 dark:text-zinc-500">
                  <Calendar className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm font-semibold">No schedule generated for this date yet.</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-600 mt-1 max-w-sm mx-auto leading-relaxed">
                    Click the **Create Daily Plan** button on the left panel to craft a highly optimized study/work calendar based on task deadlines.
                  </p>
                </div>
              )
            ) : (
              schedule.map((item, idx) => {
                const isBreak = item.taskId === "break" || item.taskTitle.toLowerCase().includes("break") || item.taskTitle.toLowerCase().includes("rest");

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="relative group"
                  >
                    {/* Time indicator circle on border */}
                    <div className={`absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full border-2 bg-white dark:bg-zinc-900 transition-all ${
                      isBreak 
                        ? "border-teal-400 dark:border-teal-600" 
                        : "border-blue-500 dark:border-blue-400 group-hover:scale-125"
                    }`} />

                    <div className={`p-4 rounded-2xl border transition-all ${
                      isBreak 
                        ? "bg-teal-50/25 border-teal-100/50 dark:bg-teal-950/10 dark:border-teal-900/40" 
                        : "bg-white border-zinc-200/60 hover:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-800/80 dark:hover:border-zinc-700/80 hover:shadow-sm"
                    }`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-xl ${
                            isBreak 
                              ? "bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400" 
                              : "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
                          }`}>
                            {isBreak ? <Coffee className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                              {item.taskTitle}
                            </h4>
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 font-medium">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{item.startTime} - {item.endTime} ({item.durationMinutes} mins)</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {item.notes && (
                        <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/60">
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
                            <span className="font-extrabold text-blue-600 dark:text-blue-400 text-[10px] uppercase tracking-wider mr-1.5 block sm:inline">Recommendation:</span>
                            {item.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

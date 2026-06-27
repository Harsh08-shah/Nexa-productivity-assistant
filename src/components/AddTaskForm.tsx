import React, { useState } from "react";
import { motion } from "motion/react";
import { Plus, Sparkles, Loader2, Calendar, Clock, AlertTriangle } from "lucide-react";
import { collection, addDoc, doc, setDoc } from "firebase/firestore";
import { Firestore } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../firebase";
import { Task } from "../types";
import DatePicker from "./DatePicker";

interface AddTaskFormProps {
  db: Firestore;
  onTaskAdded: (task: Task) => void;
  onClose: () => void;
}

export default function AddTaskForm({ db, onTaskAdded, onClose }: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estimatedHours, setEstimatedHours] = useState<number | "">("");
  const [importance, setImportance] = useState<"low" | "medium" | "high">("medium");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [formValidationError, setFormValidationError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormValidationError("");

    if (!title || !deadline || estimatedHours === "" || estimatedHours < 1 || estimatedHours > 24) {
      alert("Please fill in all fields correctly. Estimated working hours must be a whole number between 1 and 24.");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dlDate = new Date(deadline);
    dlDate.setHours(0, 0, 0, 0);
    if (dlDate < today) {
      setFormValidationError("Please select today or a future date.");
      return;
    }

    setIsLoading(true);
    setStatusMsg("Analyzing with Gemini AI...");

    try {
      // 1. Get current local time to pass to backend
      const currentLocalTime = new Date().toISOString();

      // 2. Call server-side Gemini API for Priority and Risk analysis
      const analysisResponse = await fetch("/api/tasks/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          deadline: new Date(deadline).toISOString(),
          estimatedHours: Number(estimatedHours),
          importance,
          currentLocalTime,
        }),
      });

      if (!analysisResponse.ok) {
        throw new Error("Gemini analysis failed");
      }

      const analysis = await analysisResponse.json();

      setStatusMsg("Saving to secure Firestore database...");

      // 3. Create task document in Firestore
      const tasksCollection = collection(db, "tasks");
      const tempId = Math.random().toString(36).substring(2, 15);
      
      const newTask: Task = {
        id: tempId,
        title,
        deadline: new Date(deadline).toISOString(),
        estimatedHours: Number(estimatedHours),
        importance,
        status: "pending",
        createdAt: new Date().toISOString(),
        aiPriorityScore: analysis.aiPriorityScore,
        aiPriorityExplanation: analysis.aiPriorityExplanation,
        riskLevel: analysis.riskLevel,
        riskExplanation: analysis.riskExplanation,
      };

      // Add to Firestore (let Firestore generate doc or use setDoc with tempId)
      // To have consistent client IDs and Firebase document IDs, let's write to Firestore with doc id:
      const docRef = doc(db, "tasks", tempId);
      try {
        await setDoc(docRef, newTask);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "tasks");
        throw err;
      }

      onTaskAdded(newTask);
      onClose();
    } catch (error: any) {
      console.error("Error creating task:", error);
      alert("Failed to analyze or save task: " + error.message);
    } finally {
      setIsLoading(false);
      setStatusMsg("");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white dark:bg-zinc-900 rounded-3xl shadow-xl border border-zinc-200/60 dark:border-zinc-800/80 p-6 max-w-lg w-full relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600" />

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/50 rounded-xl text-blue-600 dark:text-blue-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <h2 className="text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
            Analyze & Add Task
          </h2>
        </div>
        <button
          onClick={onClose}
          disabled={isLoading}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer text-sm font-bold"
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
            Task Name / Title
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Finish Term Paper or Launch Marketing Campaign"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isLoading}
            className="w-full px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-xs font-bold"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-zinc-400" /> Deadline
            </label>
            <DatePicker
              value={deadline}
              onChange={(val) => {
                setDeadline(val);
                setFormValidationError("");
              }}
              disabled={isLoading}
            />
            {formValidationError && (
              <p className="mt-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {formValidationError}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-zinc-400" /> Est. Working Hours
            </label>
            <div className="relative flex items-center">
              <input
                type="number"
                required
                min="1"
                max="24"
                step="1"
                placeholder="e.g. 4"
                value={estimatedHours}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setEstimatedHours("");
                    return;
                  }
                  const num = parseInt(val, 10);
                  if (isNaN(num)) return;
                  const clamped = Math.max(1, Math.min(24, num));
                  setEstimatedHours(clamped);
                }}
                disabled={isLoading}
                className="w-full pl-4 pr-16 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-xs font-bold"
              />
              <span className="absolute right-4 text-xs font-extrabold text-zinc-400 dark:text-zinc-500 select-none">
                hours
              </span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
            Priority Level
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setImportance(level)}
                disabled={isLoading}
                className={`py-2.5 px-3 rounded-2xl text-xs font-bold capitalize border transition-all cursor-pointer ${
                  importance === level
                    ? level === "high"
                      ? "bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400"
                      : level === "medium"
                      ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400"
                      : "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-400"
                    : "bg-zinc-50 border-zinc-150 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-950/50 rounded-2xl p-4 border border-zinc-200/60 dark:border-zinc-800/80 flex items-start gap-2.5">
          <div className="p-1.5 bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400 rounded-xl mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
              Task Preview
            </h4>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed font-medium">
              Nexa will review your timeline, workload, and priority level to estimate effort, identify potential risks, and help you stay ahead of deadlines.
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-blue-500/10 cursor-pointer disabled:opacity-80"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs truncate">{statusMsg}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Analyze & Save</span>
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}

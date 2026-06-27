import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  CheckCircle, Clock, AlertTriangle, Play, Sparkles, 
  Trash2, FileText, BarChart2, ShieldAlert, BadgeAlert, 
  Check, Undo, Calendar, Hourglass
} from "lucide-react";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { Firestore } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../firebase";
import { Task } from "../types";

interface DashboardProps {
  db: Firestore;
  tasks: Task[];
  onTaskUpdated: (updatedTask: Task) => void;
  onTaskDeleted: (id: string) => void;
  onAddTaskClick: () => void;
  onActiveTabChange: (tab: string) => void;
  selectedTask: Task | null;
  setSelectedTask: (task: Task | null) => void;
}

export default function Dashboard({ 
  db, 
  tasks, 
  onTaskUpdated, 
  onTaskDeleted, 
  onAddTaskClick,
  onActiveTabChange,
  selectedTask,
  setSelectedTask
}: DashboardProps) {
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  // Clean fallback text and technical output from AI responses
  const cleanExplanation = (text?: string, task?: Task | null) => {
    if (!text) return "";
    let cleaned = text.replace(/\[Operating in resilient fallback mode\]/gi, "").trim();
    
    // Check for "calculated score of" or similar robotic phrasing
    if (cleaned.toLowerCase().includes("calculated score of")) {
      return "This task has been carefully prioritized based on your upcoming deadline and workload requirements. Dedicating high-quality, early attention to it will guarantee strong momentum and a stress-free completion.";
    }

    // Check for "plenty of time remaining" or "pace yourself comfortably" or other robotic/generic statements
    if (
      cleaned.toLowerCase().includes("plenty of time remaining") || 
      cleaned.toLowerCase().includes("pace yourself comfortably") || 
      cleaned.toLowerCase().includes("plenty of lead time")
    ) {
      const workload = task?.estimatedHours || 2;
      return `You have a healthy runway ahead for this project. To maintain a steady, sustainable flow, I recommend dedicating ${workload > 1 ? '1 to 2 hours' : 'about an hour'} today. Pace your work with focused 45-minute focus intervals and brief active breaks. Your clear next action is to take just 10 minutes to review the details and write down a single, simple next step.`;
    }

    return cleaned;
  };

  // Helper calculations for risk analytics panel
  const getSelectedTaskMetrics = (task: Task | null) => {
    if (!task) return null;
    const dl = new Date(task.deadline);
    const now = new Date();
    const remainingMs = dl.getTime() - now.getTime();
    
    const remainingHours = Math.max(0, remainingMs / (1000 * 60 * 60));
    const remainingDays = Math.max(0, remainingHours / 24);
    
    const suggestedDailyHours = task.status === "completed" 
      ? 0 
      : remainingDays > 0 
        ? Math.min(24, task.estimatedHours / remainingDays) 
        : task.estimatedHours;

    const daysNeeded = Math.ceil(task.estimatedHours / 2); // assuming 2h/day study pace
    const startDate = new Date(dl.getTime() - daysNeeded * 24 * 60 * 60 * 1000);
    
    let recommendedStartDateText = "";
    if (task.status === "completed") {
      recommendedStartDateText = "Completed";
    } else if (startDate <= now) {
      recommendedStartDateText = "Immediately";
    } else {
      recommendedStartDateText = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const getConfidence = (estHours: number, remHours: number, status: string, riskLevel: string) => {
      if (status === "completed") return 100;
      if (remHours <= 0) return 0;
      const ratio = estHours / remHours;
      let baseConf = 100 - (ratio * 75);
      if (riskLevel === "critical") baseConf = Math.min(baseConf, 40);
      if (riskLevel === "high") baseConf = Math.min(baseConf, 65);
      if (riskLevel === "medium") baseConf = Math.min(baseConf, 85);
      return Math.max(5, Math.min(99, Math.round(baseConf)));
    };

    const confidence = getConfidence(task.estimatedHours, remainingHours, task.status, task.riskLevel || "low");

    return {
      remainingHours: remainingHours.toFixed(1),
      remainingDays: remainingDays.toFixed(1),
      suggestedDailyHours: suggestedDailyHours.toFixed(1),
      recommendedStartDateText,
      confidence
    };
  };

  const metrics = getSelectedTaskMetrics(selectedTask);

  // Filter lists
  const pendingTasks = tasks.filter(t => t.status === "pending");
  const completedTasks = tasks.filter(t => t.status === "completed");

  // Calculate statistics
  const totalTasks = tasks.length;
  const completedCount = completedTasks.length;
  const pendingCount = pendingTasks.length;
  
  // Risk metrics
  const criticalCount = pendingTasks.filter(t => t.riskLevel === "critical" || t.riskLevel === "high").length;
  const totalEstimatedHours = pendingTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);

  // Status/Risk level counts
  const riskDistribution = {
    critical: pendingTasks.filter(t => t.riskLevel === "critical").length,
    high: pendingTasks.filter(t => t.riskLevel === "high").length,
    medium: pendingTasks.filter(t => t.riskLevel === "medium").length,
    low: pendingTasks.filter(t => t.riskLevel === "low").length,
  };

  const handleToggleStatus = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid selecting the card
    const newStatus: "pending" | "completed" = task.status === "pending" ? "completed" : "pending";
    try {
      const docRef = doc(db, "tasks", task.id);
      try {
        await updateDoc(docRef, { status: newStatus });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
        throw err;
      }
      const updated = { ...task, status: newStatus };
      onTaskUpdated(updated);
      if (selectedTask?.id === task.id) {
        setSelectedTask(updated);
      }
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const handleDeleteTask = async (task: Task) => {
    try {
      const docRef = doc(db, "tasks", task.id);
      try {
        await deleteDoc(docRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `tasks/${task.id}`);
        throw err;
      }
      onTaskDeleted(task.id);
      if (selectedTask?.id === task.id) {
        setSelectedTask(null);
      }
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  // Format date nicely
  const formatDeadline = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, { 
        month: "short", 
        day: "numeric", 
        hour: "2-digit", 
        minute: "2-digit" 
      });
    } catch {
      return isoString;
    }
  };

  // Get countdown string
  const getCountdown = (isoString: string) => {
    try {
      const diff = new Date(isoString).getTime() - Date.now();
      if (diff <= 0) return "Overdue";
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) return `${days}d ${hours}h left`;
      if (hours > 0) return `${hours}h ${minutes}m left`;
      return `${minutes}m left`;
    } catch {
      return "";
    }
  };

  // Simple countdown refresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  // Helper colors for risk
  const getRiskBadgeStyles = (level?: string) => {
    switch (level) {
      case "critical":
        return "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-400";
      case "high":
        return "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-400";
      case "medium":
        return "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-400";
      case "low":
        return "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-400";
      default:
        return "bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800/50 dark:border-slate-800 dark:text-slate-400";
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* LEFT COLUMN: Summary Widgets & Bento Stats (2 cols wide on desktop) */}
      <div className="lg:col-span-2 space-y-6">
        
        {/* Proactive Risk Alarm Banner if critical tasks exist */}
        {criticalCount > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-5 rounded-3xl bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-blue-500/10 border border-rose-500/20 dark:border-rose-500/30 backdrop-blur-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
          >
            <div className="flex gap-3">
              <div className="p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-2xl mt-0.5 md:mt-0 flex-shrink-0 animate-pulse">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-zinc-900 dark:text-white text-base">
                  Urgent Deadline{criticalCount > 1 ? 's' : ''} Detected
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed">
                  One or more tasks require immediate attention. Create a personalized schedule to stay ahead and avoid last-minute pressure.
                </p>
              </div>
            </div>
            <button 
              onClick={() => onActiveTabChange("schedule")}
              className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 rounded-xl font-bold text-xs shadow-md transition-all hover:scale-[1.02] cursor-pointer flex items-center gap-1.5 shrink-0 self-end md:self-auto hover:bg-zinc-800 dark:hover:bg-zinc-100"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Generate Schedule</span>
            </button>
          </motion.div>
        )}

        {/* Bento Grid Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Impending Tasks</span>
              <div className="p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-500 dark:text-blue-400 rounded-xl">
                <Hourglass className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-4">
              <h4 className="text-2xl font-black text-zinc-900 dark:text-zinc-50">{pendingCount}</h4>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium mt-0.5">Active objectives</p>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Committed Hours</span>
              <div className="p-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-500 dark:text-rose-400 rounded-xl">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-4">
              <h4 className="text-2xl font-black text-zinc-900 dark:text-zinc-50">{totalEstimatedHours}h</h4>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium mt-0.5">Estimated time load</p>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Risk Alarm</span>
              <div className="p-1.5 bg-amber-50 dark:bg-amber-950/50 text-amber-500 dark:text-amber-400 rounded-xl">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-4">
              <h4 className={`text-2xl font-black ${criticalCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                {criticalCount}
              </h4>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium mt-0.5">High risk tasks</p>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Success Ratio</span>
              <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-500 dark:text-emerald-400 rounded-xl">
                <CheckCircle className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-4">
              <h4 className="text-2xl font-black text-zinc-900 dark:text-zinc-50">
                {totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0}%
              </h4>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium mt-0.5">{completedCount} of {totalTasks} finished</p>
            </div>
          </div>
        </div>

        {/* Task lists & control */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-zinc-200/60 dark:border-zinc-800/80 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-900/40">
            <div>
              <h2 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">Pending Tasks & Analysis</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Click a task to review AI recommendations</p>
            </div>
            <button
              onClick={onAddTaskClick}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer hover:scale-[1.02]"
            >
              <span>+ Add Task</span>
            </button>
          </div>

          <div className="divide-y divide-zinc-150 dark:divide-zinc-800/60 max-h-[450px] overflow-y-auto">
            {pendingTasks.length === 0 ? (
              <div className="p-12 text-center text-zinc-400 dark:text-zinc-500">
                <Check className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                <p className="text-sm font-semibold">Excellent work! No pending tasks.</p>
                <button 
                  onClick={onAddTaskClick}
                  className="mt-3 text-xs text-blue-600 dark:text-blue-400 font-extrabold hover:underline cursor-pointer"
                >
                  Add a task now
                </button>
              </div>
            ) : (
              pendingTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className={`p-4 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20 transition-all cursor-pointer flex items-center justify-between gap-4 border-l-4 ${
                    selectedTask?.id === task.id 
                      ? "bg-zinc-50/90 dark:bg-zinc-800/30 border-blue-500 pl-3" 
                      : "border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <button
                      onClick={(e) => handleToggleStatus(task, e)}
                      className="w-5 h-5 rounded-full border border-zinc-300 dark:border-zinc-700 flex items-center justify-center hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all cursor-pointer flex-shrink-0"
                    >
                      <Check className="w-3.5 h-3.5 text-transparent hover:text-emerald-500" />
                    </button>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 truncate group-hover:text-blue-600">
                        {task.title}
                      </h4>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-zinc-400" />
                          {formatDeadline(task.deadline)}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-800">•</span>
                        <span>{task.estimatedHours}h estimated</span>
                        <span className="text-zinc-300 dark:text-zinc-800">•</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{getCountdown(task.deadline)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {task.riskLevel && (
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border capitalize tracking-wide ${getRiskBadgeStyles(task.riskLevel)}`}>
                        {task.riskLevel} Risk
                      </span>
                    )}
                    {task.aiPriorityScore && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                        Priority {task.aiPriorityScore}/10
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setTaskToDelete(task);
                      }}
                      className="p-1.5 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Completed tasks list */}
        {completedTasks.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm overflow-hidden opacity-85 hover:opacity-100 transition-opacity">
            <div className="p-4 border-b border-zinc-200/60 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30 flex justify-between items-center">
              <h3 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">Completed Tasks ({completedCount})</h3>
            </div>
            <div className="divide-y divide-zinc-150 dark:divide-zinc-800/60 max-h-[200px] overflow-y-auto">
              {completedTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="p-3 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20 transition-all cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      onClick={(e) => handleToggleStatus(task, e)}
                      className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400 line-through truncate font-medium">
                      {task.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleToggleStatus(task, e)}
                      title="Restore to Pending"
                      className="p-1 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
                    >
                      <Undo className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setTaskToDelete(task);
                      }}
                      title="Permanently Delete"
                      className="p-1 text-zinc-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: AI Coprocessor recommendations */}
      <div className="space-y-6">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200/60 dark:border-zinc-800/80 shadow-sm p-6 relative overflow-hidden group">
          {/* Bento glow background decoration */}
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/10 dark:bg-blue-600/5 blur-[80px] rounded-full pointer-events-none transition-all duration-700" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-600" />
          
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4.5 h-4.5 text-blue-500 animate-pulse" />
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">Completion Forecast</h3>
          </div>

          <AnimatePresence mode="wait">
            {selectedTask ? (
              <motion.div
                key={selectedTask.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-5"
              >
                <div>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-extrabold tracking-widest">Analyzing Task</span>
                  <h4 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 mt-1 leading-snug">
                    {selectedTask.title}
                  </h4>
                </div>

                {/* Priority Score Gauge */}
                <div className="bg-zinc-50 dark:bg-zinc-950/50 rounded-2xl p-4 border border-zinc-200/60 dark:border-zinc-800/80">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">Priority Index</span>
                    <span className="text-sm font-extrabold text-blue-600 dark:text-blue-400">{selectedTask.aiPriorityScore || "N/A"}/10</span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-500" 
                      style={{ width: `${(selectedTask.aiPriorityScore || 0) * 10}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2.5 leading-relaxed font-medium">
                    {cleanExplanation(selectedTask.aiPriorityExplanation, selectedTask) || "No priority reasoning available."}
                  </p>
                </div>

                {/* Risk Level Alarm */}
                <div>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-extrabold tracking-widest">Impending Risk Alarm</span>
                  <div className={`mt-2 p-4 rounded-2xl border flex gap-3 ${
                    selectedTask.riskLevel === "critical"
                      ? "bg-rose-50/50 border-rose-200 text-rose-800 dark:bg-rose-950/20 dark:border-rose-900 dark:text-rose-300"
                      : selectedTask.riskLevel === "high"
                      ? "bg-amber-50/50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-900 dark:text-amber-300"
                      : "bg-emerald-50/50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-900 dark:text-emerald-300"
                  }`}>
                    <div className="mt-0.5">
                      <BadgeAlert className="w-5 h-5 shrink-0" />
                    </div>
                    <div>
                      <h5 className="text-xs font-extrabold uppercase tracking-wider">{selectedTask.riskLevel || "Low"} risk status</h5>
                      <p className="text-xs mt-1 leading-relaxed font-medium opacity-95">
                        {cleanExplanation(selectedTask.riskExplanation, selectedTask) || "This task is currently on a highly manageable track. I recommend taking a small step today to get a head start."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Advanced Pacings & Predictions Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-50 dark:bg-zinc-950/50 p-3 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500 mb-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-extrabold tracking-wider">Remaining Hours</span>
                    </div>
                    <p className="text-sm font-extrabold text-zinc-800 dark:text-zinc-200">
                      {metrics ? `${metrics.remainingHours} hrs` : "N/A"}
                    </p>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-950/50 p-3 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500 mb-1">
                      <Hourglass className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-extrabold tracking-wider">Remaining Days</span>
                    </div>
                    <p className="text-sm font-extrabold text-zinc-800 dark:text-zinc-200">
                      {metrics ? `${metrics.remainingDays} days` : "N/A"}
                    </p>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-950/50 p-3 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500 mb-1">
                      <BarChart2 className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-extrabold tracking-wider">Daily Study Hours</span>
                    </div>
                    <p className="text-sm font-extrabold text-zinc-800 dark:text-zinc-200">
                      {metrics ? `${metrics.suggestedDailyHours} hrs` : "N/A"}
                    </p>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-950/50 p-3 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500 mb-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-extrabold tracking-wider">Start Date</span>
                    </div>
                    <p className="text-xs font-extrabold text-zinc-800 dark:text-zinc-200 truncate">
                      {metrics ? metrics.recommendedStartDateText : "N/A"}
                    </p>
                  </div>
                </div>

                {/* Completion Confidence Percentage */}
                <div className="bg-zinc-50 dark:bg-zinc-950/50 p-4 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-bold">Completion Confidence</span>
                    </div>
                    <span className={`text-xs font-extrabold ${
                      metrics && metrics.confidence > 75 
                        ? "text-emerald-600 dark:text-emerald-400" 
                        : metrics && metrics.confidence > 45 
                        ? "text-amber-600 dark:text-amber-400" 
                        : "text-rose-600 dark:text-rose-400"
                    }`}>
                      {metrics ? `${metrics.confidence}%` : "N/A"}
                    </span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        metrics && metrics.confidence > 75 
                          ? "bg-emerald-500" 
                          : metrics && metrics.confidence > 45 
                          ? "bg-amber-500" 
                          : "bg-rose-500"
                      }`}
                      style={{ width: metrics ? `${metrics.confidence}%` : "0%" }}
                    />
                  </div>
                </div>

                {selectedTask.status === "pending" && (
                  <button
                    onClick={(e) => handleToggleStatus(selectedTask, e)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/10 hover:shadow-blue-500/25 transition-all cursor-pointer flex items-center justify-center gap-1.5 hover:scale-[1.02]"
                  >
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>Mark as Completed</span>
                  </button>
                )}
              </motion.div>
            ) : (
              <div className="py-12 text-center text-zinc-400 dark:text-zinc-500">
                <FileText className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                <p className="text-xs font-semibold">No active selection</p>
                <p className="text-[10px] mt-1 text-zinc-400 dark:text-zinc-600 leading-relaxed max-w-xs mx-auto">
                  Select any pending task in the list to reveal Gemini predictive deadline analyses and pacing recommendations.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Custom delete confirmation modal */}
      <AnimatePresence>
        {taskToDelete && (
          <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80 shadow-2xl p-6 rounded-3xl max-w-sm w-full relative"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-rose-50 dark:bg-rose-950/50 text-rose-500 rounded-xl">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50">Permanently Delete Task</h3>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mb-6 leading-relaxed">
                Are you sure you want to permanently delete this task?
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTaskToDelete(null)}
                  className="flex-1 py-2 px-4 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-300 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const task = taskToDelete;
                    setTaskToDelete(null);
                    await handleDeleteTask(task);
                  }}
                  className="flex-1 py-2 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md shadow-rose-500/15 transition-all hover:scale-[1.02] cursor-pointer"
                >
                  Delete Task
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

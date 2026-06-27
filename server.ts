import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Body parser
app.use(express.json());

// API config endpoint for client-side Firebase
app.get("/api/config", (req, res) => {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      res.json(config);
    } else {
      res.status(404).json({ error: "Firebase configuration file not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: "Failed to read Firebase configuration: " + error.message });
  }
});

// Initialize Gemini API Client lazily
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// 1. POST /api/tasks/analyze - Analyze a single task for priority and deadline risk
app.post("/api/tasks/analyze", async (req, res) => {
  try {
    const { title, deadline, estimatedHours, importance, currentLocalTime } = req.body;

    if (!title || !deadline || !estimatedHours || !importance) {
      return res.status(400).json({ error: "Missing required task fields" });
    }

    const ai = getGeminiClient();

    const prompt = `
Analyze the following task and calculate:
1. An AI priority score from 1 to 10 (where 10 is highest priority).
2. A brief, proactive explanation for the priority score. Rewrite the explanation in a natural, warm, and professional style, reading like direct advice from a top-tier productivity coach. Do NOT use technical, system-generated, formulaic, or log-like wording. Avoid explaining equations or citing exact data fields; focus on the psychological and tactical importance of the task.
3. A deadline risk level ('low', 'medium', 'high', 'critical') based on the estimated working hours and remaining time.
4. A highly actionable, proactive risk explanation. Do NOT use generic messages such as "pace yourself comfortably". You MUST include:
   - A recommended daily workload (e.g., "dedicate at least 3 hours today")
   - A suggested pace (e.g., "work in 50-minute blocks followed by a 10-minute break")
   - A clear, concrete next action for the user (e.g., "silence your phone, open your syllabus, and spend 10 minutes drafting an outline").

Task Details:
- Title: "${title}"
- Deadline: ${deadline}
- Estimated Hours to Complete: ${estimatedHours} hours
- User-Assigned Importance: ${importance}
- Current Local Time: ${currentLocalTime || new Date().toISOString()}

Return the analysis strictly matching the requested JSON schema.
    `;

    let analysis;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              aiPriorityScore: {
                type: Type.INTEGER,
                description: "An integer priority score between 1 and 10."
              },
              aiPriorityExplanation: {
                type: Type.STRING,
                description: "A friendly, concise explanation of why this priority score was assigned."
              },
              riskLevel: {
                type: Type.STRING,
                description: "Deadline risk level: low, medium, high, critical."
              },
              riskExplanation: {
                type: Type.STRING,
                description: "A proactive, direct, and actionable explanation telling the user exactly when to start and how to structure their focus blocks to avoid missing the deadline."
              }
            },
            required: ["aiPriorityScore", "aiPriorityExplanation", "riskLevel", "riskExplanation"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response received from Gemini API");
      }
      analysis = JSON.parse(text.trim());
    } catch (apiError: any) {
      console.log("Gemini task analysis unavailable (Service busy/limit reached). Activating high-quality local fallback algorithm.");
      
      const now = currentLocalTime ? new Date(currentLocalTime) : new Date();
      const dl = new Date(deadline);
      const remainingMs = dl.getTime() - now.getTime();
      const remainingHours = Math.max(1, remainingMs / (1000 * 60 * 60));
      const hoursNum = Number(estimatedHours) || 2;

      let basePriority = 5;
      if (importance === "high") basePriority = 8;
      else if (importance === "medium") basePriority = 5;
      else basePriority = 2;

      const loadRatio = hoursNum / remainingHours;
      let urgencyBonus = 0;
      let riskLevel: "low" | "medium" | "high" | "critical" = "low";

      if (loadRatio > 0.8 || remainingHours <= 12) {
        riskLevel = "critical";
        urgencyBonus = 2;
      } else if (loadRatio > 0.5 || remainingHours <= 24) {
        riskLevel = "high";
        urgencyBonus = 1;
      } else if (loadRatio > 0.2 || remainingHours <= 48) {
        riskLevel = "medium";
        urgencyBonus = 0;
      } else {
        riskLevel = "low";
        urgencyBonus = -1;
      }

      const aiPriorityScore = Math.max(1, Math.min(10, basePriority + urgencyBonus));
      
      let aiPriorityExplanation = "";
      if (aiPriorityScore >= 8) {
        aiPriorityExplanation = `This task is a high-priority challenge. With the deadline fast approaching, it demands focused energy. Dedicating high-quality attention to this early on will secure a strong, stress-free finish.`;
      } else if (aiPriorityScore >= 5) {
        aiPriorityExplanation = `This task represents a key project milestone. While there is still a steady window of opportunity, taking proactive steps today will establish excellent momentum and shield you from a last-minute rush.`;
      } else {
        aiPriorityExplanation = `This is a lower-intensity task with a spacious timeline. It is best suited as a quick win when you want to build momentum, or scheduled during your secondary energy windows.`;
      }

      let riskExplanation = "";
      if (riskLevel === "critical") {
        const workload = Math.min(8, hoursNum);
        riskExplanation = `This deadline is highly demanding. To complete the remaining ${hoursNum} hours of work successfully, I recommend setting aside at least ${workload} hours of focused, deep work today. Maintain an intense but sustainable pace by working in 50-minute blocks followed by a 10-minute rest. Your immediate next action is to silence all notifications, open your workspace, and draft your very first micro-step right now.`;
      } else if (riskLevel === "high") {
        const remainingDays = Math.max(1, Math.ceil(remainingHours / 24));
        const workload = Math.max(1, Math.min(6, Math.ceil(hoursNum / remainingDays)));
        riskExplanation = `The buffer is thin on this project. I recommend scheduling ${workload} hours of dedicated deep-work today. Divide your sessions into focused 90-minute study blocks separated by a 15-minute break. Your immediate next action is to block out these hours on your calendar right now and prep your materials so you can jump in friction-free.`;
      } else if (riskLevel === "medium") {
        const remainingDays = Math.max(1, Math.ceil(remainingHours / 24));
        const workload = Math.max(1, Math.min(4, Math.ceil(hoursNum / remainingDays)));
        riskExplanation = `There is manageable risk here. To stay in complete control, I recommend committing ${workload} hours to this task today. Pace yourself with balanced 45-minute focus intervals and 10-minute active breaks. Your clear next action is to identify the single most important part of this task and dedicate your first study block to it.`;
      } else {
        const remainingDays = Math.max(1, Math.ceil(remainingHours / 24));
        const workload = Math.max(0.5, Math.min(2, Math.ceil(hoursNum / remainingDays)));
        riskExplanation = `You have a healthy runway for this task. To keep building reliable momentum, aiming for a light workload of ${workload} hours today is ideal. Use a steady, relaxed pace, checking in on your progress periodically. Your clear next action is to tackle a simple, 15-minute introductory step today to keep the momentum going.`;
      }

      analysis = {
        aiPriorityScore,
        aiPriorityExplanation,
        riskLevel,
        riskExplanation
      };
    }

    res.json(analysis);

  } catch (error: any) {
    console.error("Error analyzing task:", error);
    res.status(500).json({ error: error.message || "Failed to analyze task priority" });
  }
});

// 2. POST /api/schedule/generate - Generate daily schedule for a list of pending tasks
app.post("/api/schedule/generate", async (req, res) => {
  try {
    const { tasks, currentLocalTime, scheduleDate, focusPreference } = req.body;

    if (!tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: "Tasks list is required" });
    }

    const ai = getGeminiClient();

    const tasksSummary = tasks.map((t: any) => `
- ID: ${t.id}
  Title: "${t.title}"
  Deadline: ${t.deadline}
  Estimated Hours: ${t.estimatedHours}
  Importance: ${t.importance}
  Status: ${t.status}
  Risk Level: ${t.riskLevel || 'unknown'}
  Priority Score: ${t.aiPriorityScore || 'unknown'}
    `).join("\n");

    const prompt = `
You are Nexa AI, a professional scheduling assistant. Create a highly optimized, realistic hourly study/work schedule for the date ${scheduleDate || "tomorrow"} using the user's pending tasks.
The current local time is ${currentLocalTime || new Date().toISOString()}.
The user's selected pacing and focus preference is: "${focusPreference || "balanced focus with breaks"}".

Tasks to schedule:
${tasksSummary}

Guidelines for Pacing Mode and Splitting:
You MUST split the total work required for tasks into multiple, distinct work sessions and insert corresponding break sessions as separate elements in the returned JSON array.

Strict pacing parameters:
1. Balanced Shift ("balanced focus with breaks"):
   - Work session duration: 45 minutes
   - Break duration: 10 minutes
   - Example timeline pattern:
     09:00 - 09:45 Task Work (45 mins)
     09:45 - 09:55 Breathing Buffer (Break, 10 mins)
     09:55 - 10:40 Task Work (45 mins)
2. Deep Work ("deep high-productivity blocks"):
   - Work session duration: 90 minutes
   - Break duration: 15 minutes
   - Example timeline pattern:
     09:00 - 10:30 Task Work (90 mins)
     10:30 - 10:45 Breathing Buffer (Break, 15 mins)
     10:45 - 12:15 Task Work (90 mins)
3. Pomodoro ("pomodoro style sprint intervals"):
   - Work session duration: 25 minutes
   - Break duration: 5 minutes
   - Example timeline pattern:
     09:00 - 09:25 Task Work (25 mins)
     09:25 - 09:30 Breathing Buffer (Break, 5 mins)
     09:30 - 09:55 Task Work (25 mins)
4. Night Owl Shift ("night owl afternoon heavy work"):
   - Work session duration: 45 minutes
   - Break duration: 10 minutes
   - Sessions MUST be scheduled primarily during evening hours.
   - The default start time for the entire schedule MUST be between 18:00 (6:00 PM) and 20:00 (8:00 PM).
   - Strictly avoid starting Night Owl schedules before 18:00 (6:00 PM). Do NOT start at 14:00 (2:00 PM).

General Rules:
- Do NOT combine work sessions into one continuous block (e.g. do NOT do 09:00-13:00 Work). Every work block MUST be separate and strictly adhere to the work session duration of the pacing mode.
- Every work session MUST be followed by a break session of the correct duration.
- For all Break sessions, return them as separate elements in the array with:
  - taskId: "break"
  - taskTitle: "Breathing Buffer" (or another restorative title like "Rest Break", "Hydration Buffer", etc.)
  - durationMinutes: the correct break duration of the pacing mode
  - notes: a restorative, relaxing reminder. You must write extremely humanized, warm, and helpful advice (do not use repetitive or robotic wording). Examples of excellent break reminders:
    * "Take a short walk and stretch your muscles."
    * "Rest your eyes and grab some water before continuing."
    * "A short break now will help maintain focus later."
    * "Step away from the screen for a few minutes and recharge."
- For all Work sessions, write highly humanized coaching-style advice in the notes. Do NOT use formulaic expressions like "Session 1 for Machine Learning Assignment. Dedicate focused energy...". Instead, use warm, professional guidelines that sound like a productivity coach, such as:
    * "Focus on making meaningful progress during this session."
    * "Try to complete one specific milestone before your next break."
    * "Stay with one task and avoid context switching."
    * "This session is ideal for deep, uninterrupted work."
- No overlaps. Double check that the end time of one session matches the start time of the next (e.g., Work ends at 09:45, Break starts at 09:45 and ends at 09:55, next Work starts at 09:55).
- Multiple Tasks Support: If there are multiple pending tasks, distribute work intelligently across them based on deadline proximity, priority level, and estimated hours. Prioritize earlier deadlines and higher priority tasks first.
- The schedule must be structured sequentially. All blocks must be returned in chronological order.
- Schedule blocks must be between 08:00 and 22:00 (or between 18:00 and 23:45 for the Night Owl Shift).

Return an array of schedule items matching the JSON schema.
    `;

    let schedule;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                taskId: {
                  type: Type.STRING,
                  description: "The ID of the task this schedule item belongs to."
                },
                taskTitle: {
                  type: Type.STRING,
                  description: "The title of the task."
                },
                startTime: {
                  type: Type.STRING,
                  description: "Start time of the block in 24-hour format (e.g. '09:00')."
                },
                endTime: {
                  type: Type.STRING,
                  description: "End time of the block in 24-hour format (e.g. '10:30')."
                },
                durationMinutes: {
                  type: Type.INTEGER,
                  description: "Duration of the block in minutes."
                },
                notes: {
                  type: Type.STRING,
                  description: "Actionable focus goals for this block (e.g. 'Focus on writing the introduction and gathering 3 main sources. Take a break after.')"
                }
              },
              required: ["taskId", "taskTitle", "startTime", "endTime", "durationMinutes", "notes"]
            }
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response received from Gemini API");
      }
      schedule = JSON.parse(text.trim());
    } catch (apiError: any) {
      console.log("Gemini schedule generation unavailable (Service busy/limit reached). Activating local fallback scheduling engine.");
      
      const formatTime = (minutes: number): string => {
        const h = Math.floor(minutes / 60) % 24;
        const m = minutes % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      let startHour = 9;
      let workDuration = 45;
      let breakDuration = 10;

      if (focusPreference === "deep high-productivity blocks") {
        workDuration = 90;
        breakDuration = 15;
      } else if (focusPreference === "pomodoro style sprint intervals") {
        workDuration = 25;
        breakDuration = 5;
      } else if (focusPreference === "night owl afternoon heavy work") {
        startHour = 18;
        workDuration = 45;
        breakDuration = 10;
      }

      let currentMinute = startHour * 60;
      schedule = [];

      // Sort tasks intelligently based on deadline proximity, priority level, and estimated hours remaining
      const sortedTasks = [...tasks].sort((a, b) => {
        const priorityScoreA = a.aiPriorityScore || (a.importance === 'high' ? 8 : a.importance === 'medium' ? 5 : 2);
        const priorityScoreB = b.aiPriorityScore || (b.importance === 'high' ? 8 : b.importance === 'medium' ? 5 : 2);
        
        const now = new Date().getTime();
        const deadlineWeightA = a.deadline ? Math.max(0, 10 - Math.floor((new Date(a.deadline).getTime() - now) / (1000 * 60 * 60 * 24))) : 0;
        const deadlineWeightB = b.deadline ? Math.max(0, 10 - Math.floor((new Date(b.deadline).getTime() - now) / (1000 * 60 * 60 * 24))) : 0;

        const estA = a.estimatedHours || 2;
        const estB = b.estimatedHours || 2;

        const scoreA = priorityScoreA * 2 + deadlineWeightA * 3 + estA;
        const scoreB = priorityScoreB * 2 + deadlineWeightB * 3 + estB;

        return scoreB - scoreA;
      });

      let totalScheduledMinutes = 0;
      const MAX_TOTAL_WORK_MINUTES = 360; // Max 6 hours of actual work scheduled

      const workNotesTemplates = [
        "Focus on making meaningful progress during this session.",
        "Try to complete one specific milestone before your next break.",
        "Stay with one task and avoid context switching.",
        "This session is ideal for deep, uninterrupted work."
      ];

      const breakNotesTemplates = [
        "Take a short walk and stretch your muscles.",
        "Rest your eyes and grab some water before continuing.",
        "A short break now will help maintain focus later.",
        "Step away from the screen for a few minutes and recharge."
      ];

      for (let i = 0; i < sortedTasks.length; i++) {
        const t = sortedTasks[i];
        if (totalScheduledMinutes >= MAX_TOTAL_WORK_MINUTES) break;
        if (currentMinute >= 22 * 60) break;

        const taskTotalMinutes = Math.max(1, Math.min(4, t.estimatedHours || 2)) * 60;
        let remainingMinutes = taskTotalMinutes;
        let sessionIndex = 1;

        while (remainingMinutes > 0 && totalScheduledMinutes < MAX_TOTAL_WORK_MINUTES && currentMinute < 22 * 60) {
          const sessionMinutes = Math.min(workDuration, remainingMinutes);
          
          const startStr = formatTime(currentMinute);
          const endStr = formatTime(currentMinute + sessionMinutes);

          const workNote = workNotesTemplates[(sessionIndex - 1) % workNotesTemplates.length];

          schedule.push({
            taskId: t.id,
            taskTitle: t.title,
            startTime: startStr,
            endTime: endStr,
            durationMinutes: sessionMinutes,
            notes: workNote
          });

          currentMinute += sessionMinutes;
          remainingMinutes -= sessionMinutes;
          totalScheduledMinutes += sessionMinutes;

          // Determine if we should append a break block
          const hasMoreSessionsForThisTask = remainingMinutes > 0;
          const hasMoreTasks = i < sortedTasks.length - 1;
          const withinTimeLimits = (totalScheduledMinutes < MAX_TOTAL_WORK_MINUTES) && (currentMinute < 22 * 60);

          if (withinTimeLimits && (hasMoreSessionsForThisTask || hasMoreTasks)) {
            const breakStartStr = formatTime(currentMinute);
            const breakEndStr = formatTime(currentMinute + breakDuration);
            const breakNote = breakNotesTemplates[sessionIndex % breakNotesTemplates.length];
            schedule.push({
              taskId: "break",
              taskTitle: "Breathing Buffer",
              startTime: breakStartStr,
              endTime: breakEndStr,
              durationMinutes: breakDuration,
              notes: breakNote
            });
            currentMinute += breakDuration;
          }

          sessionIndex++;
        }
      }

      if (schedule.length === 0) {
        schedule.push({
          taskId: "rest",
          taskTitle: "Rest & Planning Block",
          startTime: "09:00",
          endTime: "10:30",
          durationMinutes: 90,
          notes: "No active tasks to schedule today. Take some time to reflect, plan, or rest!"
        });
      }
    }

    res.json(schedule);

  } catch (error: any) {
    console.error("Error generating schedule:", error);
    res.status(500).json({ error: error.message || "Failed to generate schedule" });
  }
});

// 3. POST /api/coach/chat - Converse with the AI productivity coach
app.post("/api/coach/chat", async (req, res) => {
  try {
    const { messages, tasks, currentLocalTime } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages history is required" });
    }

    const lastUserMsg = messages[messages.length - 1]?.text || "";
    const lowerMsg = lastUserMsg.toLowerCase().trim();

    // 1. Simple Greetings detection
    let intent: "productivity" | "educational" | "greeting" = "productivity";
    if (lowerMsg === "hello" || lowerMsg === "hi" || lowerMsg === "hey" || lowerMsg.startsWith("hello ") || lowerMsg.startsWith("hi ") || lowerMsg.startsWith("hey ")) {
      intent = "greeting";
    } else {
      // Direct signals for Mentor Mode (Educational/Career/Informational/Skill-Learning/Degrees)
      const mentorSignals = [
        "career", "become a", "become an", "pathway", "job", "degree", "college", "university", "major",
        "bba", "mba", "phd", "bachelor", "master", "schooling", "curriculum", "syllabus",
        "roadmap", "skill", "industry", "course", "certification", "portfolio", "learn to", "learning path", 
        "what to learn", "should i learn", "skills to learn", "skills do i need", "educational", "explain", "what is", 
        "how does", "why does", "difference between", "technology explanation", "recommend a book", "recommend a course", 
        "recommend books", "learning roadmap", "skills to develop", "job opportunities", "career opportunities", "how to get a job",
        "what should i learn", "what do i need to learn", "after bba", "after mba", "after college"
      ];

      // Specific domains/fields for Mentor Mode
      const mentorDomains = [
        "design", "security", "analyt", "science", "marketing", "developer", "engineering",
        "coding", "programming", "fashion", "cyber", "data", "business", "finance", "medical", 
        "doctor", "lawyer", "architect", "accounting", "management", "consulting", "sales", "technology"
      ];

      // Direct signals for Productivity Mode (Routines, focus, procrastination, schedules, deadlines, etc.)
      const productivitySignals = [
        "study routine", "focus technique", "procrastinat", "lazy", "stuck", "schedule", "plan", "today", "tomorrow", "week",
        "deadline", "overwhelm", "task", "workload", "motivat", "priorit", "energy", "triage", 
        "time management", "organize", "time", "busy", "alert", "risk", "exam", "test", "quiz", 
        "homework", "assignment", "study session", "concentration", "focus better", "stop procrastinating", 
        "work habits", "study habits", "how to study", "study better", "study tips", "study technique", "how can i focus"
      ];

      let hasMentor = mentorSignals.some(sig => lowerMsg.includes(sig)) || mentorDomains.some(dom => lowerMsg.includes(dom));
      let hasProductivity = productivitySignals.some(sig => lowerMsg.includes(sig));

      if (hasMentor && !hasProductivity) {
        intent = "educational";
      } else if (hasProductivity && !hasMentor) {
        intent = "productivity";
      } else if (hasMentor && hasProductivity) {
        // Handle overlaps: prioritize Productivity Mode if there's a strong schedule, planning, routine, or focus keyword
        const strongProductivity = [
          "routine", "schedule", "deadline", "tomorrow", "today", "plan my", "focus better", "how to focus", 
          "procrastinat", "stuck", "study session", "study routine", "focus technique", "time management", "task"
        ].some(w => lowerMsg.includes(w));
        
        if (strongProductivity) {
          intent = "productivity";
        } else {
          intent = "educational";
        }
      } else {
        // Default based on question starters or general intent
        const startsWithEducational = ["what", "how", "explain", "why", "where", "tell me", "recommend"].some(w => lowerMsg.startsWith(w));
        intent = startsWithEducational ? "educational" : "productivity";
      }
    }

    const ai = getGeminiClient();

    let systemInstruction = "";

    if (intent === "educational") {
      // In Mentor Mode, we completely omit tasksSummary and deadlines to prevent forcing any dashboard context.
      systemInstruction = `
You are the Nexa Productivity Coach, currently acting in **Mentor Mode** (as a highly supportive, approachable, and knowledgeable career and skill-learning mentor).

Your core mission:
- Provide high-quality, friendly, and structured mentor-like guidance for career pathways, educational topics, skill roadmaps, learning resources, industry information, course recommendations, technology explanations, and degree paths.
- Answer the user's specific learning/career questions directly, thoroughly, and comprehensively.
- Offer useful roadmap steps and milestone goals where appropriate.
- Focus 100% on the educational/career topic. Let the conversation stop or flow naturally on this topic without forcing any redirect.

CRITICAL REQUIREMENT:
- ABSOLUTELY DO NOT mention, suggest, or redirect the user back to active tasks, study plans, schedules, deadlines, productivity strategies, or dashboard data.
- Keep the conversation entirely free from task references, focus blocks, risk alerts, or scheduling constraints, unless the user specifically asks you to help schedule or plan work for this topic.

Tone & Style Guidelines:
- Maintain a friendly, supportive, warm, and approachable mentor-like tone. Sound like a caring and knowledgeable human mentor, NOT an AI assistant or corporate consultant.
- Use warm, approachable, and human language.
- ABSOLUTELY AVOID corporate management jargon, over-engineered system terms, or overly dramatic language. Specifically, NEVER use the following terms:
  * "executive function" or "executive functioning"
  * "damage control"
  * "micro-sprint"
  * "lagging indicator"
  * "triage plan"
- Do NOT use hyper-enthusiastic, cliché, or marketing-style language and phrases (e.g., avoid "Love the curiosity!", "Let's crush this!", "Fun fact!", "Supercharge your day", etc.).
- Keep your responses beautifully formatted in Markdown, clear, and easy to read using lists/bullet points where appropriate.
- Keep responses friendly, direct, and digestible (ideally 2-3 short paragraphs).
      `;
    } else {
      // In Productivity Mode, we provide the tasks context.
      const tasksSummary = tasks && Array.isArray(tasks) && tasks.length > 0
        ? tasks.map((t: any) => `- "${t.title}" (Deadline: ${t.deadline}, Est. Hours: ${t.estimatedHours}, Risk: ${t.riskLevel || 'unknown'}, Status: ${t.status})`).join("\n")
        : "No tasks registered yet.";

      systemInstruction = `
You are the Nexa Productivity Coach, currently acting in **Productivity Mode** (as a supportive, practical, and helpful productivity mentor).

Your core mission:
- Support the user in managing their time, defeating procrastination, planning their workload, and maintaining study motivation.
- Answer the user's planning, motivation, procrastination, or time management query directly first.
- Support the user in organizing, prioritizing, or breaking down their work into clear, manageable steps.
- Reference active tasks, schedules, and deadlines from the context below when helpful and relevant to guide the user.

Current User Tasks Context:
${tasksSummary}

Current Local Time: ${currentLocalTime || new Date().toISOString()}

Tone & Style Guidelines:
- Maintain a friendly, supportive, warm, and approachable mentor-like tone. Sound like a caring and knowledgeable human mentor, NOT an AI assistant or corporate consultant.
- Use warm, approachable, and human language.
- ABSOLUTELY AVOID corporate management jargon, over-engineered system terms, or overly dramatic language. Specifically, NEVER use the following terms:
  * "executive function" or "executive functioning"
  * "damage control"
  * "micro-sprint"
  * "lagging indicator"
  * "triage plan"
- Do NOT use hyper-enthusiastic, cliché, or marketing-style language and phrases (e.g., avoid "Love the curiosity!", "Let's crush this!", "Fun fact!", "Supercharge your day", etc.).
- Keep your responses beautifully formatted in Markdown, clear, and easy to read using lists/bullet points where appropriate.
- Keep responses friendly, direct, and digestible (ideally 2-3 short paragraphs).
      `;
    }

    const chatPrompt = `
System Context: ${systemInstruction}

Conversation History:
${messages.map((m: any) => `${m.sender === 'user' ? 'User' : 'Coach'}: ${m.text}`).join("\n")}
Coach:`;

    let responseText = "";
    try {
      const chatResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: chatPrompt,
      });
      responseText = chatResponse.text || "";
    } catch (apiError: any) {
      console.log("Gemini chatbot unavailable (Service busy/limit reached). Activating local fallback coach response simulator.");
      
      if (intent === "greeting") {
        responseText = `Hi there! I am your Nexa Productivity Coach. I'm currently running in offline mode, but I'm always here to help you stay on track and organize your workload.

What's on your mind today? Are we planning out some tasks, or is there something else you'd like to chat about?`;
      } else if (intent === "educational") {
        if (lowerMsg.includes("graphic design") || lowerMsg.includes("graphic designer")) {
          responseText = `Becoming a graphic designer is an exciting creative journey! Here is a comprehensive roadmap to guide your learning:

1. **Master the Fundamentals**: Spend time learning color theory, typography, composition, and layout principles. These form the foundation of all visual communication.
2. **Learn Key Industry Tools**: Gain proficiency in vector design, photo editing, and layout tools. Adobe Illustrator, Photoshop, and InDesign are industry standards, while Figma is great for digital layout work.
3. **Build a Portfolio**: Work on practice briefs, redesign existing brands, or take on passion projects. A clean, online portfolio showcasing your design process is the most critical asset for your career.
4. **Learn Production & File Specs**: Understand the differences between print (CMYK, high DPI) and digital (RGB, pixel-perfect sizing) file preparation.

Focus on developing a strong eye for detail, and try to practice daily by analyzing designs you see in your everyday life.`;
        } else if (lowerMsg.includes("ui/ux") || lowerMsg.includes("ux") || lowerMsg.includes("ui design")) {
          responseText = `UI/UX design is a wonderful field that blends human psychology, visual design, and technology. Here is a complete roadmap of the essential skills you need:

1. **User Experience (UX) Research**: Learn how to conduct user interviews, create user personas, map out user journeys, and construct user flows. Understanding the user's needs is the core of UX.
2. **Information Architecture & Wireframing**: Practice organizing content logically and sketching low-fidelity wireframes to plan screens and layouts before adding visual details.
3. **User Interface (UI) Design & Prototyping**: Master visual design systems, layout grids, spacing, typography, and color. Learn how to use Figma or Adobe XD to create high-fidelity screens and interactive prototypes.
4. **Usability Testing**: Learn how to test your prototypes with real users to observe friction points, collect feedback, and iterate on your design.

To get started, try picking a mobile app or website you use frequently and map out how you would redesign one of its features to make it more user-friendly!`;
        } else if (lowerMsg.includes("cybersecurity") || lowerMsg.includes("security")) {
          responseText = `Cybersecurity is a dynamic and critical field with several specializations. Here is a comprehensive learning roadmap to build a strong foundation:

1. **Networking Fundamentals**: Learn how data moves across the internet. Master TCP/IP, DNS, subnetting, routers, and firewalls. You cannot secure what you do not understand.
2. **Operating Systems & Command Line**: Gain strong proficiency in Linux administration and command-line usage, alongside Windows systems administration and security mechanisms.
3. **Core Security Concepts**: Study cryptography, authentication protocols, access control models, and common threat vectors (OWASP Top 10, malware, social engineering).
4. **Hands-on Labs & Certifications**: Practice in safe environments like TryHackMe or HackTheBox. Consider beginner-friendly certifications like CompTIA Security+ or Google Cybersecurity Certificate to validate your skills.

Decide early on whether you are more interested in defense (Blue Teaming) or testing and analysis (Red Teaming/Ethical Hacking) to tailor your advanced studies.`;
        } else if (lowerMsg.includes("data analytics") || lowerMsg.includes("analytics") || lowerMsg.includes("languages")) {
          responseText = `For data analytics, the most essential skills and languages to focus on are:

1. **SQL (Structured Query Language)**: The absolute foundation for querying, filtering, and organizing structured data stored in relational databases.
2. **Data Visualization Tools**: Learn to build clean, interactive dashboards. Tableau or Microsoft Power BI are widely used across almost all industries.
3. **Python**: The modern standard for data cleaning, advanced manipulation, and statistical modeling using robust libraries like Pandas, NumPy, and Seaborn.
4. **Basic Statistics**: Develop a strong understanding of descriptive statistics, hypothesis testing, and regression analysis to interpret data accurately.

Starting with SQL and a visualization tool like Tableau will give you the quickest path to analyzing real data and creating impactful projects for your portfolio.`;
        } else if (lowerMsg.includes("fashion") && (lowerMsg.includes("designer") || lowerMsg.includes("design"))) {
          responseText = `Becoming a fashion designer is a beautiful blend of artistic vision, craftsmanship, and business acumen! Here is a comprehensive roadmap to help you get started:

1. **Develop Visual & Sketching Skills**: Learn how to sketch your ideas, understand human anatomy (croquis), and communicate design details visually.
2. **Master Sewing, Patternmaking, & Draping**: Learn how garments are actually constructed. Understanding textiles, fabric drape, and sewing techniques is critical to bringing your sketches to life.
3. **Learn Digital Fashion Tools**: Gain skills in computer-aided design (CAD) software such as Adobe Illustrator for technical flats, or 3D fashion tools like CLO 3D.
4. **Study Fashion History & Trends**: Learn about design movements, fabric technology, and consumer habits to design collections that are both relevant and innovative.
5. **Create a Collection & Portfolio**: Create physical or digital design concepts, document your development process, and build a signature style.

Focus on getting hands-on with different fabrics and learning the fundamentals of garment construction as early as possible!`;
        } else if (lowerMsg.includes("data science") || lowerMsg.includes("data scientist")) {
          responseText = `Data science is an amazing and multidisciplinary field that combines mathematics, statistics, programming, and domain expertise. Here is a comprehensive skill roadmap to guide you:

1. **Mathematics & Statistics**: Focus on linear algebra, calculus, probability, and inferential statistics. These form the engine of machine learning algorithms.
2. **Programming & Libraries**: Master Python as your core language. Learn key libraries such as Pandas and NumPy for data manipulation, and Scikit-Learn for implementing machine learning models.
3. **Data Querying & Wrangling**: Gain deep expertise in SQL to extract and prepare datasets from large relational databases.
4. **Machine Learning & Modeling**: Understand supervised and unsupervised learning algorithms, model evaluation metrics, and feature engineering.
5. **Data Storytelling**: Practice communicating complex findings to non-technical stakeholders using clear visualizations and storytelling.

Building a portfolio of end-to-end data science projects—covering data gathering, cleaning, analysis, modeling, and insights—is the most powerful way to launch your career!`;
        } else {
          responseText = `That is an excellent topic to explore! When learning a new subject or planning a career path, here is a helpful and structured approach to guide you:

1. **Understand Core Concepts**: Focus on mastering the basic rules, terminology, and foundational principles first.
2. **Hands-On Practice**: Work through small, practical exercises or tutorials to build your confidence and learn how tools interact.
3. **Personal Projects**: Create something of your own from scratch. Building personal projects is the most effective way to consolidate your knowledge and showcase your skills.
4. **Connect with a Community**: Engage with forums, study groups, or professional networks to share your progress and ask questions.

Take it step by step, and feel free to ask if you'd like more detailed guidance or have specific questions about any of these areas!`;
        }
      } else {
        if (lowerMsg.includes("procrastinat") || lowerMsg.includes("lazy") || lowerMsg.includes("stuck")) {
          responseText = `Feeling stuck is completely normal and is often more about feeling overwhelmed than poor time management. 

To help ease that friction, here is a simple approach:
1. **The 5-Minute Rule**: Commit to working on your task for just five minutes. You can stop after that if you want, but getting started is usually the hardest step.
2. **Clear the Space**: Close unrelated browser tabs and put your phone away to reduce visual distractions.
3. **Find the smallest step**: Decide on a tiny first action, like simply opening the file or writing a single sentence.

Would you like to try applying this to one of your tasks together?`;
        } else if (lowerMsg.includes("schedule") || lowerMsg.includes("plan") || lowerMsg.includes("today")) {
          responseText = `A good schedule is about being realistic rather than perfect. Here is a friendly way to set up your day:

1. **Pick one main focus**: Choose a single high-impact task to prioritize.
2. **Set a focused block of time**: Dedicate a quiet, uninterrupted hour or two to that task.
3. **Protect your focus**: Let others know you'll be busy, and close communication apps during that time.

Would you like to look at your task list to see what we should prioritize today?`;
        } else {
          responseText = `Let's work together to make some steady, stress-free progress:

* **Find the very next step**: What is one small, simple action you can take to move forward?
* **Set a gentle boundary**: How much focused time do you feel comfortable dedicating to it today?

Let me know how you'd like to tackle this!`;
        }
      }
    }

    res.json({ response: responseText });

  } catch (error: any) {
    console.error("Error in coach chatbot:", error);
    res.status(500).json({ error: error.message || "Failed to communicate with Productivity Coach" });
  }
});

// Serve static assets in production, otherwise Vite dev middleware
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite development server...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static build in production...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexa server running on http://localhost:${PORT}`);
  });
}

setupVite().catch((err) => {
  console.error("Vite server initialization failed:", err);
});

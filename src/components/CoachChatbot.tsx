import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Send, Loader2, ClipboardCheck, User, Trash2, HelpCircle } from "lucide-react";
import { collection, addDoc, getDocs, writeBatch, doc, setDoc } from "firebase/firestore";
import { Firestore } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../firebase";
import { ChatMessage, Task } from "../types";

interface CoachChatbotProps {
  db: Firestore;
  tasks: Task[];
  messages: ChatMessage[];
  onMessageAdded: (msg: ChatMessage) => void;
  onHistoryCleared: () => void;
}

export default function CoachChatbot({
  db,
  tasks,
  messages,
  onMessageAdded,
  onHistoryCleared,
}: CoachChatbotProps) {
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    setIsLoading(true);
    setInputText("");

    try {
      const userMessageId = Math.random().toString(36).substring(2, 15);
      const userMessage: ChatMessage = {
        id: userMessageId,
        sender: "user",
        text: textToSend.trim(),
        createdAt: new Date().toISOString(),
      };

      // 1. Save user message to local state
      onMessageAdded(userMessage);

      // 2. Prepare conversation payload
      const allMessagesForPayload = [...messages, userMessage];

      // 3. Post to backend
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMessagesForPayload,
          tasks: tasks.filter(t => t.status === "pending"),
          currentLocalTime: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        throw new Error("Productivity coach response failed");
      }

      const data = await res.json();

      // 4. Save coach message to local state
      const coachMessageId = Math.random().toString(36).substring(2, 15);
      const coachMessage: ChatMessage = {
        id: coachMessageId,
        sender: "coach",
        text: data.response || "I didn't quite get that, let's try again.",
        createdAt: new Date().toISOString(),
      };

      onMessageAdded(coachMessage);

    } catch (error: any) {
      console.error("Error in chatbot:", error);
      // Append fallback error message
      const errorMessageId = Math.random().toString(36).substring(2, 15);
      const errorMessage: ChatMessage = {
        id: errorMessageId,
        sender: "coach",
        text: "Apologies, my synaptic engine hit a brief latency issue. Let's try typing your message again.",
        createdAt: new Date().toISOString(),
      };
      onMessageAdded(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      let querySnapshot;
      try {
        querySnapshot = await getDocs(collection(db, "messages"));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "messages");
        throw err;
      }
      
      if (querySnapshot.size > 0) {
        querySnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, "messages/batch");
          throw err;
        }
      }
      
      onHistoryCleared();
      setShowConfirmClear(false);
    } catch (error) {
      console.error("Error clearing chat messages:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (prompt: string) => {
    handleSendMessage(prompt);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80 rounded-3xl shadow-sm overflow-hidden flex flex-col h-[600px]">
      {/* Chat header */}
      <div className="p-5 bg-zinc-50/50 dark:bg-zinc-900/40 border-b border-zinc-150 dark:border-zinc-800/60 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/60 rounded-xl text-blue-600 dark:text-blue-400">
            <ClipboardCheck className="w-5 h-5 animate-bounce" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">Productivity Coach</h3>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold">Helping you plan, focus, and stay on track.</p>
          </div>
        </div>
        
        {messages.length > 0 && (
          showConfirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold text-rose-600 dark:text-rose-400">Clear chat?</span>
              <button
                id="confirm-clear-btn"
                onClick={handleClearHistory}
                disabled={isLoading}
                className="px-2.5 py-1 text-[10px] font-extrabold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-zinc-400 rounded-lg cursor-pointer shadow-sm transition-all"
              >
                Yes
              </button>
              <button
                onClick={() => setShowConfirmClear(false)}
                disabled={isLoading}
                className="px-2.5 py-1 text-[10px] font-extrabold text-zinc-500 hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 rounded-lg cursor-pointer transition-all"
              >
                No
              </button>
            </div>
          ) : (
            <button
              id="clear-conversation-btn"
              onClick={() => setShowConfirmClear(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 rounded-xl border border-zinc-200 hover:border-rose-200 dark:border-zinc-800 dark:hover:border-rose-950/50 bg-white hover:bg-rose-50/30 dark:bg-zinc-950 dark:hover:bg-rose-950/10 text-[10px] font-extrabold tracking-wide transition-all cursor-pointer shadow-sm"
              title="Clear Chat History"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Conversation</span>
            </button>
          )
        )}
      </div>

      {/* Messages layout */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center items-center text-center px-4 max-w-md mx-auto space-y-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-950/40 rounded-full text-blue-500 dark:text-blue-400">
              <ClipboardCheck className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-zinc-800 dark:text-zinc-100">Welcome! Your coach is ready.</h4>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 font-medium">
                What would you like to discuss today?
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              const isCoach = msg.sender === "coach";
              return (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${isCoach ? "justify-start" : "justify-end"}`}
                >
                  {isCoach && (
                    <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 border border-blue-100/30">
                      <ClipboardCheck className="w-4 h-4" />
                    </div>
                  )}

                  <div className={`p-3.5 rounded-2xl max-w-[85%] text-xs shadow-sm leading-relaxed ${
                    isCoach
                      ? "bg-zinc-50 dark:bg-zinc-950/50 text-zinc-800 dark:text-zinc-200 border border-zinc-150 dark:border-zinc-800/60 font-medium"
                      : "bg-blue-600 text-white font-bold"
                  }`}>
                    {/* Render basic custom paragraphs or bullets since coach writes markdown */}
                    <div className="whitespace-pre-wrap break-words">
                      {msg.text}
                    </div>
                  </div>

                  {!isCoach && (
                    <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center flex-shrink-0 border border-zinc-200/50 dark:border-zinc-700">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && (
              <div className="flex gap-2.5 justify-start">
                <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                  <ClipboardCheck className="w-4 h-4" />
                </div>
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-150 dark:border-zinc-800/60 rounded-2xl flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Nexa is thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input container */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage(inputText);
        }}
        className="p-4 border-t border-zinc-150 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/40 flex gap-2.5"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isLoading}
          placeholder="Ask Nexa Coach about priority, pacing, or schedule strategy..."
          className="flex-1 px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs transition-all font-bold"
        />
        <button
          type="submit"
          disabled={isLoading || !inputText.trim()}
          className="p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 text-white rounded-2xl shadow-md transition-all flex items-center justify-center shrink-0 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

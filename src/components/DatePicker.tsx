import React, { useState, useEffect, useRef } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

interface DatePickerProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

const monthNamesShort = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function DatePicker({ value, onChange, disabled = false }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse the current value, default to current date if empty
  const getParsedDate = (): Date => {
    if (!value) {
      const d = new Date();
      d.setHours(12, 0, 0, 0); // stable noon default
      return d;
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      const fallback = new Date();
      fallback.setHours(12, 0, 0, 0);
      return fallback;
    }
    return d;
  };

  const selectedDate = value ? getParsedDate() : null;

  // Helper to check if a date is in the past
  const isPastDate = (cellDate: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cell = new Date(cellDate);
    cell.setHours(0, 0, 0, 0);
    return cell < today;
  };

  // Track the month/year we are currently viewing in the calendar grid
  const [viewDate, setViewDate] = useState<Date>(() => {
    return selectedDate || new Date();
  });

  // Whenever a valid value comes in, sync the view month/year to it
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setViewDate(d);
      }
    }
  }, [value]);

  // Handle click outside to close the picker popup
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Navigation helpers
  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  // Days of Month calculations
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sunday, etc.

  // Calendar days array
  const days: { day: number; isCurrentMonth: boolean; date: Date }[] = [];

  // Previous month filling days
  const prevMonthDate = new Date(year, month, 0);
  const prevMonthDaysCount = prevMonthDate.getDate();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDaysCount - i;
    days.push({
      day: d,
      isCurrentMonth: false,
      date: new Date(year, month - 1, d),
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({
      day: d,
      isCurrentMonth: true,
      date: new Date(year, month, d),
    });
  }

  // Next month filling days (fill grid to multiple of 7, up to 42 cells)
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({
      day: d,
      isCurrentMonth: false,
      date: new Date(year, month + 1, d),
    });
  }

  const handleSelectDay = (cellDate: Date) => {
    if (isPastDate(cellDate)) {
      setValidationError("Please select today or a future date.");
      return;
    }
    setValidationError("");
    const updated = new Date(cellDate);
    updated.setHours(12, 0, 0, 0); // Keep stable noon time to avoid timezone shifts
    onChange(updated.toISOString());
    setIsOpen(false); // Auto close on select for better UX
  };

  // Reset error when opened
  useEffect(() => {
    if (isOpen) {
      setValidationError("");
    }
  }, [isOpen]);

  // Format date for field display: "26 Jun 2026"
  const formatDisplay = () => {
    if (!selectedDate) return "Select deadline date...";
    const day = selectedDate.getDate();
    const monthShort = monthNamesShort[selectedDate.getMonth()];
    const yr = selectedDate.getFullYear();
    return `${day} ${monthShort} ${yr}`;
  };

  const isToday = (cellDate: Date) => {
    const today = new Date();
    return (
      cellDate.getDate() === today.getDate() &&
      cellDate.getMonth() === today.getMonth() &&
      cellDate.getFullYear() === today.getFullYear()
    );
  };

  const isSelected = (cellDate: Date) => {
    if (!selectedDate) return false;
    return (
      cellDate.getDate() === selectedDate.getDate() &&
      cellDate.getMonth() === selectedDate.getMonth() &&
      cellDate.getFullYear() === selectedDate.getFullYear()
    );
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Trigger Field */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 hover:border-zinc-300 dark:hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-xs font-bold text-left cursor-pointer"
      >
        <span className={selectedDate ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 dark:text-zinc-500"}>
          {formatDisplay()}
        </span>
        <CalendarIcon className="w-4 h-4 text-zinc-400" />
      </button>

      {/* Calendar Popup */}
      {isOpen && (
        <div className="absolute z-50 mt-2 left-0 right-0 sm:w-80 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-4 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-extrabold text-zinc-800 dark:text-zinc-200">
              {monthNames[month]} {year}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-500 dark:text-zinc-400 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-500 dark:text-zinc-400 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <span key={day} className="text-[10px] font-extrabold text-zinc-400 dark:text-zinc-500 uppercase">
                {day}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {days.map((cell, idx) => {
              const active = isSelected(cell.date);
              const current = isToday(cell.date);
              const isPast = isPastDate(cell.date);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectDay(cell.date)}
                  className={`aspect-square w-full rounded-xl flex items-center justify-center text-xs font-bold transition-all relative ${
                    isPast
                      ? "text-zinc-300 dark:text-zinc-700 bg-transparent opacity-30 line-through cursor-pointer"
                      : active
                      ? "bg-blue-600 text-white font-extrabold cursor-pointer"
                      : cell.isCurrentMonth
                      ? "text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      : "text-zinc-350 dark:text-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-850/50 cursor-pointer"
                  }`}
                >
                  {cell.day}
                  {current && !active && (
                    <span className="absolute bottom-1 w-1 h-1 bg-blue-500 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          {validationError && (
            <div className="mt-3 text-center text-[11px] font-extrabold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 py-2 px-2.5 rounded-xl border border-red-150 dark:border-red-900/30">
              {validationError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

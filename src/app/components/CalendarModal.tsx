import { useState } from 'react';
import type { Walk } from '../page';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarModalProps {
  walks: Walk[];
  onClose: () => void;
  onSelectDate: (dateStr: string) => void;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarModal({ walks, onClose, onSelectDate }: CalendarModalProps) {
  // Start the calendar on the month of the most recent walk, or current month
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (walks.length > 0) {
      // Sort walks by date descending to find the most recent
      const sorted = [...walks].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return new Date(sorted[0].date);
    }
    return new Date();
  });

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Map dates to walk counts for the current month
  const walkCountsByDay = new Map<number, number>();
  walks.forEach(w => {
    const d = new Date(w.date);
    if (d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear()) {
      const day = d.getDate();
      walkCountsByDay.set(day, (walkCountsByDay.get(day) || 0) + 1);
    }
  });

  const handleDayClick = (day: number) => {
    if (!walkCountsByDay.has(day)) return;
    
    // Create an ISO string for the selected date (local timezone aligned)
    const dateStr = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day, 12).toISOString();
    onSelectDate(dateStr);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-[#1e2329] p-6 rounded-2xl w-full max-w-[360px] border border-white/5 shadow-2xl"
        onClick={e => e.stopPropagation()} // Prevent clicks from closing modal
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-white text-lg font-medium">Select Date</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center justify-between mb-6">
          <button onClick={prevMonth} className="p-2 text-gray-400 hover:bg-white/5 rounded-lg hover:text-white transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="text-white font-medium">
            {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </div>
          <button onClick={nextMonth} className="p-2 text-gray-400 hover:bg-white/5 rounded-lg hover:text-white transition-colors">
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-2 mb-2">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs text-gray-500 font-medium pb-2">
              {d}
            </div>
          ))}
          {blanks.map(b => (
            <div key={`blank-${b}`} className="w-8 h-8"></div>
          ))}
          {days.map(d => {
            const hasWalks = walkCountsByDay.has(d);
            return (
              <button
                key={d}
                onClick={() => handleDayClick(d)}
                disabled={!hasWalks}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                  hasWalks 
                    ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white cursor-pointer ring-1 ring-emerald-500/50' 
                    : 'text-gray-600 cursor-default'
                }`}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  );
}

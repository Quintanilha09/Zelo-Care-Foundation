import { cn } from "@/lib/utils";
import { Check, Clock, User } from "lucide-react";
import { motion } from "framer-motion";

interface DoseCardProps {
  medicationName: string;
  dosage: string;
  time: string;
  status: 'pending' | 'taken';
  takenBy?: string;
  takenAt?: string;
}

export function DoseCard({ medicationName, dosage, time, status, takenBy, takenAt }: DoseCardProps) {
  const isTaken = status === 'taken';

  return (
    <motion.div 
      whileHover={{ y: -2 }}
      className={cn(
        "p-5 rounded-xl border flex flex-col gap-3 min-h-[64px] shadow-sm transition-colors",
        isTaken 
          ? "bg-zelo-green-bg border-zelo-green/20" 
          : "bg-zelo-amber-bg border-zelo-amber/20"
      )}
    >
      <div className="flex justify-between items-start gap-4">
        <div>
          <h3 className="text-[18px] font-semibold text-foreground leading-tight">{medicationName}</h3>
          <p className="text-muted-foreground mt-1 text-[17px]">{dosage}</p>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[15px] font-medium border",
          isTaken ? "bg-zelo-green/10 text-zelo-green-fg border-zelo-green/20" : "bg-zelo-amber/20 text-zelo-amber-fg border-zelo-amber/20"
        )}>
          {isTaken ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
          <span>{isTaken ? 'Tomado' : 'Pendente'}</span>
        </div>
      </div>
      
      <div className="flex items-center gap-2 text-[17px] mt-1">
        {isTaken ? (
          <>
            <div className="flex -space-x-1">
              <div className="w-6 h-6 rounded-full bg-zelo-green/20 flex items-center justify-center border border-white">
                <User className="w-3.5 h-3.5 text-zelo-green-fg" />
              </div>
            </div>
            <span className="text-muted-foreground">
              às <strong className="font-medium text-foreground">{takenAt}</strong> por <strong className="font-medium text-foreground">{takenBy}</strong>
            </span>
          </>
        ) : (
          <span className="text-zelo-amber-fg font-medium">Agendado para {time}</span>
        )}
      </div>
    </motion.div>
  );
}
import { User } from "lucide-react";
import { CaregiverBadge } from "./caregiver-badge";

interface CaregiverCardProps {
  name: string;
  role: 'primary_caregiver' | 'caregiver' | 'hired_caregiver' | 'observer';
}

export function CaregiverCard({ name, role }: CaregiverCardProps) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
        <User className="w-6 h-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[18px] font-medium text-foreground">{name}</span>
        <CaregiverBadge role={role} />
      </div>
    </div>
  );
}